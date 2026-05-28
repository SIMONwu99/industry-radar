#!/usr/bin/env node
/**
 * fetch-data.js — v2.0 (RSSHub 版)
 *
 * 通过 RSSHub 的微信公众号路由拉取文章。
 * RSSHub 路由: /wechat/mp/article/{fakeid}
 *
 * 环境变量:
 *   RSSHUB_BASE      - RSSHub 服务地址，例如 https://rsshub-xxxx.onrender.com
 *   WECHAT_COOKIE    - 微信网页版 Cookie（从 mp.weixin.qq.com 获取）
 *   MAX_ARTICLES     - 每个公众号最多保存文章数（默认 50）
 *
 * fakeid 说明：每个微信公众号有唯一的 fakeid（biz），
 * 可通过 mp.weixin.qq.com 搜索后从 URL 中获取，格式如：MzA3MjY0NTYwNg==
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');

const RSSHUB_BASE = (process.env.RSSHUB_BASE || '').replace(/\/$/, '');
const WECHAT_COOKIE = process.env.WECHAT_COOKIE || '';
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES || '50', 10);
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data-snapshot');

if (!RSSHUB_BASE) {
  console.error('❌ 缺少环境变量 RSSHUB_BASE，请配置 RSSHub 服务地址');
  process.exit(1);
}

/**
 * 公众号配置表
 * fakeid: 每个公众号在微信平台的唯一标识
 * 可通过以下方式获取：
 *   1. 电脑浏览器登录 https://mp.weixin.qq.com
 *   2. 搜索公众号名称
 *   3. 点击公众号后，查看 URL 中的 fakeid 参数
 *   格式示例: fakeid=MzA3MjY0NTYwNg==
 */
const ACCOUNT_CONFIG = {
  industry: [
    { name: '大厂日爆',         fakeid: 'MzI4NTEwMzYzMQ==' },
    { name: '天天开柒',         fakeid: 'MzUwMTU4NzIzNg==' },
    { name: '互联网坊间八卦',   fakeid: 'MzIyMjA5ODQwNA==' },
    { name: '申妈的朋友圈',     fakeid: 'MzIxMDY5MTU2MQ==' },
    { name: '字节范儿',         fakeid: 'MzA3MjY0NTYwNg==' },
    { name: '虎嗅APP',          fakeid: 'MTIyMjYwMTYwNA==' },
    { name: '晚点LatePost',     fakeid: 'MzIyNjkzNDA4OA==' },
    { name: '机器之心',         fakeid: 'MTQxMTA2MDExNA==' },
    { name: 'InfoQ',            fakeid: 'MzIzNDIxMzQyMg==' },
    { name: '量子位',           fakeid: 'MzIzNTY0Njc0MQ==' },
  ],
  bytedance: [
    { name: '字节跳动招聘',     fakeid: 'MzU3NDk2NDE2Mw==' },
    { name: '字节跳动Seed',     fakeid: 'MzI2NjI0MzI3Mg==' },
    { name: '字节跳动技术团队', fakeid: 'MzI4MzQ5MjYxNg==' },
    { name: '大厂青年',         fakeid: 'MzI4MTExMzQ2Mw==' },
  ],
  tencent: [
    { name: '腾讯招聘',         fakeid: 'MzI0NDg2OTc4Mg==' },
    { name: '腾讯文化',         fakeid: 'MjM5NTkyMDE4Mg==' },
    { name: '腾讯技术工程',     fakeid: 'MzI3NTU1NzIwNA==' },
  ],
  alibaba: [
    { name: '阿里巴巴集团招聘', fakeid: 'MzI2MTUxNTE3NA==' },
    { name: '阿里技术',         fakeid: 'MzIzMDA1NzYxMg==' },
  ],
  meituan: [
    { name: '美团招聘',         fakeid: 'MzI3NDczMDUyNA==' },
    { name: '美团技术团队',     fakeid: 'MzIwMDIwMTU0OA==' },
  ],
  xiaohongshu: [
    { name: '小红书招聘',       fakeid: 'MzI5NzQ4OTQ5NA==' },
    { name: '是小红书人啊',     fakeid: 'MzI4Nzg5NjMzNg==' },
    { name: '小红书技术REDtech',fakeid: 'MzI5MTU1ODE3OA==' },
  ],
  baidu: [
    { name: '百度招聘',         fakeid: 'MzA2NTI4OTA2Mg==' },
    { name: '百度',             fakeid: 'MjM5MDcwODE2OA==' },
    { name: '百度文心',         fakeid: 'MzI4MTUxNzUyMg==' },
  ],
};

const ALL_ACCOUNTS = Object.entries(ACCOUNT_CONFIG).flatMap(([company, accounts]) =>
  accounts.map(acc => ({ ...acc, company }))
);

