// test-rss-services.js — 测试多个免费微信RSS聚合服务
const https = require('https');
const http = require('http');

function fetchUrl(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Encoding': 'identity',
      }
    }, (res) => {
      const loc = res.headers.location;
      if ([301,302,307,308].includes(res.statusCode) && loc) {
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchUrl(next, timeout).then(resolve).catch(reject);
      }
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 5) {
    const block = m[1];
    const title = (block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                   block.match(/<title[^>]*>(.*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    if (title) items.push({ title: title.replace(/<[^>]+>/g,'').trim().substring(0,50), pubDate: pubDate.substring(0,16) });
  }
  return items;
}

// 测试账号和对应的 fakeid / 公众号ID
const testAccounts = [
  { name: '字节跳动技术团队', biz: 'MzI4MzQ5MjYxNg==',   wechatid: 'BytedanceTech' },
  { name: '字节跳动招聘',     biz: 'MzU3NDk2NDE2Mw==',   wechatid: 'ByteDance_Jobs' },
  { name: '美团技术团队',     biz: 'MzIwMDIwMTU0OA==',   wechatid: 'meituantech' },
  { name: '晚点LatePost',    biz: 'MzIyNjkzNDA4OA==',   wechatid: 'latepost' },
  { name: '虎嗅APP',         biz: 'MTIyMjYwMTYwNA==',   wechatid: 'huxiu_com' },
  { name: '量子位',           biz: 'MzIzNTY0Njc0MQ==',   wechatid: 'QbitAI' },
];

// RSS 服务构建器
const services = {
  'feeddd.org': (acc) => `https://feeddd.org/feeds/${acc.biz}`,
  'feeddd-wechat': (acc) => `https://feeddd.org/feeds/${acc.biz}/articles`,
  'rsshub-official': (acc) => `https://rsshub.app/wechat/mp/homepage/${acc.biz}/1`,
};

async function testService(serviceName, urlBuilder, accounts) {
  console.log(`\n=== ${serviceName} ===`);
  let success = 0;
  for (const acc of accounts) {
    const url = urlBuilder(acc);
    try {
      const { status, body } = await fetchUrl(url);
      const hasItems = body.includes('<item>') || body.includes('<entry>');
      if (status === 200 && hasItems) {
        const items = parseRssItems(body);
        console.log(`  ✅ ${acc.name}: ${items.length} 篇`);
        if (items[0]) console.log(`     最新: ${items[0].title}`);
        success++;
      } else {
        console.log(`  ❌ ${acc.name}: HTTP ${status} ${!hasItems ? '(无文章)' : ''}`);
        if (status === 200 && body.length < 500) console.log(`     内容: ${body.substring(0,100)}`);
      }
    } catch(e) {
      console.log(`  ❌ ${acc.name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`  覆盖率: ${success}/${accounts.length}`);
  return success;
}

async function main() {
  // 先测 feeddd.org
  await testService('feeddd.org (biz格式)', services['feeddd.org'], testAccounts);
  await testService('feeddd.org (articles格式)', services['feeddd-wechat'], testAccounts.slice(0,3));
}

main().catch(console.error);
