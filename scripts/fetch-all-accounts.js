#!/usr/bin/env node
/**
 * fetch-all-accounts.js — 全量抓取所有公众号文章
 * 使用微信公众号后台 searchbiz + appmsgpublish 接口
 *
 * 用法:
 *   WECHAT_COOKIE="..." WECHAT_TOKEN="..." node fetch-all-accounts.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const COOKIE = process.env.WECHAT_COOKIE || '';
const TOKEN  = process.env.WECHAT_TOKEN  || '';
const MAX_PER_ACCOUNT = parseInt(process.env.MAX_ARTICLES || '30', 10);
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data-snapshot');

// 目标账号列表（name 用于 searchbiz 搜索，company 用于分组）
const TARGET_ACCOUNTS = [
  // 行业资讯
  { name: '大厂日爆',          company: 'industry' },
  { name: '天天开柒',          company: 'industry' },
  { name: '互联网坊间八卦',    company: 'industry' },
  { name: '申妈的朋友圈',      company: 'industry' },
  { name: '字节范儿',          company: 'industry' },
  { name: '虎嗅',              company: 'industry',  searchName: '虎嗅APP' },
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
  // 小红书
  { name: '小红书招聘',        company: 'xiaohongshu' },
  { name: '是小红书人啊',      company: 'xiaohongshu' },
  { name: '小红书技术REDtech', company: 'xiaohongshu' },
  // 百度
  { name: '百度招聘',          company: 'baidu' },
  { name: '百度',              company: 'baidu',  searchName: '百度APP' },
  { name: '百度文心',          company: 'baidu' },
];

// ============================================================
// HTTP
// ============================================================
function request(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 20000,
      headers: {
        'Cookie': COOKIE,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Referer': `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${TOKEN}`,
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      }
    };
    if (body) opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const req = https.request(opts, (res) => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ _raw: data.substring(0, 200) }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// Step 1: searchbiz — 搜索公众号获取 fakeid
// ============================================================
async function searchFakeid(accountName) {
  const query = encodeURIComponent(accountName);
  const url = `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&begin=0&count=5&query=${query}&token=${TOKEN}&lang=zh_CN&f=json&ajax=1`;
  const data = await request(url);

  if (data.base_resp?.ret !== 0) {
    throw new Error(`searchbiz ret=${data.base_resp?.ret}: ${data.base_resp?.err_msg}`);
  }

  const list = data.list || [];
  if (list.length === 0) return null;

  // 精确匹配优先
  const exact = list.find(item =>
    item.nickname === accountName ||
    item.nickname.replace(/\s+/g, '') === accountName.replace(/\s+/g, '')
  );
  return exact || list[0]; // 没有精确匹配就取第一个
}

// ============================================================
// Step 2: appmsgpublish — 拉取文章列表
// ============================================================
async function fetchArticles(fakeid, count = MAX_PER_ACCOUNT) {
  const allArticles = [];
  let begin = 0;
  const pageSize = 10;

  while (allArticles.length < count) {
    const url = `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&search_field=null&begin=${begin}&count=${pageSize}&fakeid=${encodeURIComponent(fakeid)}&type=101_1_102_103&free_publish_type=1&sub_action=list_ex&token=${TOKEN}&lang=zh_CN&f=json&ajax=1`;
    const data = await request(url);

    if (data.base_resp?.ret !== 0) {
      throw new Error(`appmsgpublish ret=${data.base_resp?.ret}: ${data.base_resp?.err_msg}`);
    }

    const page = data.publish_page || {};
    const publishList = page.publish_list || [];

    if (publishList.length === 0) break;

    for (const pub of publishList) {
      const appmsgList = pub.publish_info?.appmsgex || [];
      for (const msg of appmsgList) {
        if (allArticles.length >= count) break;
        allArticles.push({
          id: String(msg.appmsgid || msg.aid || ''),
          title: (msg.title || '').trim(),
          link: msg.link || '',
          publishTime: pub.publish_info?.send_time || 0,
          cover: msg.cover || msg.thumb_url || '',
          digest: (msg.digest || '').trim().substring(0, 120),
          feedId: fakeid,
        });
      }
      if (allArticles.length >= count) break;
    }

    if (publishList.length < pageSize) break; // 没有更多了
    begin += pageSize;
    await sleep(500);
  }

  return allArticles.filter(a => a.title && a.publishTime > 0);
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  if (!COOKIE || !TOKEN) {
    console.error('❌ 请设置 WECHAT_COOKIE 和 WECHAT_TOKEN 环境变量');
    process.exit(1);
  }

  console.log(`🚀 开始全量抓取 ${TARGET_ACCOUNTS.length} 个公众号...`);
  console.log(`   Token: ${TOKEN} | Cookie长度: ${COOKIE.length}`);

  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const feedsMeta = [];
  let totalArticles = 0, successCount = 0, failCount = 0;

  // 先保存 fakeid 映射（避免重复搜索）
  const fakeidCache = {};
  const cacheFile = path.join(SNAPSHOT_DIR, 'fakeid-cache.json');
  if (fs.existsSync(cacheFile)) {
    Object.assign(fakeidCache, JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    console.log(`   📦 已加载 fakeid 缓存: ${Object.keys(fakeidCache).length} 个`);
  }

  for (const account of TARGET_ACCOUNTS) {
    const searchKey = account.searchName || account.name;
    const displayName = account.name;
    const { company } = account;

    process.stdout.write(`  [${company}] ${displayName}... `);

    try {
      // Step 1: 获取 fakeid
      let fakeid = fakeidCache[displayName];
      let nickname = displayName;

      if (!fakeid) {
        await sleep(800); // 搜索接口限频
        const result = await searchFakeid(searchKey);
        if (!result) {
          console.log(`⚠️  未搜索到`);
          failCount++;
          continue;
        }
        fakeid = result.fakeid;
        nickname = result.nickname;
        fakeidCache[displayName] = fakeid;
        // 实时保存缓存
        fs.writeFileSync(cacheFile, JSON.stringify(fakeidCache, null, 2));
        process.stdout.write(`fakeid=${fakeid.substring(0,8)}... `);
      } else {
        process.stdout.write(`(缓存) `);
      }

      // Step 2: 拉取文章
      await sleep(600);
      const articles = await fetchArticles(fakeid, MAX_PER_ACCOUNT);

      console.log(`✅ ${articles.length} 篇`);

      const syncTime = Math.floor(Date.now() / 1000);
      const safeId = displayName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');

      feedsMeta.push({
        id: safeId,
        fakeid,
        name: nickname || displayName,
        displayName,
        company,
        cover: articles[0]?.cover || '',
        syncTime,
        updateTime: articles[0]?.publishTime || syncTime,
        articleCount: articles.length,
      });

      // 文章文件以 fakeid 命名（前端 JS 读取时用）
      fs.writeFileSync(
        path.join(SNAPSHOT_DIR, `${safeId}.json`),
        JSON.stringify(articles, null, 2)
      );

      totalArticles += articles.length;
      successCount++;
      await sleep(1000); // 避免触发限频

    } catch(e) {
      console.log(`❌ ${e.message}`);
      failCount++;
      // 检测 session 失效
      if (e.message.includes('200003') || e.message.includes('invalid session')) {
        console.error('\n⚠️  Cookie/Token 已失效！请重新获取后再运行。');
        break;
      }
    }
  }

  // 写入总索引
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, 'feeds.json'),
    JSON.stringify(feedsMeta, null, 2)
  );

  console.log(`\n📊 完成！✅ ${successCount} 个成功 (${totalArticles} 篇) | ❌ ${failCount} 个失败`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
