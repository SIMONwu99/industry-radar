/**
 * Cloudflare Pages Function: /api/toggle-auto-update
 * 接收前端的开关请求，通过 GitHub API 更新 data-snapshot/auto-update-config.json
 *
 * 环境变量（在 Cloudflare Pages 项目设置中配置）:
 *   GH_TOKEN       - GitHub Personal Access Token（需要 repo write 权限）
 *   GH_OWNER       - GitHub 用户名，例如 your-github-username
 *   GH_REPO        - 仓库名，例如 industry-radar
 */

export async function onRequestPost({ request, env }) {
  // CORS 预检
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // 解析请求体
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: '请求体解析失败' }), {
      status: 400, headers: corsHeaders
    });
  }

  const { enabled } = body;
  if (typeof enabled !== 'boolean') {
    return new Response(JSON.stringify({ success: false, error: '参数 enabled 必须为布尔值' }), {
      status: 400, headers: corsHeaders
    });
  }

  const GH_TOKEN = env.GH_TOKEN;
  const GH_OWNER = env.GH_OWNER;
  const GH_REPO  = env.GH_REPO;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Cloudflare Pages 环境变量未配置（GH_TOKEN / GH_OWNER / GH_REPO）'
    }), { status: 500, headers: corsHeaders });
  }

  const FILE_PATH = 'data-snapshot/auto-update-config.json';
  const API_BASE = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${FILE_PATH}`;
  const HEADERS = {
    'Authorization': `token ${GH_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'industry-radar-cfpages',
    'Content-Type': 'application/json',
  };

  try {
    // 1. 获取当前文件内容和 SHA（更新文件需要 SHA）
    let sha = null;
    const getRes = await fetch(API_BASE, { headers: HEADERS });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    } else if (getRes.status !== 404) {
      const err = await getRes.text();
      throw new Error(`获取文件失败: HTTP ${getRes.status} - ${err.slice(0, 200)}`);
    }

    // 2. 构建新配置内容
    const config = {
      enabled,
      updatedAt: new Date().toISOString(),
      updatedBy: 'frontend-toggle',
      schedule: enabled ? ['10:00', '14:00', '20:00'] : [],
    };
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(config, null, 2))));

    // 3. 提交文件（创建或更新）
    const putBody = {
      message: `chore: ${enabled ? '开启' : '关闭'}自动更新 [frontend toggle]`,
      content,
      committer: { name: 'Industry Radar Bot', email: 'bot@industry-radar.com' },
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(API_BASE, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const err = await putRes.text();
      throw new Error(`更新文件失败: HTTP ${putRes.status} - ${err.slice(0, 300)}`);
    }

    return new Response(JSON.stringify({
      success: true,
      enabled,
      message: enabled ? '自动更新已开启（每天 10:00、14:00、20:00）' : '自动更新已关闭',
    }), { headers: corsHeaders });

  } catch(e) {
    console.error('toggle-auto-update error:', e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
