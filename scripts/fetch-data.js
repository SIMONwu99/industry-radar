#!/usr/bin/env node
/**
 * fetch-data.js — v4.2 (搜狗微信搜索版，精确来源过滤)
 *
 * 通过搜狗微信搜索抓取公众号最新文章，无需账号 Cookie。
 * 环境变量:
 *   MAX_ARTICLES  - 每个公众号最多保存文章数（默认 10）
 *
 * 字段说明:
 *   name       公众号显示名称（也作为搜狗搜索关键词）
 *   id         文件名用的短 ID（无特殊字符）
 *   matchName  可选，搜索结果来源字段的精确匹配名（当 name 匹配效果差时用）
 */


const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES || '10', 10);
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data-snapshot');

const ACCOUNT_CONFIG = {
  industry: [
    { name: '大厂日爆',         id: 'dachang_ribao' },
    { name: '天天开柒',         id: 'tiantiankaiq' },
    { name: '互联网坊间八卦',   id: 'fangjian_bagua' },
    { name: '申妈的朋友圈',     id: 'shen_ma_pq' },
    { name: '字节范儿',         id: 'zijie_fan' },
    { name: '虎嗅APP',          id: 'huxiucom',      matchName: '虎嗅' },
    { name: '晚点LatePost',     id: 'latepost',      matchName: '晚点LatePost' },
    { name: '机器之心',         id: 'almosthuman2014' },
    { name: 'InfoQ',            id: 'infoqchina',    matchName: 'InfoQ' },
    { name: '量子位',           id: 'QbitAI' },
  ],
  bytedance: [
    { name: '字节跳动招聘',     id: 'ByteDanceRecruit', matchName: '字节跳动招聘' },
    { name: '字节跳动Seed',     id: 'bytedanceseed',    matchName: '字节跳动Seed' },
    { name: '字节跳动技术团队', id: 'BytedanceTech',    matchName: '字节跳动技术团队' },
    { name: '大厂青年',         id: 'dachang_youth' },
  ],
  tencent: [
    { name: '腾讯招聘',         id: 'TencentRecruit' },
    { name: '腾讯文化',         id: 'TencentCulture' },
    { name: '腾讯技术工程',     id: 'Tencent_TEG',   matchName: '腾讯技术工程' },
  ],
  alibaba: [
    { name: '阿里巴巴集团招聘', id: 'AlibabaRecruit', matchName: '阿里巴巴集团招聘' },
    { name: '阿里技术',         id: 'ali_tech',       matchName: '阿里技术' },
  ],
  meituan: [
    { name: '美团招聘',         id: 'MeituanRecruit', matchName: '美团招聘' },
    { name: '美团技术团队',     id: 'meituantech',    matchName: '美团技术团队' },
  ],
  xiaohongshu: [
    { name: '小红书招聘',        id: 'redRecruit',           matchName: '小红书招聘' },
    { name: '是小红书人啊',      id: 'xiaohongshu_ren' },
    { name: '小红书技术REDtech', id: 'xiaohongshuREDtech',   matchName: '小红书技术REDtech' },
  ],
  baidu: [
    { name: '百度招聘',         id: 'baidurecruit',   matchName: '百度招聘' },
    { name: '百度',             id: 'baidu_gongsi',   matchName: '百度' },
    { name: '百度文心',         id: 'wenxin_baidu',   matchName: '文心一言' },
  ],
};

const ALL_ACCOUNTS = Object.entries(ACCOUNT_CONFIG).flatMap(([company, accounts]) =>
  accounts.map(acc => ({ ...acc, company }))
);

