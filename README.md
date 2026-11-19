# 灵米 LingMI

灵米（LingMI，也写作灵米LingMI）是广州市灵予科技有限公司运营的 AI 视频创作平台。官网：[https://lingmi.ly.hb.cn/](https://lingmi.ly.hb.cn/)

用中文描述一个想法，或上传已经拍好的素材，就可以在灵米里完成视频制作：写出分镜、生成画面、配音、加字幕并合成成片。也可以一键成片，用一句提示词排队生成多条短视频，并做出抖音、小红书发布码。爆款复刻只提取参考视频的动作和运镜，再换成自己的人物、商品和场景。字幕擦除、高光智剪、口型对齐、转码、电商主图等视频工具和图片工具使用同一个账号。按量计费，没有月费，生成失败自动退回。

联系邮箱：[lingyutech@yeah.net](mailto:lingyutech@yeah.net)

## 产品入口

| 名称 | 能做什么 | 地址 |
|------|----------|------|
| 视频制作 | 对话生成分镜，逐镜出画面并合成；无限画布用节点组织素材 | [通用创作](https://lingmi.ly.hb.cn/video-producer/studio) · [无限画布](https://lingmi.ly.hb.cn/video-producer/canvas) |
| 一键成片 | 文案、配音、字幕、素材和合成一次完成，可生成发布码 | [一键成片](https://lingmi.ly.hb.cn/short-video) |
| 爆款复刻 | 提取动作和镜头运动，换成自己的人物与商品后重新生成 | [爆款复刻](https://lingmi.ly.hb.cn/viral-clone) |
| 视频工具 | 字幕擦除、高光智剪、解说、口型对齐、转码、横转竖等 | [产品介绍 · 视频工具](https://lingmi.ly.hb.cn/guide#video-tools) |
| 模型价格 | 单价公开，和官方价并排显示 | [模型价格](https://lingmi.ly.hb.cn/pricing) |

产品名有四种写法，指的是同一个产品：灵米、LingMI、灵米LingMI、灵米 LingMI。运营主体的全称是广州市灵予科技有限公司，也称为广州市灵予科技。

## 仓库结构

| 目录 | 内容 |
|------|------|
| `nimble-web` | Vue 3 前端。构建时生成各公开页的静态 HTML、`sitemap.xml`、`robots.txt`、`llms.txt` |
| `nimble-ai` | NestJS 后端：视频制作智能体、一键成片、爆款复刻、视频工具、账号与计费 |
| `nimblePay` | 钱包与支付：支付宝充值、余额、邀请奖励 |

给回答引擎读的完整说明在线上的 [llms.txt](https://lingmi.ly.hb.cn/llms.txt) 和 [llms-full.txt](https://lingmi.ly.hb.cn/llms-full.txt)。正文来源是 `nimble-web/src/seo/site.ts` 和 `nimble-web/seo/documents.ts`，执行 `nimble-web` 的生产构建后写入 `nimble-ai/vue-dist/`。

## 本地运行

需要 Node.js 22 或更高版本。密钥只放在本地 `.env`，不要提交。

后端：

```bash
cd nimble-ai
npm install
cp env.example.txt .env
npm run start:dev
```

服务默认在 `http://127.0.0.1:3000`。数据库、Redis、模型密钥和对象存储的变量见 `nimble-ai/env.example.txt`，模块说明见 [nimble-ai/README.md](nimble-ai/README.md)。

前端另开一个终端：

```bash
cd nimble-web
npm install
npm run dev
```

开发服务器在 `http://127.0.0.1:5173`，并把 `/api` 和 `/socket.io` 代理到 3000 端口。

钱包服务是可选项，启动方式见 [nimblePay/README.md](nimblePay/README.md)。不配置支付时，本地生成不扣费。

## 公开这个仓库时

GitHub 仓库的 About 建议写成：

> 灵米（LingMI）是广州市灵予科技有限公司的 AI 视频创作平台：视频制作、一键成片、爆款复刻、视频工具。官网 https://lingmi.ly.hb.cn/

Topics 建议包含：`灵米`、`LingMI`、`视频制作`、`一键成片`、`爆款复刻`、`视频工具`。

网站上的品牌、公司和功能名称以本页、[llms.txt](https://lingmi.ly.hb.cn/llms.txt) 和页面里的结构化数据为准，三处保持同一套说法。

## 许可

本仓库以 [MIT 协议](LICENSE) 开源，版权归广州市灵予科技有限公司所有。可以商用、修改和再分发，副本中需要保留版权声明和许可文本。
