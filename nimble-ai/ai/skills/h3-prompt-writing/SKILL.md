---
name: h3-prompt-writing
description: "视频提示词结构参考（按 MiniMax-H3 官方格式整理，换模型同样可用）。把创意改写成带时间码与参考标签的结构化提示。制作电商视频项目、调用 generate_storyboard 时不要用本技能，改用更具体的 video-storyboard。"
---

# 结构化视频提示词

本技能按 [MiniMax-H3 官方 h3-prompt-writing](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing) 整理字段与时间码。
这是默认推荐写法，换其他视频模型时同一套提示词仍然可用（它们都吃纯文本）。

结构、字段名、时间码和参考标签遵循官方参考文件；**正文在本平台一律使用中文**。

## 本平台落地规则（覆盖官方“正文用英文”）

- 字段名保持英文：`integrated_multimodal_description`、`overall_soundscape`、`non_diegetic_music`，以及 Ref2VA 的六段字段。
- 标签保持英文：`[Shot N]`、`<Picture N>`、`<Video N>`、`<Audio N>`、`<Subject N>`、`<d>`、说话人 `(S1)`。
- **描述、运镜、环境声、配乐说明全部写中文。** 对白、歌词、画面可见文字保持用户原文，不翻译。
- 写入 `generate_storyboard` 的 `videoPrompt` 时：用 `@素材名` 引用素材，**不要手写** `<Picture N>` / `<Video N>` / `<Audio N>`。系统生成时会按引用顺序、按目标模型的标签风格替换。只讲结构或给示例时才可直接写官方标签。
- 单条视频时长必须与描述时间线一致，范围 4–15 秒。

## 工作流

1. 判断模式：T2VA、I2VA、FL2VA、L2VA，或全参考 Ref2VA。
2. 基础文本/关键帧模式：用 `read` 读取同目录 `references/base-en.txt`，按其最终结构写（正文改中文）。
3. 全参考模式：用 `read` 读取同目录 `references/ref-en.txt`，按其六段格式写（正文改中文）。
4. 保持所选指南中的字段名、段落顺序、标签和时间码写法。

## 基础模式

- **T2VA**：纯文本构建完整视听时间线，无参考图指令行。
- **I2VA**：从首帧出发往前演。第一条必须说明 0.00 秒完整参考第一张图。
- **FL2VA**：描述从首帧到尾帧的连续路径。
- **L2VA**：先写合理开场，再收敛到给定尾帧。

三个核心字段顺序：`integrated_multimodal_description` → `overall_soundscape` → `non_diegetic_music`。

内部镜头切换（仍是**同一条** 4–15 秒视频，不是多个生成任务）：

```text
[Shot 1] 真人实拍，中全景……镜头以小幅度缓慢前推……
[Shot 2] 于 00:05.000，镜头切至……
```

- 第一镜不要写时间码。后续镜用严格递增、落在片长内的时间码，格式 `00:mm.sss`。
- 切镜用语：镜头切至 / 转到 / 切换到。只改距离或微角度时优先运镜，不要空切。
- 运镜写清 **类型 + 幅度 + 速度**，例如：镜头以小幅度缓慢前推；镜头大幅度快速右摇。常用类型：推/拉、摇、移、升/降、环绕、跟随、固定。
- 开口的人物给稳定说话人 ID `(S1)`。对白放在 `<d>` 内且一字不改。画外音后必须写明对应人物嘴唇闭合。
- 画面文字用中文引号原样保留，如 `"春季新品"`。
- `overall_soundscape`：1–4 句环境声与动作声，不要重复对白。全程静音才写 `N/A`。
- `non_diegetic_music`：1–3 句写乐器、速度、节奏、音量变化，不要用“高级/电影感”这类空词。无配乐写 `N/A`。

I2VA 指令行（中文）：

```text
目标视频第 0.00 秒完整参考 @产品主图（来自 [Shot 1]）。
```

## 全参考模式（多张参考图，或含参考视频 / 参考音频）

字段顺序：`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`。

- `subject_definitions`：为每个要锁定的主体单独一行，说明外观与来源素材 `@名称`。音频素材说明它是整段复用、还是只参考风格/音色。
- `retention_analysis`：每个主体在目标视频里是完整保留、部分保留还是迁移；音频对应完整复用、部分复用还是仅参考。
- `detailed_description`：按播放顺序写构图、动作、运镜、声音、参考内容生效的时间点，不要写成剧情摘要。

参考音频的完整用法（复用与参考的区别、与说话人 `(Sx)` 的关系）见 `references/ref-en.txt` 的 `<Audio N>` 章节。

## 输出禁忌

- 不要写与时长对不上的时间码。
- 不要留下未定义的参考标签。
- 不要用“电影感、精美、高级”代替具体可见可听的细节。
---
