// test-mp-api.js — 测试微信公众号后台 API
// 使用你的 Cookie + Token 直接调用 appmsgpublish 接口
const https = require('https');

const COOKIE = 'rewardsn=; wxtokenkey=777; ua_id=4LeDSf5Nxn6HIywuAAAAAOvtRnykL5S609MU2pOw1Xw=; wxuin=78742835242612; cert=ilo5hs7rhlzUKdiujsmRoV8vlc9foW2C; poc_sid=HHLxF2qj8yoYSOCiunVCzG4tE3DjQH4PplJnxRgN; uuid=26370358d4c54409bb4a6f5baac810f3; slave_bizuin=3701314729; data_bizuin=3701314729; bizuin=3701314729; data_ticket=FvD/S6nUPULhkLdkzhZyuFAuMYEuIRNyngkAmSn6sbLOP+n+FPOVmX1hD/jSGIJQ; slave_sid=OEZtQVdNUmN5UHJvaHBNdXV6QVhleEdjQk8yZzV1c1hTdUlMNk0xS3ZoTnZsYzd4UzRkcl9DWk9GUml4NVVNNGpYdEVBTHl4SDBpMmNnU0xjMm5ZUXhtb2t5czFWejdvdVRudllISHdhZ2NOWXVfYWt3ZHFQSEVKaWQzOVFoSUxZbUNqaTZwSU42S0k1V3Ix; slave_user=gh_204463ae38e6; xid=3911c72eda0eecf8c45e953f0686cb5e; mm_lang=zh_CN';
const TOKEN = '1582651552';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 15000,
      headers: {
        'Cookie': COOKIE,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://mp.weixin.qq.com/',
        'X-Requested-With': 'XMLHttpRequest',
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, data: null, raw: data.substring(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  // 方法1: searchbiz API（搜索公众号，获取 fakeid）
  console.log('=== 测试 searchbiz API ===');
  const query = encodeURIComponent('字节跳动招聘');
  const url1 = `https://mp.weixin.qq.com/cgi-bin/searchbiz?action=search_biz&begin=0&count=5&query=${query}&token=${TOKEN}&lang=zh_CN&f=json&ajax=1`;
  const res1 = await fetchJson(url1);
  console.log('HTTP:', res1.status);
  if (res1.data) {
    const ret = res1.data.base_resp?.ret;
    console.log('ret:', ret, '| err_msg:', res1.data.base_resp?.err_msg);
    if (ret === 0) {
      const list = res1.data.list || [];
      console.log('搜索结果:', list.length, '个');
      list.forEach(item => console.log(`  - ${item.nickname} | fakeid: ${item.fakeid}`));
    }
  } else {
    console.log('原始响应:', res1.raw);
  }

  await new Promise(r => setTimeout(r, 1000));

  // 方法2: appmsgpublish API（获取文章发布列表）
  console.log('\n=== 测试 appmsgpublish API ===');
  const fakeid = 'MzU3NDk2NDE2Mw=='; // 字节跳动招聘
  const url2 = `https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=selfpublish&search_field=null&begin=0&count=10&fakeid=${encodeURIComponent(fakeid)}&type=9&free_publish_type=1&sub_action=list_ex&token=${TOKEN}&lang=zh_CN&f=json&ajax=1`;
  const res2 = await fetchJson(url2);
  console.log('HTTP:', res2.status);
  if (res2.data) {
    const ret = res2.data.base_resp?.ret;
    console.log('ret:', ret, '| err_msg:', res2.data.base_resp?.err_msg);
    if (ret === 0) {
      const list = res2.data.publish_page?.publish_list || [];
      console.log('文章数:', list.length);
      list.slice(0, 3).forEach(item => {
        const article = item.publish_info?.appmsgex?.[0] || {};
        console.log(`  📄 ${(article.title || '').substring(0, 50)}`);
      });
    }
  } else {
    console.log('原始响应:', res2.raw);
  }
}

main().catch(console.error);
