/** 侧栏子菜单。工具详情、参数和价格来自后端目录，id 要和 nimble-ai media-tools.catalog 保持一致 */
export interface ToolMenuItem {
  id: string
  title: string
  /** 一句话说明，和目录 summary 保持一致，给标题和搜索摘要用 */
  summary: string
}

export const VIRAL_CLONE: ToolMenuItem = {
  id: 'viral-clone',
  title: '爆款复刻',
  summary: '提取爆款视频的动作和运镜，一键生成同款新视频',
}

export const VIDEO_TOOL_MENU: ToolMenuItem[] = [
  { id: 'erase-subtitle', title: '字幕擦除', summary: '自动识别并无痕擦除视频里的硬字幕、水印和台标' },
  { id: 'transcode', title: '视频转码', summary: '转换编码、分辨率、帧率和封装格式' },
  { id: 'asr', title: '语音转字幕', summary: '识别视频或音频里的语音，生成带时间轴的字幕' },
  { id: 'drama-highlights', title: '高光智剪 · 短剧', summary: '理解多集剧情，自动剪出高光混剪和投放素材' },
  { id: 'movie-highlights', title: '高光智剪 · 影视拆条', summary: '把电影、电视剧拆成多条带标题的精彩短视频' },
  { id: 'video-matting', title: '视频抠图', summary: '人像或绿幕视频一键抠出透明背景' },
  { id: 'drama-script', title: '剧本还原', summary: '从剧集视频还原剧情梗概、人物、场景和台词' },
  { id: 'drama-recap', title: '解说视频生成', summary: '自动写解说词、配音、配画面，生成影视解说视频' },
  { id: 'extract-frames', title: '视频抽帧', summary: '按间隔、场景变化或首尾帧批量截图' },
  { id: 'face-blur', title: '视频人脸打码', summary: '自动识别画面中所有人脸并打码' },
  { id: 'face-swap', title: '视频换脸', summary: '把视频里的人脸换成指定照片中的人脸' },
  { id: 'lip-sync', title: '视频口型对齐', summary: '让视频里人物的口型匹配新的配音' },
  { id: 'ai-highlights', title: 'AI 高光剪辑', summary: '大模型看懂视频，按目标时长剪出高光集锦' },
  { id: 'reframe-vertical', title: '视频横转竖', summary: '横屏视频智能跟随主体，转成 9:16 竖屏' },
]

export const GENERAL_TOOL_MENU: ToolMenuItem[] = [
  { id: 'erase-image', title: '图像擦除修复', summary: '擦除图片里的文字、图标或任意涂抹区域' },
  { id: 'remove-background', title: '智能抠图', summary: '一键去除图片背景，输出透明 PNG' },
  { id: 'expand-image', title: '智能扩图', summary: '向四周延展画面，AI 自动补全内容' },
  { id: 'remove-image-elements', title: '电商牛皮癣擦除', summary: '一键去除商品图上的促销文字、贴纸和水印' },
  { id: 'product-scene', title: '电商万创', summary: '上传商品图，批量生成场景化营销主图' },
  { id: 'separate-voice', title: '人声背景音分离', summary: '把人声、背景音乐和音效拆成独立音轨' },
  { id: 'edit-speech', title: '音频内容编辑', summary: '像改文字一样修改录音里说错的话' },
]

export function toolPath(id: string, group: 'video' | 'general' = 'video') {
  if (id === 'viral-clone') return '/viral-clone'
  return group === 'general' ? `/general-tools/${id}` : `/video-tools/${id}`
}