// ============================================================
// HTTP 工具
// ============================================================
function fetchUrl(url, headers = {}, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = { headers, timeout };
    const req = mod.get(url, options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, headers, timeout).then(resolve).catch(reject);
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

async function fetchRss(url, cookie = '') {
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  const { status, body } = await fetchUrl(url, headers);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return parseStringPromise(body, { explicitArray: false });
}

// ============================================================
// 解析 RSS 条目为统一格式
// ============================================================
function parseItems(rssData, feedId) {
  const channel = rssData?.rss?.channel;
  if (!channel) return [];

  const rawItems = channel.item
    ? (Array.isArray(channel.item) ? channel.item : [channel.item])
    : [];

  return rawItems.slice(0, MAX_ARTICLES).map(item => {
    const link = (item.link || item.guid?._ || item.guid || '').trim();
    const pubDate = item.pubDate || item['dc:date'] || '';
    const publishTime = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
    const title = (item.title || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();

    return {
      id: link ? link.split('/').pop().split('?')[0] : String(publishTime),
      title,
      link,
      publishTime,
      cover: extractCover(item),
      feedId,
    };
  }).filter(a => a.title && a.publishTime > 0);
}

function extractCover(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  const desc = item.description || item['content:encoded'] || '';
  const match = typeof desc === 'string' && desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  console.log('🚀 开始拉取数据（RSSHub 模式）...');
  console.log(`📡 RSSHub 地址: ${RSSHUB_BASE}`);
  console.log(`🔑 微信 Cookie: ${WECHAT_COOKIE ? '已配置 (' + WECHAT_COOKIE.length + ' 字符)' : '❌ 未配置'}`);

  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  // 验证 RSSHub 服务可用性
  try {
    const { status } = await fetchUrl(`${RSSHUB_BASE}/`);
    console.log(`✅ RSSHub 服务可达 (HTTP ${status})`);
  } catch(e) {
    console.error(`❌ RSSHub 服务不可达: ${e.message}`);
    console.log('⚠️ 将继续尝试拉取数据...');
  }

  const feedsMeta = [];
  let totalArticles = 0;
  let successCount = 0;
  let failCount = 0;

  for (const account of ALL_ACCOUNTS) {
    const { name, fakeid, company } = account;

    // RSSHub 微信公众号路由
    // 格式: /wechat/mp/article/{fakeid}
    // 需要在 RSSHub 配置中设置 WECHAT_COOKIE
    const rssUrl = `${RSSHUB_BASE}/wechat/mp/article/${fakeid}`;

    try {
      console.log(`  📥 拉取 [${company}] ${name} ...`);
      const rssData = await fetchRss(rssUrl, WECHAT_COOKIE);
      const articles = parseItems(rssData, fakeid);

      if (articles.length === 0) {
        console.warn(`  ⚠️ ${name}: 未获取到文章（可能需要更新微信 Cookie）`);
      } else {
        console.log(`  ✅ ${name}: ${articles.length} 篇`);
      }

      const syncTime = Math.floor(Date.now() / 1000);
      feedsMeta.push({
        id: fakeid,
        name,
        company,
        cover: articles[0]?.cover || '',
        syncTime,
        updateTime: articles[0]?.publishTime || syncTime,
        articleCount: articles.length,
      });

      // 写入单个公众号文章文件
      fs.writeFileSync(
        path.join(SNAPSHOT_DIR, `${fakeid}.json`),
        JSON.stringify(articles, null, 2)
      );

      totalArticles += articles.length;
      successCount++;

      // 避免请求过快
      await sleep(800);

    } catch(e) {
      console.error(`  ❌ ${name} 拉取失败: ${e.message}`);
      failCount++;

      // 写入空数组避免前端报错
      const emptyFile = path.join(SNAPSHOT_DIR, `${fakeid}.json`);
      if (!fs.existsSync(emptyFile)) {
        fs.writeFileSync(emptyFile, JSON.stringify([], null, 2));
      }
    }
  }

  // 写入 feeds.json 总索引
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, 'feeds.json'),
    JSON.stringify(feedsMeta, null, 2)
  );

  console.log(`\n📊 拉取完成！`);
  console.log(`   ✅ 成功: ${successCount} 个账号，共 ${totalArticles} 篇文章`);
  console.log(`   ❌ 失败: ${failCount} 个账号`);
  console.log(`   📁 快照目录: ${SNAPSHOT_DIR}`);

  if (failCount > 0 && WECHAT_COOKIE === '') {
    console.log(`\n💡 提示：未配置 WECHAT_COOKIE，微信公众号文章无法获取。`);
    console.log(`   请按照 README 中的说明获取微信 Cookie 并配置到 GitHub Secrets。`);
  }
}

main().catch(e => {
  console.error('💥 拉取失败:', e);
  process.exit(1);
});
