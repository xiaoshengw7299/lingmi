# Skills 目录

本目录包含视频制作智能体可用的技能（Skills）定义。

## 目录结构

```
ai/skills/
├── README.md                  # 本文档
├── self-introduction/         # 自我介绍
│   └── SKILL.md
├── video-storyboard/          # 电商视频：少分镜、片内时间线落库
│   └── SKILL.md
└── h3-prompt-writing/         # 结构化提示词参考（按 H3 官方整理）
    ├── SKILL.md
    └── references/            # base-en.txt / ref-en.txt
```

## 什么是 Skill？

Skill 是一组结构化的指令和示例，帮助智能体完成特定类型的任务。当用户输入匹配某个技能的场景时，AI 会自动读取对应的 SKILL.md 并按照指导执行。

## 内置技能

### self-introduction（自我介绍）

当用户询问「你是谁」「介绍一下你自己」时触发。身份为电商视频智能体，面向服装等产品短视频。

### video-storyboard（视频分镜）

用户要做产品宣传视频时触发。默认 15 秒、一条工作台分镜；多场景写进提示词时间线。脚本通用，工作台可换模型。

### h3-prompt-writing（H3 提示词结构）

官方提示词字段与时间码参考（按 H3 整理，换模型同样可用）。制作项目时优先走 `video-storyboard`。

## SKILL.md 格式规范

### Frontmatter（必需）

```yaml
---
name: skill-name              # 技能唯一标识（必需）
description: "技能描述"        # 简短描述（必需）
---
```

### 内容结构

```markdown
# 技能名称

技能的简要说明

## 使用场景

描述什么情况下应该使用这个技能

## 执行步骤

1. 第一步：做什么
2. 第二步：做什么
3. 第三步：如何组织回复
```

## 创建新技能

### 步骤 1: 创建目录

```bash
mkdir ai/skills/my-skill
```

### 步骤 2: 创建 SKILL.md

```markdown
---
name: my-skill
description: "我的自定义技能"
---

# My Skill

## 使用场景

当用户...时使用此技能

## 执行步骤

1. 处理数据
2. 返回结果
```

### 步骤 3: 重启服务

技能会在服务启动时自动加载。

## 技能与工具的关系

技能定义**做什么**和**怎么做**，工具（`src/modules/agent/tools/`）提供**执行能力**。

```
用户输入 → AI 匹配技能 → read 读取 SKILL.md → 按步骤执行（可调用工具）→ 组织回复
```

## 最佳实践

### DO ✅

- 技能描述要准确，方便 AI 匹配
- 执行步骤要清晰
- 提供回复模板，保证输出质量

### DON'T ❌

- 不要让技能过于宽泛，导致错误匹配
- 不要在技能中硬编码数据，应通过工具获取
- 不要忽略错误处理场景
