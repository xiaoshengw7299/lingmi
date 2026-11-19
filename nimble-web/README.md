# nimble-web — 灵米（LingMI）前端

灵米（LingMI，也写作灵米LingMI）是广州市灵予科技有限公司运营的 AI 视频创作平台，官网 [https://lingmi.ly.hb.cn/](https://lingmi.ly.hb.cn/)。本目录是它的 Vue 3 前端，包含视频制作、一键成片、爆款复刻和视频工具。仓库说明见 [../README.md](../README.md)。

## 本地运行

```bash
npm install
npm run dev
```

开发服务器在 `http://127.0.0.1:5173`，`/api` 和 `/socket.io` 代理到本机 `3000` 端口的 `nimble-ai`。

```bash
npm run build
```

生产构建会做类型检查，并把静态资源写到 `../nimble-ai/vue-dist`。

## 搜索与回答引擎用的文案

这些文件决定公开页的标题、摘要、静态 HTML 和结构化数据。改品牌名、公司名或功能介绍时，改这里，不要在各个页面里各写一份。

| 文件 | 作用 |
|------|------|
| `src/seo/site.ts` | 官网地址、品牌名「灵米 LingMI」、公司名「广州市灵予科技有限公司」、各页标题和摘要、首页常见问题 |
| `src/seo/schema.ts` | Organization、WebSite、SoftwareApplication 和 FAQ 的结构化数据。别名包含 LingMI、灵米LingMI |
| `seo/documents.ts` | 不执行 JavaScript 时能读到的页面正文，以及 `robots.txt`、`sitemap.xml`、`llms.txt`、`llms-full.txt` |
| `seo/plugin.ts` | 生产构建结束时把上面的文件写进输出目录 |

线上机器可读说明：[https://lingmi.ly.hb.cn/llms.txt](https://lingmi.ly.hb.cn/llms.txt)
