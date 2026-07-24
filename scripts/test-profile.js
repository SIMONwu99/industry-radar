// test-wechat-profile.js — 验证微信公众号主页抓取方案
const https = require('https');
const http = require('http');

function fetchUrl(url, headers = {}, timeout = 20000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.43(0x18002B2B) NetType/WIFI Language/zh_CN',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'identity',
        ...headers,
      }
    }, (res) => {
      const loc = res.headers.location;
      if ([301, 302, 307, 308].includes(res.statusCode) && loc) {
        const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
        return fetchUrl(next, headers, timeout, maxRedirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
  });
}

function cleanHtml(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

// 测试账号：字节跳动技术团队（已知 fakeid）
const testAccounts = [
  { name: '字节跳动技术团队', fakeid: 'MzI4MzQ5MjYxNg==' },
  { name: '字节跳动招聘',     fakeid: 'MzU3NDk2NDE2Mw==' },
  { name: '美团技术团队',     fakeid: 'MzIwMDIwMTU0OA==' },
];

async function fetchAccountArticles(fakeid, name) {
  // 方法1: 微信公众号主页 profile_ext（手机版接口）
  const url = `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(fakeid)}&scene=124#wechat_redirect`;
  
  console.log(`  请求: ${url.substring(0, 80)}`);
  const { status, body } = await fetchUrl(url);
  console.log(`  HTTP ${status}, 大小: ${body.length} bytes`);
  
  // 检查是否需要登录
  if (body.includes('请登录') || body.includes('login') || body.includes('scanQRCode')) {
    console.log('  ❌ 需要登录');
    return [];
  }
  
  // 尝试解析文章列表
  // 格式1: JSON 内嵌在页面
  const jsonMatch = body.match(/msgList\s*=\s*({[^<]+})/);
  if (jsonMatch) {
    try {
      const data = JSON.parse(jsonMatch[1]);
      const list = data.list || [];
      console.log(`  ✅ 解析到 ${list.length} 篇文章 (JSON格式)`);
      return list.slice(0, 3).map(item => ({
        title: item.app_msg_ext_info?.title || item.comm_msg_info?.content || '无标题',
        date: new Date((item.comm_msg_info?.datetime || 0) * 1000).toLocaleDateString('zh-CN'),
      }));
    } catch(e) {
      console.log('  JSON 解析失败:', e.message);
    }
  }
  
  // 格式2: HTML 文章列表
  const articleRe = /<h4[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h4>/g;
  let match, articles = [];
  while ((match = articleRe.exec(body)) !== null && articles.length < 5) {
    articles.push({ title: cleanHtml(match[1]) });
  }
  if (articles.length > 0) {
    console.log(`  ✅ 解析到 ${articles.length} 篇文章 (HTML格式)`);
    return articles;
  }
  
  // 检查内容
  if (body.includes('__biz') || body.includes('appmsg')) {
    console.log('  ⚠️  有数据但格式未识别，显示前200字符:');
    console.log('  ' + body.substring(0, 200).replace(/\n/g, ' '));
  } else {
    console.log('  ❌ 无法获取文章内容');
    console.log('  内容前100字符:', body.substring(0, 100));
  }
  
  return [];
}

async function main() {
  for (const acc of testAccounts) {
    console.log(`\n[测试] ${acc.name} (${acc.fakeid}):`);
    const articles = await fetchAccountArticles(acc.fakeid, acc.name);
    articles.forEach(a => console.log(`  📄 ${a.title?.substring(0, 50)} | ${a.date || ''}`));
    await new Promise(r => setTimeout(r, 2000));
  }
}

main().catch(console.error);
