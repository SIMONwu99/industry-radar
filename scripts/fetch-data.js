#!/usr/bin/env node
/**
 * fetch-data.js — v3.0 (微信公众号平台 API 直调版)
 *
 * 直接调用 mp.weixin.qq.com 的后台接口拉取公众号文章。
 * 不需要 RSSHub，直接用微信网页版 Cookie 即可。
 *
 * 环境变量:
 *   WECHAT_COOKIE   - 从 mp.weixin.qq.com 获取的完整 Cookie 字符串
 *   WECHAT_TOKEN    - mp.weixin.qq.com 页面里的 token 参数（从 URL 中获取）
 *   MAX_ARTICLES    - 每个公众号最多保存文章数（默认 20）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const WECHAT_COOKIE = process.env.WECHAT_COOKIE || '';
const WECHAT_TOKEN  = process.env.WECHAT_TOKEN  || '';
const MAX_ARTICLES  = parseInt(process.env.MAX_ARTICLES || '20', 10);
const SNAPSHOT_DIR  = path.join(__dirname, '..', 'data-snapshot');

// 从 Cookie 里解析 token（如果没有单独设置的话）
function extractTokenFromCookie(cookie) {
  // token 通常不在 Cookie 里，需要从 mp.weixin.qq.com 登录后的 URL 参数里取
  // 格式: https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=XXXXXXXX
  return WECHAT_TOKEN || '';
}

/**
 * 公众号配置表
 * fakeid: 公众号唯一标识（也叫 biz 或 __biz）
 *
 * 获取方式：
 * 1. 登录 mp.weixin.qq.com
 * 2. 在 URL 中找 token 参数（记下来配置到 WECHAT_TOKEN）
 * 3. 在搜索框搜索公众号名称
 * 4. 点击公众号，URL 里的 __biz= 后面的就是 fakeid
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
function fetchUrl(url, options = {}, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const reqOptions = {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://mp.weixin.qq.com/',
        ...options.headers,
      },
    };
    const req = mod.get(url, reqOptions, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, options, timeout).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.on('error', reject);
  });
}

async function fetchJson(url, cookie) {
  const { status, body } = await fetchUrl(url, {
    headers: { 'Cookie': cookie }
  });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return JSON.parse(body);
}

// ============================================================
// 获取 token（从微信公众号平台页面）
// ============================================================
async function getToken(cookie) {
  if (WECHAT_TOKEN) {
    console.log(`🔑 使用配置的 Token: ${WECHAT_TOKEN}`);
    return WECHAT_TOKEN;
  }

  try {
    const { status, body } = await fetchUrl('https://mp.weixin.qq.com/', {
      headers: { 'Cookie': cookie }
    });

    // 从重定向 URL 或页面内容中提取 token
    const tokenMatch = body.match(/token=(\d+)/);
    if (tokenMatch) {
      console.log(`🔑 自动获取 Token: ${tokenMatch[1]}`);
      return tokenMatch[1];
    }

    // 从页面 JS 变量中提取
    const tokenMatch2 = body.match(/"token":(\d+)/);
    if (tokenMatch2) {
      console.log(`🔑 从页面获取 Token: ${tokenMatch2[1]}`);
      return tokenMatch2[1];
    }

    console.warn('⚠️  无法自动获取 Token，请手动配置 WECHAT_TOKEN 环境变量');
    return '';
  } catch(e) {
    console.error(`❌ 获取 Token 失败: ${e.message}`);
    return '';
  }
}

// ============================================================
// 搜索公众号获取 fakeid（备用方法）
// ============================================================
async function searchAccount(name, cookie, token) {
  if (!token) return null;
  try {
    const url = `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&begin=0&count=5&query=${encodeURIComponent(name)}&token=${token}&lang=zh_CN&f=json&ajax=1`;
    const data = await fetchJson(url, cookie);
    if (data.base_resp?.ret === 0 && data.list?.length > 0) {
      return data.list[0].fakeid;
    }
  } catch(e) {
    console.warn(`  ⚠️ 搜索 ${name} 失败: ${e.message}`);
  }
  return null;
}

// ============================================================
// 获取公众号文章列表
// ============================================================
async function fetchArticles(fakeid, name, cookie, token) {
  if (!token) {
    throw new Error('缺少 Token，请配置 WECHAT_TOKEN 环境变量');
  }

  const url = `https://mp.weixin.qq.com/cgi-bin/appmsg?action=list_ex&begin=0&count=${MAX_ARTICLES}&fakeid=${encodeURIComponent(fakeid)}&type=9&query=&token=${token}&lang=zh_CN&f=json&ajax=1`;

  const data = await fetchJson(url, cookie);

  if (data.base_resp?.ret !== 0) {
    const errMsg = data.base_resp?.err_msg || JSON.stringify(data.base_resp);
    throw new Error(`API 错误: ret=${data.base_resp?.ret} msg=${errMsg}`);
  }

  const appMsgList = data.app_msg_list || [];
  return appMsgList.map(item => ({
    id: String(item.aid || item.appmsgid || ''),
    title: (item.title || '').trim(),
    link: item.link || `https://mp.weixin.qq.com/s?__biz=${fakeid}&mid=${item.appmsgid}&idx=1`,
    publishTime: item.update_time || item.create_time || 0,
    cover: item.cover || item.thumb_url || '',
    digest: (item.digest || '').trim(),
    feedId: fakeid,
  })).filter(a => a.title && a.publishTime > 0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  console.log('🚀 开始拉取数据（微信公众号 API 直调版 v3.0）...');
  console.log(`🔑 Cookie: ${WECHAT_COOKIE ? '已配置 (' + WECHAT_COOKIE.length + ' 字符)' : '❌ 未配置'}`);

  if (!WECHAT_COOKIE) {
    console.error('❌ 缺少 WECHAT_COOKIE，无法拉取数据');
    console.error('   请按照 README 的说明获取 Cookie 并配置到 GitHub Secrets');
    process.exit(1);
  }

  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  // 获取 token
  const token = await getToken(WECHAT_COOKIE);
  if (!token) {
    console.error('❌ 无法获取 Token');
    console.error('   请登录 mp.weixin.qq.com 后从 URL 里复制 token 参数');
    console.error('   URL 格式: https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=XXXXXXXX');
    console.error('   然后配置到 GitHub Secrets: WECHAT_TOKEN = XXXXXXXX（只要数字部分）');
    process.exit(1);
  }

  const feedsMeta = [];
  let totalArticles = 0;
  let successCount = 0;
  let failCount = 0;

  for (const account of ALL_ACCOUNTS) {
    const { name, fakeid, company } = account;

    try {
      console.log(`  📥 拉取 [${company}] ${name} (${fakeid.substring(0, 8)}...)...`);
      const articles = await fetchArticles(fakeid, name, WECHAT_COOKIE, token);

      if (articles.length === 0) {
        console.warn(`  ⚠️ ${name}: 未获取到文章（fakeid 可能不正确）`);
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

      fs.writeFileSync(
        path.join(SNAPSHOT_DIR, `${fakeid}.json`),
        JSON.stringify(articles, null, 2)
      );

      totalArticles += articles.length;
      successCount++;

      // 避免触发频率限制（微信 API 比较敏感）
      await sleep(1500);

    } catch(e) {
      console.error(`  ❌ ${name} 拉取失败: ${e.message}`);
      failCount++;

      // 写入空数组，避免前端报错
      const emptyFile = path.join(SNAPSHOT_DIR, `${fakeid}.json`);
      if (!fs.existsSync(emptyFile)) {
        fs.writeFileSync(emptyFile, JSON.stringify([], null, 2));
      }

      // Token 失效时提前终止
      if (e.message.includes('ret=') && e.message.includes('-1')) {
        console.error('\n⚠️  Cookie 或 Token 已失效，请重新获取！');
        console.error('   1. 重新登录 mp.weixin.qq.com');
        console.error('   2. 更新 GitHub Secrets 中的 WECHAT_COOKIE 和 WECHAT_TOKEN');
        break;
      }
    }
  }

  // 写入 feeds.json 总索引
  fs.writeFileSync(
    path.join(SNAPSHOT_DIR, 'feeds.json'),
    JSON.stringify(feedsMeta, null, 2)
  );

  console.log(`\n📊 数据拉取完成！`);
  console.log(`   ✅ 成功: ${successCount} 个账号，共 ${totalArticles} 篇文章`);
  console.log(`   ❌ 失败: ${failCount} 个账号`);
}

main().catch(e => {
  console.error('💥 拉取失败:', e);
  process.exit(1);
});
