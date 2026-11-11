# 博客日期与论文日期

博客优先使用 Markdown frontmatter 中的 `created`（笔记创建日期）排序和显示日期，最新在前。没有 `created` 的旧文章继续使用 `published`，无需批量修改。

论文阅读笔记示例：

```yaml
---
title: ACT 论文精读
published: 2023-04-23 # 论文发表日期
created: 2026-11-11   # 博客笔记创建日期，决定排序和博客显示日期
updated: 2026-11-12   # 可选：最近修订日期，不改变排序
---
```

首页、分类列表、归档分年及日期、上一篇/下一篇、文章页、RSS 和搜索引擎结构化数据均使用同一博客日期。同一天的文章按 slug 升序排列，保证顺序稳定。

`published` 仍为必填字段；普通文章将其填写为博客发布日期即可。论文发表日期仍保存在 Markdown 中，若需读者在网页上看到它，请在正文注明。

`pnpm new-post` 会自动写入当天的 `published` 和 `created`；手工复制论文笔记时，请检查 `created` 是实际创建博客笔记的日期。

修改排序代码后，首次发布需要提交代码变更；`pnpm publish-post` 仅自动暂存文章目录，不会自动暂存排序代码和模板。

只发布文章不会更新网站使用的日期规则：`src/content/config.ts` 必须接收 `created`，排序工具、列表和归档组件也必须随代码一起部署。核对 GitHub Actions 的 “Deploy to GitHub Pages” 成功后，再刷新线上页面；以文章已设置的 `created: 2026-11-11` 为例，归档应归入 2026 年并显示 `11-11`，而不是论文的 2023 或 2024 年。

回归检查：`node --experimental-strip-types --test tests/post-date.test.mjs`，然后执行 `pnpm build`。
