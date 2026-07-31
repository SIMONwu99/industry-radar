#!/usr/bin/env node
/**
 * fetch-data.js — 全量抓取所有公众号文章 v5.0
 * 使用微信公众号后台 appmsg 接口（可查看任意公众号文章列表）
 *
 * 环境变量:
 *   WECHAT_COOKIE  — 微信公众号后台 Cookie
 *   WECHAT_TOKEN   — 微信公众号后台 Token（URL 中的数字）
 *   CUTOFF_DAYS    — 抓取时间窗口天数（默认 1095 = 3年）
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

const COOKIE       = process.env.WECHAT_COOKIE || '';
const TOKEN        = process.env.WECHAT_TOKEN  || '';
const CUTOFF_DAYS  = parseInt(process.env.CUTOFF_DAYS || '1095', 10); // 默认近 3 年
const CUTOFF_TS    = Math.floor(Date.now() / 1000) - CUTOFF_DAYS * 86400;
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data-snapshot');

// ============================================================
// 目标账号列表
// ============================================================
const TARGET_ACCOUNTS = [
  // 快手（恒定对比项，固定第一位）
  { name: '快手招聘',          company: 'kuaishou' },
  // 行业资讯
  { name: '大厂日爆',          company: 'industry' },
  { name: '天天开柒',          company: 'industry' },
  { name: '互联网坊间八卦',    company: 'industry' },
  { name: '申妈的朋友圈',      company: 'industry' },
  { name: '字节范儿',          company: 'industry' },
  { name: '虎嗅APP',           company: 'industry' },
  { name: '晚点LatePost',      company: 'industry' },
  { name: '机器之心',          company: 'industry' },
  { name: 'InfoQ',             company: 'industry' },
  { name: '量子位',            company: 'industry' },
  // 字节跳动
  { name: '字节跳动招聘',      company: 'bytedance' },
  { name: '字节跳动Seed',      company: 'bytedance' },
  { name: '字节跳动技术团队',  company: 'bytedance' },
  { name: '大厂青年',          company: 'bytedance' },
  // 腾讯
  { name: '腾讯招聘',          company: 'tencent' },
  { name: '腾讯文化',          company: 'tencent' },
  { name: '腾讯技术工程',      company: 'tencent' },
  // 阿里
  { name: '阿里巴巴集团招聘',  company: 'alibaba' },
  { name: '阿里技术',          company: 'alibaba' },
  // 美团
  { name: '美团招聘',          company: 'meituan' },
  { name: '美团技术团队',      company: 'meituan' },
  { name: '龙猫LongCat',       company: 'meituan' },
  // 小红书
  { name: '小红书招聘',        company: 'xiaohongshu' },
  { name: '是小红书人啊',      company: 'xiaohongshu' },
  { name: '小红书技术REDtech', company: 'xiaohongshu' },
  // 百度
  { name: '百度招聘',          company: 'baidu' },
  { name: '百度APP',           company: 'baidu' },
  { name: '百度文心',          company: 'baidu' },
  // 京东
  { name: '京东招聘',          company: 'jd' },
];

// ============================================================
// HTTP 工具
// ============================================================
function apiGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20000,
      headers: {
        'Cookie': COOKIE,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Referer': `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${TOKEN}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      }
    }, (res) => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ _raw: data.substring(0, 300), _parseErr: e.message }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// Step 1: searchbiz → 获取 fakeid
// ============================================================
async function searchFakeid(accountName) {
  const url = `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&begin=0&count=5&query=${encodeURIComponent(accountName)}&token=${TOKEN}&lang=zh_CN&f=json&ajax=1`;
  const data = await apiGet(url);

  const ret = data.base_resp?.ret;
  if (ret === 200003) throw new Error('SESSION_EXPIRED');
  if (ret !== 0) throw new Error(`searchbiz ret=${ret}: ${data.base_resp?.err_msg}`);

  const list = data.list || [];
  if (list.length === 0) return null;

  // 精确匹配优先（忽略空格大小写）
  const norm = s => s.replace(/\s+/g,'').toLowerCase();
  const exact = list.find(item => norm(item.nickname) === norm(accountName));
  return exact || list[0];
}

// ============================================================
// Step 2: appmsg → 获取文章列表
// ============================================================
async function fetchArticles(fakeid, cutoffTs, existingArticles = []) {
  const articles = [];
  let begin = 0;
  const pageSize = 20;

  // 已有文章的 id 集合（增量抓取用）
  const existingIds = new Set(existingArticles.map(a => a.id).filter(Boolean));

  let rateLimitRetries = 0;
  const MAX_RATE_LIMIT_RETRIES = 3;

  while (true) {
    const url = `https://mp.weixin.qq.com/cgi-bin/appmsg?action=list_ex&begin=${begin}&count=${pageSize}&fakeid=${encodeURIComponent(fakeid)}&type=9&query=&token=${TOKEN}&lang=zh_CN&f=json&ajax=1`;
    const data = await apiGet(url);

    const ret = data.base_resp?.ret;
    if (ret === 200003) throw new Error('SESSION_EXPIRED');
      if (ret === 200013) {
        // 限流：立即跳过本账号（保留已抓部分），避免整体超时
        console.log(` [限流200013,保留已抓${articles.length}篇跳过] `);
        break;
      }
    if (ret !== 0) throw new Error(`appmsg ret=${ret}: ${data.base_resp?.err_msg}`);

    const list = data.app_msg_list || [];
    if (list.length === 0) break;

    let reachedCutoff = false;
    for (const msg of list) {
      const t = msg.update_time || msg.create_time || 0;
      if (t && t < cutoffTs) { reachedCutoff = true; continue; }
      articles.push({
        id:          String(msg.aid || msg.appmsgid || ''),
        title:       (msg.title || '').trim(),
        link:        msg.link || '',
        publishTime: t,
        cover:       msg.cover || msg.pic_url || '',
        digest:      (msg.digest || '').trim().substring(0, 120),
        author:      msg.author || '',
        feedId:      fakeid,
      });
    }

    if (reachedCutoff) break;
    const total = data.app_msg_cnt || 0;
    begin += pageSize;
    if (total > 0 && begin >= total) break;
    await sleep(800);                  // 翻页间隔恢复较低
  }

  // 合并：新抓的 + 已有的（增量），按 id 或标题去重，publishTime 倒序
  const merged = [...articles];
  const seenIds = new Set(articles.map(a => a.id));
  const seenTitles = new Set(articles.map(a => (a.title || '').replace(/\s+/g, '').toLowerCase()));
  for (const old of existingArticles) {
    const oldId = old.id;
    const oldTitleKey = (old.title || '').replace(/\s+/g, '').toLowerCase();
    if (oldId && seenIds.has(oldId)) continue;
    if (seenTitles.has(oldTitleKey)) continue;
    // 保留 3 年内的旧数据
    if (old.publishTime && old.publishTime < cutoffTs) continue;
    if (!old.title) continue;
    merged.push(old);
    if (oldId) seenIds.add(oldId);
    seenTitles.add(oldTitleKey);
  }
  merged.sort((a, b) => (b.publishTime || 0) - (a.publishTime || 0));
  return merged;
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  if (!COOKIE || !TOKEN) {
    console.error('❌ 缺少 WECHAT_COOKIE 或 WECHAT_TOKEN');
    process.exit(1);
  }

  console.log(`🚀 开始全量抓取 ${TARGET_ACCOUNTS.length} 个公众号 (近 ${CUTOFF_DAYS} 天，无篇数上限)`);
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // 加载 fakeid 缓存（避免重复 searchbiz）
  const cacheFile = path.join(SNAPSHOT_DIR, 'fakeid-cache.json');
  const fakeidCache = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    : {};

  // 洗牌账号顺序：每次跑给不同账号"优先抓取"的机会（限流是全局的，靠前的账号更容易抓全）
  const accountsShuffled = [...TARGET_ACCOUNTS].sort(() => Math.random() - 0.5);

  // 加载现有 feeds.json，用于合并本次跳过账号的 meta
  const feedsFile = path.join(SNAPSHOT_DIR, 'feeds.json');
  const oldFeedsMap = new Map();
  if (fs.existsSync(feedsFile)) {
    try {
      const oldFeeds = JSON.parse(fs.readFileSync(feedsFile, 'utf8'));
      for (const f of oldFeeds) oldFeedsMap.set(f.name || f.id, f);
    } catch(_) {}
  }

  const feedsMeta = [];
  const processedNames = new Set();
  let totalArticles = 0, successes = 0, failures = 0;

  for (const account of accountsShuffled) {
    const { name, company } = account;
    process.stdout.write(`  [${company}] ${name}... `);

    try {
      // -- 获取 fakeid --
      let fakeid = fakeidCache[name];
      let nickname = name;

      if (!fakeid) {
        await sleep(800);
        const result = await searchFakeid(name);
        if (!result) {
          console.log('⚠️  未搜索到账号');
          failures++;
          continue;
        }
        fakeid   = result.fakeid;
        nickname = result.nickname || name;
        fakeidCache[name] = fakeid;
        fs.writeFileSync(cacheFile, JSON.stringify(fakeidCache, null, 2));
      }

      // -- 抓取文章 --
      await sleep(600);
      // 以 name 的安全版本作为文件名（提前算，用于加载已有数据）
      const safeId = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
      const existingFile = path.join(SNAPSHOT_DIR, `${safeId}.json`);
      let existingArticles = [];
      if (fs.existsSync(existingFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(existingFile, 'utf8'));
          existingArticles = Array.isArray(raw) ? raw : (raw.articles || []);
        } catch(_) {}
      }
      const articles = await fetchArticles(fakeid, CUTOFF_TS, existingArticles);

      const syncTime = Math.floor(Date.now() / 1000);

      feedsMeta.push({
        id:           safeId,
        fakeid,
        name:         nickname,
        displayName:  name,
        company,
        cover:        articles[0]?.cover || '',
        syncTime,
        updateTime:   articles[0]?.publishTime || syncTime,
        articleCount: articles.length,  // 已去重后的数量
      });

      fs.writeFileSync(
        path.join(SNAPSHOT_DIR, `${safeId}.json`),
        JSON.stringify(articles, null, 2)
      );

      totalArticles += articles.length;
      successes++;
      processedNames.add(name);
      console.log(`✅ ${articles.length} 篇`);
      await sleep(1500);

    } catch(e) {
      console.log(`❌ ${e.message.substring(0, 80)}`);
      failures++;
      if (e.message === 'SESSION_EXPIRED') {
        console.error('\n💀 Cookie/Token 已失效！请重新登录微信公众号后台并更新 WECHAT_COOKIE 和 WECHAT_TOKEN。');
        break;
      }
    }
  }

  // 合并被跳过的账号 meta：本次没处理的账号保留旧 feeds.json 的 meta 项
  for (const [name, oldMeta] of oldFeedsMap.entries()) {
    if (!processedNames.has(name) && !feedsMeta.some(f => f.name === oldMeta.name)) {
      feedsMeta.push(oldMeta);
    }
  }

  // 写总索引
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, 'feeds.json'),
    JSON.stringify(feedsMeta, null, 2)
  );

  console.log(`\n📊 抓取完成: ✅ ${successes} 成功 (${totalArticles} 篇) | ❌ ${failures} 失败`);
  // 只有 SESSION_EXPIRED 才 fail run；普通失败（如限流）视为部分成功，允许 commit 已抓部分
  // if (failures > 0) process.exit(1);  // 不再因单账号失败而 fail run
}

main().catch(e => { console.error('💥', e.message); process.exit(1); });
