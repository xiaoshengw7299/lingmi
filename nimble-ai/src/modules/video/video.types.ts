/** 分镜脚本结构化数据（LLM 生成 → generate_storyboard 工具落库时使用） */

export interface StoryboardBoardInput {
  /** 唯一主体名称（如"女主角""运动鞋""咖啡厅""片尾曲"），用于分镜 videoPrompt 中通过 `@名称` 引用 */
  name: string;
  /** 用于生成一张独立完整参考图的描述；禁止宫格拼贴。素材来自 uploadedFilePath 时可为空 */
  prompt: string;
  /**
   * 若该素材应直接复用用户在对话中已上传的附件，填写附件相对路径（如 "uploads/xxx.png"）。
   * 支持图片/视频/音频，素材类型按文件内容识别，无需在此声明。
   */
  uploadedFilePath?: string;
}

export interface StoryboardShotInput {
  /** 稳定分镜名；缺省时自动生成“分镜N” */
  name?: string;
  /**
   * 视频提示词（正文中文，字段名可保留英文）；
   * 文本中用 `@名称` 引用素材库中的参考图/参考视频/参考音频（须与 assets 中的 name 完全一致）。
   * 一条工作台分镜内可用 [Shot N] 时间码切换场景。
   */
  videoPrompt: string;
  /** 目标时长（秒），默认 15，范围 4–15 */
  durationSec?: number;
  /** 画幅，如 9:16；不传则生成时回退为当前视频模型默认画幅 */
  ratio?: string;
}

export interface CreateStoryboardInput {
  sessionId: string;
  userId: string;
  title: string;
  requirement: string;
  assets: StoryboardBoardInput[];
  /** 整片画幅；写入各分镜。不传则分镜 ratio 留空，生成时用模型默认 */
  ratio?: string;
  shots: StoryboardShotInput[];
}