// ============================================================
// HTTP 工具（支持重定向）
// ============================================================
function fetchUrl(url, options = {}, timeout = 20000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'identity',
    };
    const req = mod.get(url, { ...options, timeout, headers: { ...defaultHeaders, ...(options.headers || {}) } }, (res) => {
      const loc = res.headers.location;
      if ([301, 302, 307, 308].includes(res.statusCode) && loc) {
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchUrl(next, options, timeout, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
  });
}

// ============================================================
// 搜狗微信搜索解析
// 格式: /link?url=ENCRYPTED_TOKEN&type=2&query=XXX
// 解析为: https://weixin.sogou.com/link?url=...
// ============================================================
function cleanHtml(str) {
  return str
    .replace(/<!--red_beg-->/g, '').replace(/<!--red_end-->/g, '')
    .replace(/<em>/g, '').replace(/<\/em>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

async function fetchBySogou(account) {
  const { name: accountName, id: accountId, matchName } = account;
  const exactMatch = matchName || accountName;
  const query = encodeURIComponent(accountName);
  const url = `https://weixin.sogou.com/weixin?type=2&query=${query}&ie=utf8`;

  const { status, body } = await fetchUrl(url);
  if (status !== 200) throw new Error(`搜狗 HTTP ${status}`);

  const articles = [];
  const blockRe = /<div class="txt-box">([\s\S]*?)(?=<div class="txt-box">|<div class="pagination">|$)/g;

  let block;
  while ((block = blockRe.exec(body)) !== null && articles.length < MAX_ARTICLES) {
    const html = block[1];

    // 1. 提取来源（公众号名称）— 先检查来源，过滤掉非目标账号的文章
    const sourceMatch = html.match(/<span class="all-time-y2"[^>]*>([\s\S]*?)<\/span>/);
    const source = sourceMatch ? cleanHtml(sourceMatch[1]) : '';

    const sourceNorm = source.replace(/\s+/g, '').toLowerCase();
    const exactNorm = exactMatch.replace(/\s+/g, '').toLowerCase();
    const nameNorm = accountName.replace(/\s+/g, '').toLowerCase();

    // matchName 时精确匹配，否则宽松匹配
    const isMatch = matchName
      ? (!source || sourceNorm === exactNorm || sourceNorm.includes(exactNorm))
      : (!source || sourceNorm === nameNorm || sourceNorm.includes(nameNorm) ||
         nameNorm.includes(sourceNorm) ||
         (nameNorm.match(/[a-z]+/g) || []).some(w => w.length > 2 && sourceNorm.includes(w)));

    if (!isMatch) continue;

    // 2. 提取标题和链接
    const linkMatch = html.match(/<a[^>]+href="(\/link\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    const rawLink = 'https://weixin.sogou.com' + linkMatch[1].replace(/&amp;/g, '&');
    const rawTitle = cleanHtml(linkMatch[2]);
    if (!rawTitle) continue;

    // 3. 提取时间（timeConvert 参数是 Unix 时间戳）
    const timeMatch = html.match(/timeConvert\('(\d+)'\)/);
    const publishTime = timeMatch ? parseInt(timeMatch[1]) : Math.floor(Date.now() / 1000);

    // 4. 提取摘要
    const digestMatch = html.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/);
    const digest = digestMatch ? cleanHtml(digestMatch[1]).substring(0, 120) : '';

    // 5. 生成唯一 ID
    const idMatch = rawLink.match(/url=([^&]+)/);
    const articleId = idMatch ? idMatch[1].substring(0, 20) : String(publishTime);

    articles.push({
      id: articleId,
      title: rawTitle.substring(0, 100),
      link: rawLink,       // 搜狗中转链接，会重定向到微信文章
      publishTime,
      cover: '',
      digest,
      source: source || accountName,
      feedId: accountId,
    });
  }

  return articles;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  console.log('🚀 开始拉取数据（搜狗微信搜索 v4.1）...');
  console.log(`📊 监测账号: ${ALL_ACCOUNTS.length} 个`);

  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  const feedsMeta = [];
  let totalArticles = 0;
  let successCount = 0;
  let failCount = 0;

  for (const account of ALL_ACCOUNTS) {
    const { name, id, company } = account;
    console.log(`  📥 [${company}] ${name}...`);

    try {
      const articles = await fetchBySogou(account);

      if (articles.length === 0) {
        console.warn(`  ⚠️  ${name}: 未搜到文章（可能搜狗被限流）`);
      } else {
        console.log(`  ✅ ${name}: ${articles.length} 篇`);
      }

      const syncTime = Math.floor(Date.now() / 1000);
      feedsMeta.push({
        id, name, company,
        cover: '',
        syncTime,
        updateTime: articles[0]?.publishTime || syncTime,
        articleCount: articles.length,
      });

      fs.writeFileSync(
        path.join(SNAPSHOT_DIR, `${id}.json`),
        JSON.stringify(articles, null, 2)
      );

      totalArticles += articles.length;
      successCount++;
      await sleep(2500);  // 搜狗限流保护

    } catch(e) {
      console.error(`  ❌ ${name}: ${e.message}`);
      failCount++;
      const emptyFile = path.join(SNAPSHOT_DIR, `${id}.json`);
      if (!fs.existsSync(emptyFile)) {
        fs.writeFileSync(emptyFile, JSON.stringify([], null, 2));
      }
    }
  }

  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, 'feeds.json'),
    JSON.stringify(feedsMeta, null, 2)
  );

  console.log(`\n📊 完成！✅ ${successCount} 个成功 (${totalArticles} 篇) | ❌ ${failCount} 个失败`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
