# 行业资讯雷达 v3

> 监控字节跳动、腾讯、阿里、美团、小红书、**百度** 及行业媒体动态的竞品情报看板
> 每天自动更新 3 次（10:00 / 14:00 / 20:00），支持前端按钮一键开关

---

## 📋 功能概览

- **资讯概览**：按公司分组展示最新文章卡片
- **资讯列表**：全量文章流，支持关键词搜索和快捷筛选
- **数据图表**：14天发文趋势 + 关键词热力表 + 词云
- **AI 资讯摘要**：DeepSeek 生成每日/每周结构化摘要（含「对快手的启示」）
- **自动更新开关**：前端点击即可开启/关闭定时自动更新

---

## 🚀 部署指南（约 30 分钟完成）

### 第一步：准备 WeWe RSS 服务

WeWe RSS 是一个开源的微信公众号 RSS 聚合工具，需要你自己部署一个实例。

**推荐部署方式（Cloudflare Workers，免费）：**

1. 访问 [WeWe RSS GitHub](https://github.com/cooderl/wewe-rss)
2. 按照文档部署到 Cloudflare Workers 或任意服务器
3. 部署完成后，在 WeWe RSS 管理后台**添加以下 27 个公众号**：

   **行业资讯（10个）：**
   大厂日爆、天天开柒、互联网坊间八卦、申妈的朋友圈、字节范儿、虎嗅APP、晚点LatePost、机器之心、InfoQ、量子位

   **字节跳动（4个）：**
   字节跳动招聘、字节跳动Seed、字节跳动技术团队、大厂青年

   **腾讯（3个）：**
   腾讯招聘、腾讯文化、腾讯技术工程

   **阿里（2个）：**
   阿里巴巴集团招聘、阿里技术

   **美团（2个）：**
   美团招聘、美团技术团队

   **小红书（3个）：**
   小红书招聘、是小红书人啊、小红书技术REDtech

   **百度（3个）：**
   百度招聘、百度、百度文心

4. 记录你的 WeWe RSS 服务地址，例如：`https://your-wewe-rss.workers.dev`

---

### 第二步：创建 GitHub 仓库

1. 登录 [github.com](https://github.com)，点击右上角 **+** → **New repository**
2. 仓库名填写：`industry-radar`
3. 选择 **Public**（Cloudflare Pages 免费版需要公开仓库）
4. 点击 **Create repository**
5. 将本项目所有文件上传到该仓库：
   - 点击 **Add file** → **Upload files**
   - 拖入整个 `industry-radar` 文件夹的所有内容
   - 提交（Commit changes）

---

### 第三步：获取 GitHub Personal Access Token

1. 登录 GitHub，点击右上角头像 → **Settings**
2. 左侧菜单最底部 → **Developer settings**
3. 点击 **Personal access tokens** → **Tokens (classic)**
4. 点击 **Generate new token (classic)**
5. 配置：
   - Note：`industry-radar`
   - Expiration：`No expiration`（或选 1 年）
   - 勾选 `repo`（整个 repo 权限）
6. 点击 **Generate token**，**立即复制保存**（只显示一次！）

---

### 第四步：获取 DeepSeek API Key

1. 访问 [platform.deepseek.com](https://platform.deepseek.com)
2. 注册/登录后点击 **API Keys** → **Create new API key**
3. 复制保存 API Key

---

### 第五步：在 GitHub 仓库配置 Secrets

1. 进入你的 `industry-radar` GitHub 仓库
2. 点击 **Settings** → **Secrets and variables** → **Actions**
3. 点击 **New repository secret**，依次添加以下 3 个：

   | Secret 名称 | 填写内容 |
   |------------|---------|
   | `WEWE_RSS_BASE` | 你的 WeWe RSS 地址，如 `https://your-wewe-rss.workers.dev` |
   | `DEEPSEEK_API_KEY` | 你的 DeepSeek API Key |
   | `GH_TOKEN` | 第三步获取的 GitHub Personal Access Token |

---

### 第六步：部署到 Cloudflare Pages

1. 访问 [pages.cloudflare.com](https://pages.cloudflare.com)
2. 登录后点击 **Create a project** → **Connect to Git**
3. 选择你的 GitHub 账号，选择 `industry-radar` 仓库
4. 构建设置：
   - Framework preset：`None`
   - Build command：**留空**
   - Build output directory：`/`（根目录）
5. 点击 **Save and Deploy**

**配置 Cloudflare Pages 环境变量（用于前端按钮控制自动更新）：**

1. 部署成功后，进入项目 → **Settings** → **Environment variables**
2. 添加以下 3 个变量（Production 环境）：

   | 变量名 | 填写内容 |
   |--------|---------|
   | `GH_TOKEN` | 同上，GitHub Personal Access Token |
   | `GH_OWNER` | 你的 GitHub 用户名 |
   | `GH_REPO` | `industry-radar` |

3. 点击 **Save**，然后 **重新部署**（Deployments → 最新部署 → Retry deploy）

---

### 第七步：手动触发第一次数据更新

1. 进入 GitHub 仓库 → **Actions** 标签
2. 左侧点击 **行业资讯雷达 - 自动数据更新**
3. 点击 **Run workflow** → **Run workflow**（强制更新）
4. 等待约 5-10 分钟，Actions 运行完成
5. 刷新 Cloudflare Pages 网站，数据即可显示

---

## ⚙️ 日常使用

### 自动更新
- 默认**已开启**自动更新，每天北京时间 10:00、14:00、20:00 自动拉取数据
- 页面右上角点击 **⏰ 关闭自动更新** 可暂停

### 手动同步
- 点击右上角 **🔄 同步于...** 按钮，立即触发一次数据拉取（需等待约 3-5 分钟生效）

---

## 🏗 项目结构

```
industry-radar/
├── index.html                          # 前端主页面
├── data-snapshot/                      # 数据快照（由 Actions 自动更新）
│   ├── feeds.json                      # 公众号列表
│   ├── ai-summary.json                 # AI 摘要数据
│   ├── auto-update-config.json         # 自动更新开关配置
│   └── {feedId}.json                   # 每个公众号的文章数据
├── scripts/
│   ├── fetch-data.js                   # 数据拉取脚本
│   ├── generate-summary.js             # AI 摘要生成脚本
│   └── package.json
├── functions/api/
│   ├── toggle-auto-update.js           # CF Pages Function：控制自动更新开关
│   └── trigger-sync.js                 # CF Pages Function：触发手动同步
├── .github/workflows/
│   └── update-data.yml                 # GitHub Actions 工作流
└── README.md
```

---

## 🔧 常见问题

**Q: Actions 运行失败怎么办？**
> 进入 GitHub Actions 查看日志，最常见原因是 WeWe RSS 服务地址不对，或公众号名称在 WeWe RSS 中不存在（需要先添加）。

**Q: 前端按钮点击后报错？**
> 检查 Cloudflare Pages 的环境变量是否正确配置了 `GH_TOKEN`、`GH_OWNER`、`GH_REPO`，并且 Token 有 `repo` 写权限。

**Q: 文章数据显示空白？**
> 先运行一次 GitHub Actions（手动触发），数据拉取完成后 Cloudflare Pages 会自动重新部署。

**Q: AI 摘要不生成？**
> 检查 `DEEPSEEK_API_KEY` 是否配置正确，DeepSeek 账户余额是否充足。
