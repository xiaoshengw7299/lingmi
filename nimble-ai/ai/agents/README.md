# Agent Spaces（智能体空间）目录

本目录定义智能体空间——每个空间是一份专属配置（人设提示词 + 可选默认模型），对应请求参数 `agentId`。

当前只有一个空间：**`video-producer`（视频制作）**，也是请求未传 `agentId`、或找不到对应空间时的默认空间
（常量 `DEFAULT_AGENT_KEY`，见 `src/modules/agent/agent-space/agent-space.loader.ts`）。

## 目录结构

```
ai/agents/
├── README.md                     # 本文档
└── video-producer/               # AI 视频制作智能体（生成分镜脚本）
    └── AGENT.md
```

## 底座层 vs 空间层

系统提示词分两层拼装（见 `SystemPromptBuilder`）：

- **底座层**（代码里，不随空间变化）：身份、工具调用风格、安全护栏。
- **空间层**（本目录）：每个 `AGENT.md` 的正文，作为"## Agent Persona"章节追加在底座之后，
  用于注入该空间专属的业务背景、语气、使用指引。

## AGENT.md 格式规范

### Frontmatter（可选字段均可省略）

```yaml
---
name: 展示名称
model: 默认模型 id（填 atlas-models.json llm 分组的 id，不填则使用该分组的 default）
---
```

空间 frontmatter 只用于"人设"相关配置（展示名 / 默认模型），**不声明** `toolGroups`/`skills`
等能力范围参数——工具组和技能的可用范围完全由请求参数决定：

- `toolGroups` 不传 = 默认加载全部可选工具组；传了（含空数组）= 仅加载数组内指定的分组
- `skills` 不传 = 默认加载全部技能；传了（含空数组）= 仅加载数组内指定的技能

### 正文

正文即该空间的专属人设/业务提示词，直接追加进最终系统提示词，无固定格式要求，
按 Markdown 自由书写（建议保持简洁、可执行，避免与底座层的安全/工具调用风格重复）。

## 与 Skills / Tools 的关系

- **Agent Space**：决定"这个智能体是谁"（人设 + 可选默认模型）
- **Skill**：决定"遇到某类具体任务时怎么做"（可复用的操作指南，见 `ai/skills/`）
- **Tool**：决定"具体能执行什么动作"（能力本身，见 `src/modules/agent/tools/`）

三者互不耦合：`agentId` 只影响人设提示词，工具组/技能的可用范围由请求参数
`toolGroups`/`skills` 独立控制。
