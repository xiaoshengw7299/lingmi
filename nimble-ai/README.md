# nimble-ai — 灵米（LingMI）AI 视频创作后端

> 灵米（LingMI，也写作灵米LingMI）是广州市灵予科技有限公司运营的 AI 视频创作平台，官网 [https://lingmi.ly.hb.cn/](https://lingmi.ly.hb.cn/)。本目录是它的后端。

基于 NestJS + Vercel AI SDK v7 + 模型平台 API 构建：视频制作智能体、一键成片、爆款复刻、视频工具，以及账号、按量计费与用户中心。产品名称和给搜索引擎、回答引擎使用的说明见仓库根目录 [README](../README.md)。

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       Agent Service                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────────────┐  ┌───────────┐  │
│  │ AgentSpace   │  │    Tool Registry     │  │  Skills   │  │
│  │ Loader       │  │  tools/ 自动扫描     │  │  技能库   │  │
│  └──────┬───────┘  └──────────┬───────────┘  └─────┬─────┘  │
│         └─────────────────────┼─────────────────────┘       │
│                               ▼                             │
│           ┌──────────────────────────────────┐              │
│           │      System Prompt Builder       │              │
│           │  身份/工具列表/技能/上下文/时区   │              │
│           └──────────────┬───────────────────┘              │
│                          ▼                                  │
│           ┌──────────────────────────────────┐              │
│           │  LLM Provider (模型平台API)       │              │
│           │  ToolLoopAgent 对话循环           │              │
│           └──────────────┬───────────────────┘              │
│                          ▼                                  │
│           ┌──────────────────────────────────┐              │
│           │    Content Block Collector       │              │
│           │  text / think / process / bi     │              │
│           └──────────────────────────────────┘              │
│                                                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐    │
│  │ PostgreSQL │  │   Redis    │  │    AI Logger       │    │
│  │ 会话+消息  │  │ 历史消息缓存│  │  JSONL 结构化日志  │    │
│  └────────────┘  └────────────┘  └────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 核心流程

```
用户提问
  → 加载 Agent 空间配置（AGENT.md）
  → 加载会话历史（Redis → DB）
  → 构建 System Prompt（身份 + 工具列表 + 技能 + 时区）
  → ToolLoopAgent 驱动 LLM 推理（最多 10 轮）
    ├─ 直接回复文本
    ├─ 调用内置工具（read / memory / skill_manage）
    └─ 调用业务工具（generate_storyboard：生成分镜脚本并落库）
  → ContentBlock 收集（text / think / process / bi）
  → SSE 推送 UI Message Stream 协议 → 保存消息
  → 每步 LLM 调用写入 AI 日志（prompt + response）
```

### 目录结构

```
nimble-ai/
├── src/modules/agent/
│   ├── agent.controller.ts       # HTTP API（chat / models / sessions / logs）
│   ├── agent.service.ts          # 对话循环、工具调用、历史管理
│   ├── agent.module.ts           # 模块注册
│   ├── agent-space/
│   │   └── agent-space.loader.ts # 加载 ai/agents/*/AGENT.md（人设 + 可选默认模型）
│   ├── providers/
│   │   └── model-policy.service.ts # 模型白名单
│   ├── tools/
│   │   ├── builtin/              # read（受限）/ memory / skill_manage
│   │   ├── video/                # generate_storyboard（分镜脚本）
│   │   ├── tool.define.ts        # ToolDef 接口 + toolOk/toolFail/toolBi 辅助函数
│   │   ├── tool.registry.ts      # 工具注册中心（tag 过滤）
│   │   └── index.ts              # 目录自动扫描注册（新增 *.tool.ts 即生效，无需手动登记）
│   ├── skills/                   # SkillLoader（扫描 ai/skills/*/SKILL.md + ai/_users/<userId>/skills/）
│   ├── memory/                   # MemoryService（按 userId 隔离的持久记忆，文件存储）
│   ├── prompt/                   # SystemPromptBuilder
│   ├── content-block/            # ContentBlockCollector（流式解析）
│   └── logger/                   # AILoggerService（JSONL 日志）
├── ai/
│   ├── agents/                   # 智能体空间定义（当前只有 video-producer）
│   ├── skills/                   # 全局技能定义（每个子目录一个 SKILL.md，人工维护）
│   └── _users/<userId>/          # 用户自学数据（运行时生成，按用户归档，仅对本人可见）
│       ├── skills/               # 自学技能（skill_manage 工具写入，同名覆盖全局技能）
│       └── memory/               # 持久记忆（memory 工具写入：MEMORY.md + USER.md）
├── workspace/uploads/            # 文件上传
└── logs/ai/                      # AI 交互日志（按日期+sessionId 分文件）
```

### 业务模块（`src/modules/`）

| 模块 | 说明 |
|------|------|
| `agent` | 视频制作智能体：对话循环、工具、技能、记忆、会话 |
| `video` | AI 视频制作工作台：项目 / 分镜 / 素材 / 图片与视频生成 / 合成，WebSocket 推送进度 |
| `short-video` | 一键成片：脚本 → 素材 → 配音 / 字幕 → 合成 |
| `publish-code` | 一键成片发布码：扫码查看成片，唤起抖音 / 小红书发布页 |
| `media-tools` | 视频工具、通用工具。工具目录见 `media-tools.catalog.ts` |
| `atlas` | Atlas Cloud 客户端（媒体生成、LLM 网关、Webhook、模型目录） |
| `media-pipeline` | FFmpeg、TTS、字幕、素材库检索 |
| `pricing` / `billing` / `pay` | 模型价目、按量计费、对接 nimblePay 钱包 |
| `auth` / `user` | 微信扫码登录、账号密码登录、个人资料、推广码 |
| `storage` / `redis` | 火山引擎 TOS 与 Redis 封装 |

---

## 快速开始

```bash
npm install
cp env.example.txt .env    # 填写数据库、Redis、LLM Key 等
npm run start:dev
```

---

## 核心接口

### POST /api/agent/chat

统一聊天接口，`stream=true` 返回 SSE 流（UI Message Stream 协议），`stream=false` 返回 JSON。

**请求体（ChatRequestDto）：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `sessionId` | 是 | 会话 ID（由调用方生成，UUID 或自定义字符串） |
| `input` | 是 | 用户输入文本 |
| `agentId` | 否 | 智能体空间 ID（对应 `ai/agents/<agentId>/AGENT.md`）。**不传 = 使用默认空间 `video-producer`（视频制作）** |
| `userId` | 是 | 用户 ID |
| `stream` | 否 | `true`=SSE 流式，`false`=JSON（默认 false） |
| `model` | 否 | 指定模型，优先级：请求值 > 空间默认值 > 全局默认值 |
| `toolGroups` | 否 | 启用的**可选工具组** tag，如 `["video_gen"]`。**不传 = 默认加载全部可选工具组**；传了（含空数组）= 仅加载数组内指定的分组（见工具系统） |
| `skills` | 否 | 指定加载的技能名称。**不传 = 加载全部技能**；传了（含空数组）= 仅加载数组内指定的技能 |
| `files` | 否 | 附件列表（先调用 `POST /api/agent/upload` 获得路径；路径只能指向上传目录，其它路径会被忽略） |
| `extraPrompt` | 否 | 追加到系统提示词末尾的自定义指令 |
| `llmParams` | 否 | LLM 参数覆盖（`temperature`/`maxOutputTokens`/`topP`/`topK`/`frequencyPenalty`/`presencePenalty`） |
| `extra` | 否 | 扩展透传参数（工具可通过 `ctx.extra` 读取） |

**流式响应（UI Message Stream 协议）：**

响应头含 `x-vercel-ai-ui-message-stream: v1`，前端可直接通过 `@ai-sdk/vue useChat` 消费。

| Chunk 类型 | 说明 |
|------------|------|
| `start` | 流开始，含 `messageId` |
| `text-start / text-delta / text-end` | 文本增量流 |
| `reasoning-start / reasoning-delta / reasoning-end` | 模型推理过程（如 deepseek-r1） |
| `data-process` | 工具调用进度（`running` → `done` / `error`） |
| `data-bi` | 分镜脚本卡片数据（`video-storyboard`） |
| `finish` | 完成，`messageMetadata` 含 `messageId`/`title`/`tokenUsage`/`sessionId`/`requestId` |
| `error` | 错误，含 `errorText` |

**非流式响应（`stream=false`）：**

```json
{
  "code": 200,
  "data": {
    "sessionId": "uuid",
    "messageId": "uuid",
    "requestId": "uuid",
    "blocks": [...],
    "model": "deepseek",
    "tokenUsage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 },
    "latencyMs": 1234,
    "title": "会话标题"
  }
}
```

---

### 关于 sessionId 和 requestId

- **sessionId**：一段对话的唯一标识，跨越多轮问答。用于查询历史消息、关联日志文件（`logs/ai/{date}/{sessionId}.jsonl`）。
- **requestId**：一次「用户发问 → AI 回复」的唯一标识。用于关联同一轮内的 LLM 日志行（`llm` / `error`）。排查问题时，先用 `GET /api/agent/sessions/:id/logs` 拿到该会话的日志，再按 `rid` 找到具体那一轮。

### AI 会话日志

路径：`logs/ai/{日期}/{sessionId}.jsonl`，每行一个 JSON。一次完整任务按时间序记录，不重复 dump 全量上下文：

```
system → user → assistant → tool → assistant → ...
```

| type | 含义 |
|------|------|
| `system` | 系统提示词（每轮任务一次） |
| `user` | 本轮用户提示词（每轮任务一次） |
| `assistant` | 模型本步返回（text / reasoning / toolCalls），循环轮次增量 |
| `tool` | 工具执行结果（回传给模型的 content） |
| `error` | 请求异常 |

按 `rid` 过滤即可还原该次任务的完整过程。

---

### 其他接口

```
GET    /api/agent/models                        # 可用模型列表

GET    /api/agent/sessions                      # 会话列表（?agentId=&userId=&page=&pageSize=）
GET    /api/agent/sessions/:id                  # 会话详情（仅本人或管理员）
GET    /api/agent/sessions/:id/messages         # 会话消息（含 blocks，仅本人或管理员）
GET    /api/agent/sessions/:id/logs?date=...    # 会话 AI 调用日志（JSONL，仅本人或管理员）
DELETE /api/agent/sessions/:id                  # 删除会话及消息

PUT    /api/agent/messages/:id/feedback         # 消息反馈 { "feedback": "like"|"dislike"|null }
POST   /api/agent/upload                        # 上传文件到 workspace（返回相对路径）
GET    /api/agent/recommend-questions           # 推荐问题
GET    /api/agent/health                        # 健康检查
```

---

## 智能体空间（Agent Space）

每个智能体空间是 `ai/agents/<id>/AGENT.md` 文件，通过 `agentId` 参数选择。未传 `agentId` 或找不到对应空间时，自动回退到 `video-producer`（视频制作）空间，这也是目前唯一的空间。

> 空间只承载"人设"（提示词 + 可选默认模型），**不配置**
> `toolGroups`/`skills` 等能力范围参数——那些完全由请求参数决定（见下文）。

**AGENT.md 格式：**

```markdown
---
key: video-producer        # agentId（与目录名一致）
name: 视频制作
model: deepseek   # 可选，atlas-models.json llm 分组的 id，覆盖默认模型
---

## Agent Persona

你是一名面向服装等电商产品的 AI 视频导演……（自定义人设 / 业务提示词）
```

**`toolGroups` / `skills` 请求参数语义（与智能体空间无关）：**

| 请求参数 | 不传 | 传了（含空数组） |
|---------|------|------------------|
| `toolGroups` | 默认加载全部可选工具组 | 仅加载数组内指定的分组，空数组 = 不加载任何可选工具 |
| `skills` | 默认加载全部技能 | 仅加载数组内指定的技能，空数组 = 不加载任何技能 |

> **重要**：`toolGroups` 只影响「可选工具」（有 `tag` 字段的工具，如 `generate_storyboard`）。**内置工具**（`read`/`memory`/`skill_manage`）无 `tag`，始终可用，不受 `toolGroups` 控制。

---

## 工具系统

### 内置工具（始终可用，无需 toolGroups）

| 工具名 | 说明 |
|--------|------|
| `read` | 读取文件（txt/md/json/pdf/docx/xlsx，支持行范围）。**只能读取技能文档和用户上传的附件**，其它路径一律拒绝（防止借智能体读取服务器上的 `.env` 等文件） |
| `memory` | 持久记忆读写（按 userId 隔离，详见下文「持久记忆」） |
| `skill_manage` | 用户专属技能自学（详见上文「技能自学」） |

### 可选工具（需 toolGroups 启用）

| 工具名 | tag | 说明 |
|--------|-----|------|
| `generate_storyboard` | `video_gen` | 生成视频分镜脚本并落库，返回 `video-storyboard` 卡片（前端点开进入视频工作台） |

### 新增工具

工具采用**目录自动扫描注册**（见 `tools/index.ts`）：启动时递归扫描 `tools/` 目录下所有
`*.tool.ts`（编译后 `*.tool.js`）文件，收集其 `default export` 自动注册，**无需手动登记**。

**1. 创建工具文件 `src/modules/agent/tools/video/my-tool.tool.ts`（放在任意子目录均可）：**

```typescript
import { z } from 'zod';
import { defineTool, toolOk, toolBi, toolFail } from '../tool.define';

export default defineTool({
  name: 'my_tool',        // LLM function calling 名称
  title: '我的工具',       // UI 进度块展示名
  tag: 'video_gen',       // toolGroups 过滤标签（不写 = 内置工具，始终加载）
  description: '功能描述（LLM 据此决定何时调用）',
  parameters: z.object({
    query: z.string().describe('查询内容'),
  }),
  async execute({ query }, ctx) {
    // ctx.services → NestJS 注入的服务（model / memoryService / skillLoader / videoService）
    // ctx.sessionId / userId / agentId / workspaceDir / extra
    const result = await someService.query(query);
    if (!result) return toolFail('查询失败');

    return toolOk('查询结果文本');
    // 带前端卡片：content 给 LLM，bi 给前端渲染（tag 对应前端组件）
    // return toolBi('给 LLM 的上下文', { tag: 'video-storyboard', data: { projectId, title, shotCount, assetCount } });
  },
});
```

**2. 保存后重启（`start:dev` 下自动重新编译加载）即可生效，无需修改 `index.ts` 或 `agent.module.ts`。**

**3. 如需注入 NestJS 服务，在 `tool.define.ts` 的 `ToolServices` 加字段，并在 `agent.module.ts` 的 `setServices()` 中提供，工具通过 `ctx.services` 访问。**

**4. 调用时传入 tag（不传则默认所有可选工具组均可用）：**

```json
{ "toolGroups": ["video_gen"] }
```

---

## 技能系统（Skills）

Skill 是 Markdown 格式的结构化指令。Agent 根据用户输入自动匹配技能的 `description`，命中后通过内置 `read` 工具读取 `SKILL.md` 并按步骤执行。

**新增技能：创建 `ai/skills/<技能名>/SKILL.md`：**

```markdown
---
name: my-skill
description: "技能描述——AI 根据此字段决定何时触发，尽量写清关键词和适用场景"
---

# 技能标题

## 执行步骤
1. 第一步：做什么
2. 第二步：调用哪个工具，传什么参数
3. 第三步：如何组织回复
```

重启服务后自动加载，无需修改代码。

### 技能自学（skill_manage 工具）

除人工维护的全局技能库外，智能体可通过内置 `skill_manage` 工具（`create`/`edit`/`patch`/`delete`）
把摸索出的解决方案沉淀成**用户专属技能**，写入 `ai/_users/<userId>/skills/<name>/SKILL.md`：

- 只影响该用户自己的后续对话，不修改、不污染全局共享技能库；
- 与同名全局技能冲突时，专属版本优先展示给该用户（相当于"个人覆盖"）；
- 自动生效，无需人工审核（正是因为作用域被严格限制在用户自己身上，才能做到自动生效而不失控）；
- `patch` 走唯一子串查找替换，`create`/`edit` 会校验 frontmatter（`name`/`description`）完整性。

---

## 持久记忆（Memory）

智能体可通过内置 `memory` 工具在对话中记住关于**当前用户**的稳定事实，跨会话持久生效，
按 `userId` 隔离存储在文件（`ai/_users/<userId>/memory/MEMORY.md` / `USER.md`），与技能自学
（见上文）共用同一套用户数据目录（`AGENT_USER_DATA_DIR`），互不可见：

| target | 含义 |
|--------|------|
| `user` | 用户画像——称呼、角色、偏好、沟通习惯 |
| `memory` | 智能体笔记——与该用户打交道时学到的环境事实、约定、经验教训 |

**写入方式**：`memory(action, target, content?, old_text?)`，`action` = `add`/`replace`/`remove`。
每个分区有字符预算（`AGENT_MEMORY_CHAR_LIMIT`/`AGENT_USER_PROFILE_CHAR_LIMIT`），写满会拒绝并返回
当前全部条目，模型据此用 `replace`/`remove` 精简后重试，而不是无限增长。

**注入时机**：每次请求构建 System Prompt 时读取该用户当前的记忆快照注入；本轮对话中途的写入
不影响本轮已生成的提示词，下一轮生效——与技能自学一致，保持"当前请求内提示词稳定"。

---

## 上下文处理机制

### 多轮对话历史加载

每次请求的历史按以下优先级加载：

```
Redis 缓存（TTL 1小时，每轮对话后刷新）
  ├─ 命中 → 使用缓存的 messages 数组（裁剪到窗口上限，自愈历史超窗数据）
  └─ 未命中 → 从 PostgreSQL 按 createdAt 倒序取最近的记录、反转为时间正序 → 写入缓存
```

**滑动窗口**：历史消息条数由 `AGENT_MAX_HISTORY_MESSAGES`（默认 50）控制，无论冷启动加载还是
活跃会话的缓存写回，都统一裁剪到"最近 N 条"，避免长会话上下文随轮次无限增长导致 token 成本
和超限风险持续上升。当前采用简单的按条数滑动窗口，足够覆盖大多数场景；如需更精细的 token 级
预算控制或旧上下文摘要合并，可在此基础上扩展。

历史转换规则：
- `user` 消息：`input` 文本（若有附件则前置文件列表）
- `assistant` 消息：**只取 `text` 类型的 ContentBlock 拼接**，`think/process/bi` 块不进入 LLM 上下文（避免上下文膨胀）

### 工具输出的上下文拆分

工具调用 `toolBi()` 时输出结构为 `{ content, bi }`：

```
toolBi("LLM 看到的文本摘要", { tag: 'video-storyboard', data: summary })
  ├─ content → 回传给 LLM 作为工具结果（纯文本，不含卡片数据）
  └─ bi      → 推送给前端渲染 data-bi 块（分镜脚本卡片）
```

LLM 上下文始终是轻量的文本，卡片数据只发给前端，不占用 token。

### 工具调用去重

同一请求内，相同工具 + 相同参数的调用会被自动跳过（返回缓存结果），避免 LLM 在一轮内重复调用相同工具。

---

## ContentBlock 协议

Agent 响应以结构化内容块为数据源，按顺序存入消息，前端据此渲染：

| 块类型 | 说明 | 前端处理 |
|--------|------|---------|
| `text` | Markdown 文本 | 渲染 Markdown |
| `think` | 模型推理过程 | 可折叠展示 |
| `process` | 工具调用进度（running→done→error） | 进度提示 |
| `bi` | 组件数据（目前只有分镜脚本 `video-storyboard`） | StoryboardCard |

---

## 配置项（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_PORT` | `3000` | 服务端口 |
| `DB_HOST/PORT/USERNAME/PASSWORD/DATABASE` | `127.0.0.1` / `5432` / `postgres` / 无 / `lingmi` | PostgreSQL 连接，`DB_PASSWORD` 必填 |
| `REDIS_HOST/PORT` | — | Redis 连接 |
| `ATLASCLOUD_API_KEY` | — | Atlas Cloud API Key（图片/视频/音频/LLM/视觉理解共用） |
| `ATLASCLOUD_BASE_URL` | `https://api.atlascloud.ai/api/v1` | 媒体生成网关 |
| `ATLASCLOUD_LLM_BASE_URL` | `https://api.atlascloud.ai/v1` | LLM / 视觉理解网关 |
| `AGENT_SPACES_DIR` | `ai/agents` | 智能体空间目录 |
| `AGENT_TIMEZONE` | `Asia/Shanghai` | 注入 System Prompt 的时区 |
| `AGENT_MAX_HISTORY_MESSAGES` | `50` | 历史上下文滑动窗口上限（消息条数） |
| `AI_LOG_DIR` | `logs/ai` | AI 日志目录 |
| `NIMBLEPAY_BASE_URL/APP_ID/APP_SECRET` | — | nimblePay 支付服务。三个都配了才会开启计费与充值；没配则所有生成免费（仅限本地开发） |
| `BILLING_ENABLED` | — | 设为 `false` 可显式关闭计费 |
| `PRICING_MARKUP` | `1` | 全局加价系数默认值，管理员在「模型定价」页保存后以数据库为准。美元汇率不配置，运行时向公开接口获取 |
| `TRUST_PROXY` | — | 部署在 Nginx / SLB 后设为 `true`，登录限流才能拿到真实 IP |
| `CORS_ORIGINS` | — | 允许跨域的前端域名（逗号分隔）。生产环境必须配置 |
| `DOUYIN_CLIENT_KEY/SECRET` | — | 抖音开放平台网站应用。配齐后，发布码才能唤起抖音发布页 |
| `XHS_APP_KEY/SECRET` | — | 小红书分享开放平台。配齐后，发布码才能唤起小红书并带上视频 |
| `MEDIAKIT_API_KEY` | — | 火山 AI MediaKit。视频工具、通用工具共用 |
| `MEDIAKIT_CALLBACK_URL` | — | 工具任务完成回调地址（公网）。不配时靠轮询和 20 秒对账收尾 |

---

## 视频工具与通用工具

- **工具目录**：`src/modules/media-tools/media-tools.catalog.ts` 声明每个工具的上游接口、输入、参数、计价和结果字段。后端按它校验参数、拼请求、算价；前端按 `GET /api/media-tools/catalog` 渲染表单。新增工具只改这个文件，再在 `nimble-web/src/views/tools/menu.ts` 加一行菜单。
- **介绍与效果示例**：`media-tools.content.ts` 写每个工具的介绍、适用场景、须知和效果示例。示例素材取自 MediaKit 官方文档的效果预览，压缩后放在 `TOS_BUCKET` 的 `ai-tool/_examples/<工具>/`（公共读）。换桶部署时需要把这个目录一并复制过去。
- **文件流转**：输入由浏览器直传 MediaKit（`mediakit://`，30 天后自动清理）。异步工具的结果用 `media_output_destination` 直接写回 `TOS_BUCKET` 的 `ai-tool/<userId>/<recordId>/`，同步工具的临时链接由服务端转存到同一目录。删除记录时整个目录一起删除。
- **写回授权**：直接写回 TOS 需要在 MediaKit 控制台「基础配置 > 授权管理」授权访问 TOS（否则报 `RoleNotExist: AmkServiceLinkedRole`）。没授权时任务会自动不写回重提一次、改由服务端转存，并打一条错误日志提醒；`MEDIAKIT_TOS_WRITEBACK=false` 可直接关闭写回。
- **计费**：提交时按「官方刊例价 × 加价系数」预扣，失败自动退回；完成后按上游返回的计费时长补扣差额（只补不退）。管理员在「模型定价」页按工具调整系数或手填官方价，规则 id 为 `tool:<工具>:<版本>`。
- **爆款复刻**：先用深度动作捕捉（`video-depth`）提取动作视频，再作为参考视频交给视频生成模型，生成费用按所选模型计。
- **新表**：`media_tool_task`，生产环境启动时自动 `CREATE TABLE IF NOT EXISTS`。

---

## 计费、定价与用户中心

灵米（LingMI）按量计费：**用户价 = 已保存的 Atlas 实付价 × 实时美元汇率 × 加价系数**。汇率取自公开接口并缓存一小时，不读环境变量，也不能在后台手填。

Atlas 报价只在管理员点击「重新询价」时请求：媒体模型 `POST /model/calculate`（每个 Atlas 模型 id 一次，串行），文本模型 `GET /models` 一次。返回的报价写入 `model_quote`。价目表、模型选择器和生成扣费都读这张表，不再临时打 Atlas，避免触发限流。没有成功报价的模型不能生成。

视频按每秒单价 × 时长，图片按张，配音按千字，音乐按首，和价目表上的单价一致。清晰度、配音开关不另加价。改加价系数只重算人民币，不会重新询价。

```
价目表   GET /api/pricing/models（公开，只返回已经询到价的模型）
         读 model_quote，不请求 Atlas
重新询价 POST /api/admin/pricing/refresh（管理员）
         写 model_quote：实付价、官方价、折扣、询价请求和 Atlas 原文
定价规则 pricing_rule 表：`*` 行是全局加价系数，其余行按 Atlas 模型 id 覆盖（管理员页面维护）。`usd_cny` 列已停用
```

**扣费链路（按已保存单价折算，失败自动退回）**

| 类型 | 时机 | 失败处理 |
|------|------|----------|
| 图片 / 视频 / 音频 | `AtlasClientService.submit*` 提交前：按 `model_quote` 折算 → nimblePay 扣款 | 没询过价直接失败；提交失败立即退回；任务失败 / 超时在 `getPrediction` / `pollUntilDone` 里按任务 id 退回 |
| 文本模型（对话、脚本、视觉理解） | 调用前确认已有 token 单价。`AtlasLlmService` 的中间件在调用后按真实 token 用量结算；不足 1 分的零头累计在 Redis | 没询过价直接失败；调用前预检余额，为 0 直接 402 |

- 用户上下文用 `AsyncLocalStorage` 传递：HTTP 请求由 `BillingContextInterceptor` 自动带上；队列任务入队时用
  `billingJob()` 写进任务数据，Worker 里用 `runWithBilling` 还原。**新增队列任务时记得这样做**，否则会告警并跳过计费。
- 会触发生成的接口加 `@RequireBalance()`（整条流水线类用 `PIPELINE_MIN_BALANCE_CENTS`），余额不够直接 402，前端弹出充值。
- 扣款和退款都带幂等号，重复调用不会重复扣 / 退；退款彻底失败会打 ERROR 日志（含 `bizNo`），需要人工处理。
- 账号推广码 `account.referral_code`、邀请人 `account.invited_by`；奖励、注册赠送、首充门槛都在 nimblePay 后台「业务参数」里配置。

**消费账单与分销**

- 账单：每次扣费成功写一行 `usage_log`，记下用户实付 `charge_cents` 和上游成本 `upstream_cents`（Atlas 实付价 × 当时汇率，不含加价），利润 = 实付 - 成本；
  任务失败退款时标 `refunded`，所有统计只算有效调用，口径统一走 `BillService`。管理员账单页：`GET /admin/bills`。
- 归属：`account.distributor_id` 在**用户注册时一次算定、不再修改**：邀请人本身是现任分销商就归他，否则沿用邀请人的归属（沿用的分销商必须仍是现任），
  所以邀请链无论多长都直接指向同一个分销商，统计只是一次 `WHERE distributor_id = ?`，不用递归。邀请关系只在新建账号时写入，天然无环。
- 分销商：默认管理员用 `PATCH /admin/users/:id/distributor` 任命 / 取消 / 调整佣金比例（`commission_percent`）。
  只影响之后注册的用户；取消后名下用户和业绩保留，新注册的用户不再归他。分销状态由 `DistributorGuard` 查库判断，不进令牌，立即生效。
- 佣金：每笔账单写入时按「利润 × 所属现任分销商当时的比例」算定，存进 `usage_log.commission_cents`，之后改比例或取消分销商都不影响历史佣金；
  只展示、线下结算，不入余额。
- 专属链接就是分销商自己的 `referral_code`：`/login?ref=<code>`，和普通用户的邀请链接是同一套机制。
- 接口：分销商 `GET /distributor/overview`、`/distributor/users`、`/distributor/pricing`（含成本价）；管理员 `GET /admin/distributors`。
- 启动时 `InitService.ensureSchema` 会自动补齐 `account` 的分销字段，并把旧的 `usage_log.cost_cents` 改名为 `charge_cents`、新增 `upstream_cents` 和
  `commission_cents`（旧账单没有成本数据，成本和佣金记 0）。

用户中心接口：`PATCH /auth/password`、`POST /auth/avatar`、`GET /wallet`、`GET /wallet/ledgers`、
`GET /wallet/referral`、`POST /wallet/recharge`、`GET /wallet/promo`（公开，首页活动横幅用）。

### 一键成片限时免费

平台管理员可在右上角账户菜单进入「系统配置」，选择活动开关并填写北京时间的开始和结束时间。配置保存在 PostgreSQL 的 `system_config` 表中，保存后服务端立即使用新规则。
默认关闭。开始时刻包含在活动内，结束时刻恢复正常计费。
管理员接口为 `GET /api/admin/config/short-video-promotion` 和 `PUT /api/admin/config/short-video-promotion`，接口时间使用带时区的 ISO 8601。
`GET /api/short-video/pricing` 提供首页和生成页面共用的报价。`POST /api/short-video/tasks` 可传 `confirmedPricing`（页面所显示的报价类型）
和 UUID `requestId`（同账号重试时复用）。报价失效时返回 `409` 和 `data.shortVideoQuote`。已受理任务及同批续作沿用首次受理时保存的计费方式。
活动外按文案和所选模型的实际用量结算，生成前的最低余额为 ¥1。

本地检查活动边界、价格确认和子步骤免单，可在 `nimble-ai` 先运行 `npm run build`，再运行 `node --test scripts/short-video-pricing.test.cjs`。

**生产环境数据库变更**：生产环境 `synchronize` 是关闭的，上线前先手工执行：

```sql
ALTER TABLE account ADD COLUMN IF NOT EXISTS referral_code varchar(16);
ALTER TABLE account ADD COLUMN IF NOT EXISTS invited_by integer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_referral_code ON account (referral_code);

CREATE TABLE IF NOT EXISTS pricing_rule (
  id varchar PRIMARY KEY,
  markup numeric(8,4),
  usd_cny numeric(8,4),
  official_unit_cny numeric(12,6),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_quote (
  id varchar(160) PRIMARY KEY,
  kind varchar(16) NOT NULL,
  scale varchar(32) NOT NULL DEFAULT 'each',
  usd numeric(14,8),
  official_usd numeric(14,8),
  discount numeric(8,4),
  unit varchar(32) NOT NULL DEFAULT '',
  per numeric(12,4) NOT NULL DEFAULT 1,
  scenario varchar(128) NOT NULL DEFAULT '',
  display_name varchar(200) NOT NULL DEFAULT '',
  probe jsonb,
  raw jsonb,
  input_usd numeric(14,8),
  output_usd numeric(14,8),
  cache_usd numeric(14,8),
  official_input_usd numeric(14,8),
  official_output_usd numeric(14,8),
  inherited_from varchar(160),
  quote_error text,
  quoted_at timestamp
);
```

头像存在 TOS 的 `ai-avatar/<userId>/` 前缀下，服务启动时会自动把业务前缀加进桶的匿名读取策略。浏览器和海外模型用公网地址。桶在华北2且 `TOS_VOLC_INTERNAL=true` 时，方舟走内网预签名。

历史文件用 `npm run storage:migrate` 按数据库里的对象键，从 `LEGACY_STORAGE_BASE_URL` 拉到 TOS。对象键本身不用改；画布里存过的完整旧地址会被改成新的公网地址。先加 `--dry-run` 只统计，不上传。

**知识库模块已下线**：不再有 `/api/knowledge/*` 接口、RAGFlow 对接和 `search_knowledge` 工具，`RAGFLOW_*` 也不再读取。旧数据不会被自动清理，确认不需要后可以手工执行：

```sql
DROP TABLE IF EXISTS kb_file, kb_folder, kb_tag;
```

对象存储里的 `ai-kb/` 前缀、Redis 里的 `bull:kb-parse:*` 队列数据同样需要手工清理，RAGFlow 里的数据集也可以直接下线。

**只保留视频制作智能体**：通用智能体时代的内容已清理——`query_data` / `visualize_data`（Text-to-SQL，含 `ai/prompt/data-query`）、
`write` / `exec` / `ls` / `grep` / `web_search` 工具，`data-analyst` / `default` 智能体空间，`ai/mcp.config.json`，
以及 `GET /api/agent/agent-spaces` 接口。`read` 工具与附件摘要只允许访问技能文档和上传目录；
会话详情 / 消息 / 日志 / 反馈接口都会校验会话归属（本人或管理员）。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | NestJS |
| AI SDK | Vercel AI SDK v7（`ai` + `@ai-sdk/openai`） |
| LLM 路由 | 模型平台API（OpenAI 兼容 chat/completions） |
| 数据库 | PostgreSQL + TypeORM |
| 缓存 | Redis（ioredis） |
| 参数校验 | class-validator + Zod |
| 流协议 | UI Message Stream（`x-vercel-ai-ui-message-stream: v1`） |
