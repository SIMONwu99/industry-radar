#!/usr/bin/env node
/**
 * fetch-data.js
 * 通过 WeWe RSS 拉取所有监测公众号的文章，
 * 生成 data-snapshot/feeds.json 和每个公众号的 data-snapshot/{feedId}.json
 *
 * 环境变量:
 *   WEWE_RSS_BASE  - WeWe RSS 服务的基础 URL，例如 https://your-wewe-rss.com
 *   MAX_ARTICLES   - 每个公众号最多保存多少篇文章（默认 100）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');

const WEWE_RSS_BASE = (process.env.WEWE_RSS_BASE || '').replace(/\/$/, '');
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES || '100', 10);
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data-snapshot');

if (!WEWE_RSS_BASE) {
  console.error('❌ 缺少环境变量 WEWE_RSS_BASE，请配置 WeWe RSS 服务地址');
  process.exit(1);
}

// 公众号配置：name 是 WeWe RSS 中的公众号名称，id 会从 RSS URL 中解析
// WeWe RSS feeds 列表 API: GET /feeds  -> 返回 [{id, name, ...}]
const ACCOUNT_CONFIG = {
  industry: [
    '大厂日爆', '天天开柒', '互联网坊间八卦', '申妈的朋友圈',
    '字节范儿', '虎嗅APP', '晚点LatePost', '机器之心', 'InfoQ', '量子位'
  ],
  bytedance: ['字节跳动招聘', '字节跳动Seed', '字节跳动技术团队', '大厂青年'],
  tencent:   ['腾讯招聘', '腾讯文化', '腾讯技术工程'],
  alibaba:   ['阿里巴巴集团招聘', '阿里技术'],
  meituan:   ['美团招聘', '美团技术团队'],
  xiaohongshu: ['小红书招聘', '是小红书人啊', '小红书技术REDtech'],
  baidu:     ['百度招聘', '百度', '百度文心'],
};

const ALL_ACCOUNTS = Object.values(ACCOUNT_CONFIG).flat();

// ============================================================
// HTTP 工具
// ============================================================
function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location, timeout).then(resolve).catch(reject);
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

async function fetchJson(url) {
  const { status, body } = await fetchUrl(url);
  if (status !== 200) throw new Error(`HTTP ${status}: ${url}`);
  return JSON.parse(body);
}

async function fetchRss(url) {
  const { status, body } = await fetchUrl(url);
  if (status !== 200) throw new Error(`HTTP ${status}: ${url}`);
  return parseStringPromise(body, { explicitArray: false });
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  console.log('🚀 开始拉取数据...');
  console.log(`📡 WeWe RSS 地址: ${WEWE_RSS_BASE}`);

  // 确保目录存在
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  // 1. 获取 WeWe RSS 中已有的 feeds 列表
  let remoteFeeds = [];
  try {
    const data = await fetchJson(`${WEWE_RSS_BASE}/feeds`);
    remoteFeeds = Array.isArray(data) ? data : (data.feeds || data.data || []);
    console.log(`📋 WeWe RSS 返回 ${remoteFeeds.length} 个 feeds`);
  } catch(e) {
    console.warn(`⚠️ 获取 feeds 列表失败: ${e.message}，将尝试逐个名称查询`);
  }

  // 2. 构建 name->id 映射
  const nameToFeed = {};
  remoteFeeds.forEach(f => {
    if (f.name) nameToFeed[f.name] = f;
  });

  // 3. 拉取每个公众号的文章
  const feedsMeta = [];
  const results = {};
  let totalArticles = 0;

  for (const accountName of ALL_ACCOUNTS) {
    let feedMeta = nameToFeed[accountName];

    if (!feedMeta) {
      console.warn(`⚠️ 未在 WeWe RSS 中找到公众号: ${accountName}，跳过`);
      continue;
    }

    const feedId = feedMeta.id || feedMeta.feedId;
    const rssUrl = `${WEWE_RSS_BASE}/feeds/${feedId}.xml`;

    try {
      console.log(`  📥 拉取 ${accountName} (${feedId})...`);
      const rssData = await fetchRss(rssUrl);
      const channel = rssData?.rss?.channel;
      if (!channel) {
        console.warn(`  ⚠️ ${accountName} RSS 格式异常`);
        continue;
      }

      const rawItems = channel.item
        ? (Array.isArray(channel.item) ? channel.item : [channel.item])
        : [];

      const articles = rawItems.slice(0, MAX_ARTICLES).map(item => {
        const link = item.link || item.guid?._ || item.guid || '';
        const pubDate = item.pubDate || '';
        const publishTime = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
        return {
          id: link.split('/').pop() || String(publishTime),
          title: (item.title || '').replace(/<[^>]+>/g, '').trim(),
          link: link.trim(),
          publishTime,
          cover: extractCover(item),
          feedId,
        };
      }).filter(a => a.title && a.publishTime > 0);

      results[feedId] = articles;
      totalArticles += articles.length;

      const syncTime = Math.floor(Date.now() / 1000);
      feedsMeta.push({
        id: feedId,
        name: accountName,
        cover: feedMeta.cover || '',
        syncTime,
        updateTime: articles[0]?.publishTime || syncTime,
      });

      console.log(`  ✅ ${accountName}: ${articles.length} 篇`);

      // 写入单个公众号文章文件
      fs.writeFileSync(
        path.join(SNAPSHOT_DIR, `${feedId}.json`),
        JSON.stringify(articles, null, 2)
      );

      // 避免请求过于频繁
      await sleep(500);

    } catch(e) {
      console.error(`  ❌ ${accountName} 拉取失败: ${e.message}`);
    }
  }

  // 4. 写入 feeds.json
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, 'feeds.json'),
    JSON.stringify(feedsMeta, null, 2)
  );

  console.log(`\n✅ 数据拉取完成！`);
  console.log(`   监测账号: ${feedsMeta.length} 个`);
  console.log(`   文章总量: ${totalArticles} 篇`);
  console.log(`   快照目录: ${SNAPSHOT_DIR}`);
}

function extractCover(item) {
  // 尝试从 enclosure 或 description 中提取图片
  if (item.enclosure?.url) return item.enclosure.url;
  const desc = item.description || item['content:encoded'] || '';
  const match = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : '';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('💥 拉取失败:', e);
  process.exit(1);
});
