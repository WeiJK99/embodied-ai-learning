# 密码解密私密文章

GitHub Pages 继续托管静态页面。私密文章的标题、正文和引用的本地配图/附件先在本机用 AES-256-GCM 加密，线上输入密码后才在浏览器内解密。密码通过 PBKDF2-SHA256（600,000 次迭代、独立随机盐）派生密钥；每次加密使用独立随机 IV。

## 首次配置

在项目根目录执行：

```sh
pnpm privacy:init
```

此命令生成随机密码，保存在被 Git 忽略的 `.env.private`，并启用 `.githooks` 中的提交/推送检查。请在本地打开此文件查看密码，妥善备份。也可将 `BLOG_PRIVATE_PASSWORD` 改成长且唯一的密码，至少 16 个字符；不在聊天、Markdown、仓库或 GitHub Actions 中填写密码。环境变量 `BLOG_PRIVATE_PASSWORD` 优先于文件。

已有自定义 Git hooks 时，初始化会停止而不覆盖配置；把 `node scripts/check-private-source.js` 和 `node scripts/check-private-source.js --push` 分别接到自己的 pre-commit / pre-push hook 中。

## 在 Markdown 设置

每篇私密文章使用独立目录，例如 `src/content/posts/my-private-note/index.md`：

```markdown
---
title: 只有自己看的笔记
published: 2026-11-24
upload: yes
access: private
draft: false
---

私密正文。

![配图](images/photo.png)
```

- `access: public`（默认）：公开文章。
- `access: private` + `upload: yes`：只提交加密文件，原始 Markdown 和目录中的文件留在本机。
- `upload: no`：不发布，包括密文；已有密文会在本地重新加密/构建时撤下，下次发布后线上生效。
- `draft: true`：不生成私密页面，也不上传私密明文。

私密目录只能有一篇文章，配图/附件全部放在该目录内。支持标准 Markdown、表格、代码块、KaTeX 数学公式和 Mermaid；不执行原始 HTML、MDX、Astro 组件或自定义指令。Obsidian 图片请使用标准 `![说明](images/file.png)` 写法。图片支持 PNG/JPEG/GIF/WebP/AVIF；不支持 SVG、远程图片或 `public/` 中的图片，这些文件无法由文章加密保护。普通相对附件链接会一并加密为浏览器下载文件，不支持 HTML、JS、SVG 或另一篇 Markdown 作为附件。普通外部超链接可正常使用。

## 预览与发布

```sh
pnpm encrypt-post
pnpm dev
```

点击导航“私密文章”，或打开 `/embodied-ai-learning/private/`，选择文章并输入本地密码。目录中只显示“私密文章 1/2/…”，真实标题、摘要、分类和标签均不公开。解锁后可“重新锁定”；刷新或离开页面需要再次输入密码。密码和解密结果不写入浏览器存储。

```sh
pnpm publish-post --dry-run
pnpm publish-post "更新私密笔记"
```

正式发布自动更新密文，只提交 `encrypted-posts/<随机编号>.json`，并撤下之前跟踪的原始文章及附件；本地文件保留。构建会自动更新本地密文。GitHub Actions 只用仓库中的密文生成锁定页面，不需要密码或私密原稿。普通公开文章的发布方式保持兼容。

首次使用需先提交本功能的脚本、页面、配置和 hooks，再发布文章；发布脚本会列出尚未提交的实现文件并停止。私密原稿不要用 `git add .` 提交。初始化的 hooks 会检查暂存区、当前原稿和待推送版本并拒绝明文；GitHub Actions 也会拒绝含私密明文的当前版本。手动跳过 hooks、使用其他客户端或 `--no-verify` 会绕过本地保护。

请备份 `.env.private`、`.private-posts/state.json` 和私密原稿。状态文件保存原稿与随机编号的对应关系（不上传）；丢失后重新加密会产生新编号，旧密文需要手动从 `encrypted-posts/` 移除。CI 没有原稿和状态文件，因此会保留已提交的密文。修改密码后重新发布会更新当前密文；之前下载的密文和 Git 历史中的旧版本仍可用旧密码解密。

## 边界

这是密码持有者可以解密的静态发布方式。别人能下载密文并尝试离线猜测密码，因此应使用初始化生成的随机密码。知道密码的人可以保存或转发解密内容，无法限制为某一个 GitHub 账号。

已经公开上传过的正文或图片，不能通过加密或删除当前文件收回；旧 Git 提交、旧部署和他人缓存仍可能保留明文。本功能不会改写公开 Git 历史。新私密文章从首次发布起就应设置 `access: private`。

验证：`node --test tests/private-posts.test.mjs tests/post-upload.test.mjs`，以及 `pnpm check`、`pnpm build`。
