/**
 * Cloudflare Pages Function: /api/trigger-sync
 * 接收前端手动同步请求，通过 GitHub API 触发 workflow_dispatch
 */

export async function onRequestPost({ env }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  const GH_TOKEN = env.GH_TOKEN;
  const GH_OWNER = env.GH_OWNER;
  const GH_REPO  = env.GH_REPO;

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return new Response(JSON.stringify({ success: false, error: 'GitHub 环境变量未配置' }), {
      status: 500, headers: corsHeaders
    });
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/update-data.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'industry-radar-cfpages',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { force: 'true' } }),
      }
    );

    if (res.status === 204) {
      return new Response(JSON.stringify({ success: true, message: '同步任务已触发' }), { headers: corsHeaders });
    } else {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
  } catch(e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: corsHeaders
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
  });
}
