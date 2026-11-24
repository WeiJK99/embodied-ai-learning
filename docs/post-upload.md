# 用 Markdown 控制文章上传

在每篇 `.md` / `.mdx` 顶部的 YAML frontmatter 中添加 `upload`：

```yaml
---
title: 我的笔记
published: 2026-11-24
created: 2026-11-24
draft: false
upload: no
---

正文……
```

- `upload: yes`：运行 `pnpm publish-post` 时允许提交并上传。
- `upload: no`：保留本地，新文章不会上传；已提交发布的文章会在下次 `pnpm publish-post` 时从远程当前版本移除，本地 Markdown 和独立目录内的附件保留。`pnpm dev` 仍可预览，`pnpm build` 的文章页、列表、归档、分类、标签、RSS、站点地图和搜索均不包含它。
- 不填时默认为 `yes`，兼容已有文章；`pnpm new-post` 会显式生成 `upload: yes`。
- 同时支持 `upload: true` / `upload: false`；其他值会报错，避免拼写错误导致误传。请使用英文冒号。

需要发布时把 `no` 改成 `yes`，然后执行：

```sh
pnpm publish-post "更新笔记"
```

发布前可先查看清单，此命令不会构建、提交或推送：

```sh
pnpm publish-post --dry-run
```

将已上线文章改成 `no` 后，先运行上面的预览命令，应看到它位于 `Withdrawing` 清单。再运行正式发布命令，等待 GitHub Actions 部署成功后，线上旧页面才会撤下。切换开关本身不会立即改变网站。若查看的是 `localhost:4321`，这是本地开发预览，`no` 的文章仍显示是预期行为。

建议每篇带配图的笔记使用独立目录，例如 `src/content/posts/my-note/index.md` 和 `my-note/images/`。该目录中的附件随文章开关一起跳过，包括图片及 `_index.md` 等维护文件。若同一目录有多篇文章，只要其中一篇为 `no`，该目录共享的附件就会被跳过；请为不同上传状态的文章拆分目录。直接放在 `posts/` 根目录的单篇 Markdown 只控制自身，不控制共享附件。

`draft` 与 `upload` 分别控制是否生成公开页面、是否由发布脚本上传源文件。例如 `draft: true` 配合 `upload: yes` 可以将草稿备份到远程，但正式网站不显示它。

发布脚本使用临时 Git 索引提交允许上传的文章和需要撤下的文件，保留其他文件的暂存状态。撤下时只删除 Git 跟踪条目，文件本身仍留在本地并变为未跟踪文件；已暂存的同一文件也会移出索引，避免以后被误提交。若待推送的本地提交新增或修改了当前禁止上传的文件，或提交当时标为 `upload: no` 的文章及附件，脚本会停止并列出文件。撤下文章的纯删除提交可以正常重试推送。仅在后续提交中删除文件不能清除前面的历史版本。

此开关约束 `pnpm publish-post` 和网站正式构建。直接执行 `git add`、`git commit`、`git push` 仍遵循 Git 自身的行为，已撤下的本地文件也可能被手动重新添加。撤下会移除远程当前版本和对应页面，不改写已有 Git 历史。

首次启用或更新此功能时，需要先把发布脚本、内容配置、列表工具、新建文章模板和依赖变更一起提交；只提交文章不会更新网站代码。发布脚本检测到这些实现文件存在未提交改动时会停止，列出需要先提交的代码，避免本地和 GitHub Actions 使用不同规则。

验证：`node --test tests/post-upload.test.mjs`，然后运行 `pnpm build`。
