#!/usr/bin/env node
/**
 * generate-summary.js
 * 读取 data-snapshot/ 中的文章数据，调用 DeepSeek API
 * 生成每日/每周的公司动态 AI 摘要，写入 ai-summary.json
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY  - DeepSeek API Key
 *   DEEPSEEK_MODEL    - 模型名称（默认 deepseek-chat）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data-snapshot');

if (!DEEPSEEK_API_KEY) {
  console.error('❌ 缺少环境变量 DEEPSEEK_API_KEY');
  process.exit(1);
}

const COMPANIES = {
  industry:    { label: '行业资讯', accounts: ['大厂日爆','天天开柒','互联网坊间八卦','申妈的朋友圈','字节范儿','虎嗅APP','晚点LatePost','机器之心','InfoQ','量子位'] },
  bytedance:   { label: '字节跳动', accounts: ['字节跳动招聘','字节跳动Seed','字节跳动技术团队','大厂青年'] },
  tencent:     { label: '腾讯',     accounts: ['腾讯招聘','腾讯文化','腾讯技术工程'] },
  alibaba:     { label: '阿里',     accounts: ['阿里巴巴集团招聘','阿里技术'] },
  meituan:     { label: '美团',     accounts: ['美团招聘','美团技术团队'] },
  xiaohongshu: { label: '小红书',   accounts: ['小红书招聘','是小红书人啊','小红书技术REDtech'] },
  baidu:       { label: '百度',     accounts: ['百度招聘','百度','百度文心'] },
};

// ============================================================
// DeepSeek API 调用
// ============================================================
function callDeepSeek(messages, maxTokens = 2000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.choices?.[0]?.message?.content || '');
        } catch(e) {
          reject(new Error('解析 API 响应失败: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek API 超时')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ============================================================
// 生成单个公司的摘要
// ============================================================
async function generateCompanySummary(companyLabel, articles) {
  if (articles.length === 0) return null;

  const articleList = articles.slice(0, 30).map((a, i) =>
    `${i+1}. [${a.feedName}] ${a.title}`
  ).join('\n');

  const prompt = `你是一位互联网行业分析师，正在为快手内部团队撰写竞品情报摘要。

以下是【${companyLabel}】在近期发布的文章标题列表：

${articleList}

请基于这些文章标题，生成一份结构化的竞品动态摘要报告。要求：
1. 分析客观，不夸大不缩小
2. 聚焦对快手有参考价值的信息
3. 按以下固定结构输出，使用 JSON 格式：

{
  "sections": [
    {
      "title": "今日热点事件",
      "content": "（用简洁的1-3点概括本期最重要的动态，每点以<li>开头）"
    },
    {
      "title": "招聘动态",
      "content": "（概括招聘趋势，校招/社招/实习方向，用<ul><li>格式）"
    },
    {
      "title": "技术进展",
      "content": "（概括技术、产品、AI相关动态，用<ul><li>格式）"
    },
    {
      "title": "战略动向",
      "content": "（概括战略方向、组织架构、商业化动向，用<ul><li>格式）"
    },
    {
      "title": "对快手的启示",
      "content": "（2-3条对快手有参考价值的洞察，用<ul><li>格式）"
    }
  ]
}

只输出 JSON，不要其他内容。`;

  try {
    const content = await callDeepSeek([
      { role: 'system', content: '你是互联网行业竞品情报分析师，专注为快手提供客观准确的竞品分析。' },
      { role: 'user', content: prompt }
    ]);

    // 解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回格式非 JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  } catch(e) {
    console.error(`  ⚠️ ${companyLabel} 摘要生成失败: ${e.message}`);
    return {
      sections: [
        { title: '摘要', content: `<p>摘要生成失败，请稍后重试。错误: ${e.message}</p>` }
      ]
    };
  }
}

// ============================================================
// 主逻辑
// ============================================================
async function main() {
  console.log('🤖 开始生成 AI 摘要...');

  // 1. 读取 feeds.json
  const feedsPath = path.join(SNAPSHOT_DIR, 'feeds.json');
  if (!fs.existsSync(feedsPath)) {
    console.error('❌ feeds.json 不存在，请先运行 fetch-data.js');
    process.exit(1);
  }
  const feeds = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
  const feedNameToId = {};
  feeds.forEach(f => { feedNameToId[f.name] = f.id; });

  // 2. 加载所有文章
  const now = Date.now();
  const oneDayAgo = now - 24 * 3600 * 1000;
  const oneWeekAgo = now - 7 * 24 * 3600 * 1000;

  const allArticles = [];
  for (const feed of feeds) {
    const filePath = path.join(SNAPSHOT_DIR, `${feed.id}.json`);
    if (!fs.existsSync(filePath)) continue;
    const articles = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    articles.forEach(a => allArticles.push({ ...a, feedName: feed.name }));
  }

  // 3. 获取公司名到文章的映射
  function getArticlesByCompany(company, since) {
    const accounts = COMPANIES[company]?.accounts || [];
    return allArticles.filter(a =>
      accounts.includes(a.feedName) &&
      a.publishTime * 1000 >= since
    );
  }

  // 4. 读取或初始化已有摘要
  const summaryPath = path.join(SNAPSHOT_DIR, 'ai-summary.json');
  let summary = { daily: {}, weekly: {} };
  if (fs.existsSync(summaryPath)) {
    try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); }
    catch(e) { console.warn('⚠️ 读取已有摘要失败，重新生成'); }
  }

  // 5. 生成今日摘要
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n📅 生成 ${today} 每日摘要...`);
  if (!summary.daily[today]) summary.daily[today] = [];

  const dailySummaries = [];
  for (const [key, cfg] of Object.entries(COMPANIES)) {
    const arts = getArticlesByCompany(key, oneDayAgo);
    console.log(`  🏢 ${cfg.label}: ${arts.length} 篇文章`);
    if (arts.length === 0) continue;

    const result = await generateCompanySummary(cfg.label, arts);
    if (result) {
      dailySummaries.push({
        company: cfg.label,
        generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }).slice(0, 16),
        articleCount: arts.length,
        ...result,
      });
      console.log(`  ✅ ${cfg.label} 摘要生成完成`);
    }
    await sleep(1000); // 避免 API 限流
  }
  summary.daily[today] = dailySummaries;

  // 6. 生成本周摘要（每周一生成，或强制生成）
  const dayOfWeek = new Date().getDay();
  const weekKey = getWeekKey();
  if (dayOfWeek === 1 || !summary.weekly[weekKey]) {
    console.log(`\n📅 生成本周 (${weekKey}) 摘要...`);
    const weeklySummaries = [];
    for (const [key, cfg] of Object.entries(COMPANIES)) {
      const arts = getArticlesByCompany(key, oneWeekAgo);
      if (arts.length === 0) continue;
      const result = await generateCompanySummary(cfg.label, arts);
      if (result) {
        weeklySummaries.push({
          company: cfg.label,
          generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }).slice(0, 16),
          articleCount: arts.length,
          ...result,
        });
      }
      await sleep(1000);
    }
    summary.weekly[weekKey] = weeklySummaries;
  }

  // 7. 清理超过 30 天的每日摘要、超过 12 周的周摘要
  const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  for (const date of Object.keys(summary.daily)) {
    if (date < thirtyDaysAgo) delete summary.daily[date];
  }
  const twelveWeeksAgo = getWeekKey(-12);
  for (const week of Object.keys(summary.weekly)) {
    if (week < twelveWeeksAgo) delete summary.weekly[week];
  }

  // 8. 写入文件
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\n✅ AI 摘要生成完成！写入 ${summaryPath}`);
}

function getWeekKey(offsetWeeks = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetWeeks * 7);
  const year = d.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('💥 AI 摘要生成失败:', e);
  process.exit(1);
});
