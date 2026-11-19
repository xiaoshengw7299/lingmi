/**
 * 工具页的介绍、场景和效果示例。示例素材来自火山 AI MediaKit 官方文档的效果预览，
 * 统一转存到本桶 `ai-tool/_examples/<工具>/`（公共读），这里只写相对路径。
 */

export const EXAMPLE_PREFIX = 'ai-tool/_examples';

export interface ShowcaseItem {
  kind: 'video' | 'image' | 'audio' | 'subtitles' | 'text';
  label: string;
  /** 相对 EXAMPLE_PREFIX 的路径；text 类没有 */
  key?: string;
  text?: string;
  /** 无声的短动图：自动循环播放 */
  loop?: boolean;
}

export interface Showcase {
  title: string;
  desc?: string;
  items: ShowcaseItem[];
}

export interface ToolContent {
  intro: string;
  highlights: string[];
  scenarios: Array<{ title: string; desc: string }>;
  tips: string[];
  showcase?: Showcase[];
}

const video = (label: string, key: string, loop = false): ShowcaseItem => ({ kind: 'video', label, key, ...(loop ? { loop } : {}) });
const image = (label: string, key: string): ShowcaseItem => ({ kind: 'image', label, key });
const audio = (label: string, key: string): ShowcaseItem => ({ kind: 'audio', label, key });

const TEMPLATES: Showcase = {
  title: '5 种短剧包装模板',
  desc: '剧名、角标、提示语三要素，剧名会自动避开字幕区域',
  items: [image('热门短剧 1 – 5', 'drama-highlights/templates.jpg')],
};

export const TOOL_CONTENT: Record<string, ToolContent> = {
  'viral-clone': {
    intro:
      '爆款视频火的往往是动作节奏和镜头语言。上传一段爆款视频，系统先做深度动作捕捉：把画面转换成只保留动作轮廓、空间位移和镜头运动的深度视频，人物长相、服装、背景都被抹掉；再把这段动作视频作为参考交给视频大模型，按你的人物、商品和场景重新生成。节奏是爆款的，画面是全新的原创。',
    highlights: ['只学动作和运镜，不搬运原片画面', '提示词自动写好，可直接修改', '同一份动作可换模型、换人物反复生成'],
    scenarios: [
      { title: '舞蹈卡点翻拍', desc: '复刻热门舞蹈和手势舞的动作节奏，换成品牌 IP、数字人或自家模特' },
      { title: '带货口播复刻', desc: '学习爆款主播的走位和镜头推拉，用自己的产品和人设重新拍' },
      { title: '运镜参考', desc: '提取环绕、推拉、跟拍等镜头运动，让 AI 生成的视频也有电影感运镜' },
      { title: '角色替换', desc: '动作保持不变，主角换成动漫、3D 或任意风格的角色' },
    ],
    tips: ['建议 4 – 30 秒、主体清晰、动作完整的片段', '参考视频时长受所选模型限制，Seedance 最长 30 秒', '动作捕捉按视频时长计费，生成视频按所选模型另计'],
    showcase: [1, 2].map((n) => ({
      title: `示例 ${n}`,
      desc: '原视频 → 动作视频（本工具第 1 步）→ 交给视频模型后的成品',
      items: [video('原视频', `viral-clone/ex${n}-source.mp4`), video('动作视频', `viral-clone/ex${n}-motion.mp4`), video('生成成品', `viral-clone/ex${n}-result.mp4`)],
    })),
  },

  'erase-subtitle': {
    intro:
      '依托高帧率 OCR 精准定位每一帧里的字幕，再用 AIGC 修复算法结合前后帧重建被遮挡的画面，修复处与原画面无缝融合。精细化版能还原衣物纹理、首饰等复杂细节，还支持框选固定区域擦除水印、台标和人名条；标准版速度快、价格低，适合大批量处理。',
    highlights: ['自动识别画面下方字幕，区分剧情文字', '框选区域擦除水印、台标、人名条', 'V5.6 算法支持西语、韩语、日语等多语种'],
    scenarios: [
      { title: '短剧出海', desc: '擦掉中文字幕后再配目标语言字幕，或擦掉外文字幕引进国内' },
      { title: '视频二创', desc: '去掉原字幕，按新的创意重新包装字幕和配音' },
      { title: '去水印台标', desc: '框选右下角水印、左上角台标，整段视频统一擦除' },
      { title: 'AIGC 内容修正', desc: 'AI 生成视频里出现多余文字时一键擦干净' },
    ],
    tips: ['默认只擦画面下半部分、横向居中、白色的字幕', '擦画面任意位置的文字请选「全画面文字」并框选区域', '输入最高 2K，超过 1080P 按 1080P 输出', '处理耗时约为视频时长的 5 – 9 倍'],
    showcase: [
      { title: '原片 / 精细化版 / 标准版', desc: '同一段短剧在两个版本下的擦除效果', items: [video('三版对比', 'erase-subtitle/compare.mp4')] },
      { title: '复杂纹理细节对比', desc: '衣物纹理、首饰背景下，精细化版还原得更完整', items: [image('细节对比', 'erase-subtitle/detail.jpg')] },
    ],
  },

  transcode: {
    intro:
      '把视频转换成需要的编码、分辨率、帧率、画面比例和封装格式，适配不同平台、播放终端和网络环境。H.265 在同等画质下体积约为 H.264 的一半；改画面比例时完整保留画面，不足的部分自动补黑边，不裁切、不变形。',
    highlights: ['H.264 / H.265 编码', '480P – 4K 任意分辨率', '1:1、9:16、16:9 一键改比例'],
    scenarios: [
      { title: '压缩体积', desc: '1080P 素材转 720P H.265，体积大幅减小，方便传输和分发' },
      { title: '平台适配', desc: '竖屏视频转 1:1 发朋友圈、转 16:9 发长视频平台' },
      { title: '统一规格', desc: '把不同来源的素材统一成同样的分辨率、帧率和编码，方便后期剪辑' },
    ],
    tips: ['按输出时长和分辨率计费，H.265 单价更高', '目标分辨率高于原片时不会放大'],
    showcase: [
      {
        title: '竖屏转 1:1 方形',
        desc: '496×864 竖屏视频转为 720×720，两侧自动补黑边',
        items: [video('原视频 496×864', 'transcode/before.mp4'), video('转码后 720×720', 'transcode/after.mp4')],
      },
    ],
  },

  asr: {
    intro:
      '自动识别视频或音频里的说话和歌声，按句输出带时间轴的字幕，可以区分不同的说话人。支持中文、英语、西班牙语、印尼语，结果可以直接导出 SRT 字幕文件或纯文本，导入剪映、Premiere 等任何剪辑软件。',
    highlights: ['视频、音频都能识别', '可区分说话人', '一键导出 SRT / TXT'],
    scenarios: [
      { title: '口播加字幕', desc: '自动生成逐句字幕，省去手打字幕的时间' },
      { title: '会议纪要', desc: '会议、访谈录音转成文字稿，按说话人整理' },
      { title: '歌词时间轴', desc: '识别歌声，生成卡拉 OK 式的歌词字幕' },
    ],
    tips: ['单个文件不超过 3 小时', '背景音乐过大时识别率会下降，可先用「人声背景音分离」提取人声'],
    showcase: [
      {
        title: '短剧对白识别',
        desc: '39 秒短剧片段，识别出 17 句带时间轴的对白',
        items: [video('输入视频', 'asr/input.mp4'), { kind: 'subtitles', label: '识别出的字幕', key: 'asr/subtitles.json' }],
      },
    ],
  },

  'drama-highlights': {
    intro:
      '深度理解多集短剧的角色关系和故事脉络，按你设定的时长和条数，自动挑出强冲突、强情绪、高反转的片段，把最抓人的 5 – 15 秒前置为开场钩子，剪成节奏紧凑的高光混剪。可一键加上剧名、角标、提示语三要素包装，直接用于投放。',
    highlights: ['智能精彩前置，黄金三秒留人', '混剪 / 顺剪两种剪法', '5 种短剧包装模板'],
    scenarios: [
      { title: '投放素材', desc: '用前 10 – 20 集免费剧集剪 1 – 3 分钟混剪，提升点击和转化' },
      { title: '单集预告', desc: '顺剪模式保持剧情顺序，适合做分集回顾和预告' },
      { title: '批量出片', desc: '一次产出多条不同的高光，用于 A/B 测试素材效果' },
    ],
    tips: ['最多 30 集，累计不超过 45 分钟，最高 1080P', '需要有中文对白，画面下方有居中的中文字幕', '按输入时长计费，成片时长另按 0.06 倍补计'],
    showcase: [
      {
        title: '3 集短剧 → 1 条高光混剪',
        desc: '自动挑选高能片段、前置开场钩子，并加上剧名、角标和提示语（输入为节选）',
        items: [video('第 1 集', 'drama-highlights/ep1.mp4'), video('第 2 集', 'drama-highlights/ep2.mp4'), video('第 3 集', 'drama-highlights/ep3.mp4'), video('输出的高光混剪', 'drama-highlights/highlight.mp4')],
      },
      TEMPLATES,
    ],
  },

  'movie-highlights': {
    intro:
      '理解整部电影或电视剧的剧情，自动拆出多条主题完整、可以独立观看的精彩片段，每条都配好标题，并把最抓人的镜头前置为开场钩子。一部电影就能拆出一周的影视号更新素材。',
    highlights: ['整片自动拆条', '每条自动起标题', '开场钩子前置'],
    scenarios: [
      { title: '影视解说号日更', desc: '一部电影拆成 10 条左右 2 分钟的精彩片段' },
      { title: '电视剧切片', desc: '按情节点拆分名场面、高能桥段' },
      { title: '版权方二次分发', desc: '把长片自动切成适合短视频平台的片段' },
    ],
    tips: ['每次 1 个视频，不超过 180 分钟、1080P', '需要同时有画面和音轨，建议有中文对白'],
  },

  'video-matting': {
    intro:
      '逐帧识别人像或绿幕前景，干净地抠掉原背景，输出带透明通道的视频，或换成纯色背景。发丝、手指等边缘处理自然，抠出来的视频可以直接放进任意场景合成。',
    highlights: ['人像 / 绿幕两种模式', 'WEBM / MOV 透明背景', '分辨率与原片一致'],
    scenarios: [
      { title: '口播换背景', desc: '抠出人像，合成到产品场景、虚拟直播间' },
      { title: '绿幕素材批处理', desc: '绿幕拍摄的素材批量去背景，省去后期逐帧抠像' },
      { title: '特效合成', desc: '透明背景视频叠加到其他画面，做画中画、分身等效果' },
    ],
    tips: ['WEBM 可以直接在浏览器预览透明效果，MOV 适合导入剪辑软件', '按输出时长和分辨率计费'],
    showcase: [
      { title: '绿幕抠图', items: [video('输入视频', 'video-matting/green-before.mp4'), video('抠图结果（透明背景）', 'video-matting/green-after.webm')] },
      { title: '人像抠图', items: [video('输入视频', 'video-matting/portrait-before.mp4'), video('抠图结果（纯色背景）', 'video-matting/portrait-after.mp4')] },
    ],
  },

  'drama-script': {
    intro:
      '综合理解多集视频的画面、字幕和对白，还原出结构化的完整剧本：整体剧情梗概、人物表（外貌、性别、年龄）、分场景剧情和镜头语言，以及带说话人和情绪的逐句台词。还原结果可以直接用来生成解说视频，也适合做剧情分析和内容审核。',
    highlights: ['剧情、人物、场景、台词一次还原', '最多 100 集、累计 300 分钟', '结果可直接生成解说视频'],
    scenarios: [
      { title: '短剧解说', desc: '先还原剧本，再一键生成带 AI 配音的解说视频' },
      { title: '剧情分析', desc: '快速掌握整部剧的人物关系和情节走向' },
      { title: '内容审核', desc: '按台词和场景快速检索敏感内容' },
    ],
    tips: ['只适合真人实拍，必须有硬字幕', '所有视频分辨率需要一致，单集不超过 120 分钟'],
    showcase: [
      {
        title: '剧本还原示例',
        desc: '输入一集短剧，输出结构化剧本（官方示例，节选）',
        items: [
          video('输入的剧集（节选）', 'drama-recap/ep1.mp4'),
          {
            kind: 'text',
            label: '还原出的剧本',
            text: [
              '【剧情梗概】青年女性时月回忆，大学时她“买下”贫困学霸陆斯年……',
              '【场景 1】大学相恋甜蜜回忆：开篇是暖光柔和的卧室场景，时月以画外音回忆大学时期的恋情。镜头：平视 · 中景 · 固定镜头 · 暖调柔光',
              '【人物】时月 · 女 · 青年：大学时与陆斯年相恋四年，曾穿黑色亮饰上衣……',
              '【台词】00:00:00.440 时月（平静略带回忆感）：“大学时，我曾买过一个男朋友”',
            ].join('\n'),
          },
        ],
      },
    ],
  },

  'drama-recap': {
    intro:
      '基于剧情理解自动撰写解说词，配上 AI 配音和精准匹配的画面，批量生成解说视频，可擦除原字幕并加上短剧包装。通用版基于「剧本还原」的结果生成，解说词可以 AI 自动写，也可以自己写；短剧版直接输入原片，支持文字解说和旁白解说两种形式，专为短剧投放优化。',
    highlights: ['AI 自动撰写解说词，也可自己写', '11 种 AI 配音音色', '短剧版支持文字解说 / 旁白解说'],
    scenarios: [
      { title: '影视解说号', desc: '电影、电视剧批量生成带配音的解说视频' },
      { title: '短剧投放', desc: '一部剧生成多条解说素材，快速测试投放效果' },
      { title: '剧情速看', desc: '把几十集的剧浓缩成几分钟的剧情解说' },
    ],
    tips: ['通用版需要先在「剧本还原」里还原剧本', '短剧版只支持 1080P，所有视频分辨率需一致'],
    showcase: [
      {
        title: '通用版：原片 → 解说视频',
        desc: '带 AI 配音和解说字幕，擦除原字幕并加上剧名、角标（输入为节选）',
        items: [video('第 1 集', 'drama-recap/ep1.mp4'), video('第 2 集', 'drama-recap/ep2.mp4'), video('输出的解说视频', 'drama-recap/recap.mp4')],
      },
      {
        title: '短剧版：文字解说 / 旁白解说',
        desc: '文字解说是原片高光加屏幕文字；旁白解说是 AI 配音讲述剧情',
        items: [video('文字解说', 'drama-recap/vertical-text.mp4'), video('旁白解说', 'drama-recap/vertical-narrate.mp4')],
      },
      TEMPLATES,
    ],
  },

  'extract-frames': {
    intro:
      '按固定时间间隔、镜头切换或首尾帧，把视频批量截成图片，可以限定图片尺寸，还能把多张截图合成一张雪碧图。适合挑封面、做分镜参考、整理素材和给 AI 做视觉分析的输入。',
    highlights: ['按间隔 / 按镜头切换抽帧', '首帧、尾帧一键截取', '可合成雪碧图'],
    scenarios: [
      { title: '挑封面', desc: '每秒截一帧，从中挑最好看的一张做封面' },
      { title: '拆分镜', desc: '按镜头切换截图，快速拆解爆款视频的分镜结构' },
      { title: '视频预览图', desc: '生成雪碧图，用于进度条拖动时的缩略图预览' },
    ],
    tips: ['单次最多 1000 张', '每千张 0.1 元，几乎可以忽略不计'],
    showcase: [
      { title: '每 10 秒截一帧', desc: '16 秒的视频输出 2 张截图', items: [image('第 1 张', 'extract-frames/frame-1.jpg'), image('第 2 张', 'extract-frames/frame-2.jpg')] },
    ],
  },

  'face-blur': {
    intro:
      '逐帧检测画面中的所有人脸并持续跟踪，自动打上马赛克或高斯模糊，人物转头、走动也不会漏打。三档遮挡强度可选，灵敏度可调，保护路人和未授权出镜人员的隐私。',
    highlights: ['自动检测、跟踪所有人脸', '马赛克 / 高斯模糊', '三档遮挡强度'],
    scenarios: [
      { title: '街拍探店', desc: '给画面里的路人统一打码，避免肖像权纠纷' },
      { title: '新闻纪实', desc: '保护受访者和未成年人隐私' },
      { title: '内部资料外发', desc: '会议、培训视频对外发布前做脱敏处理' },
    ],
    tips: ['视频不超过 10 分钟，帧率 25 – 60', '模糊、侧脸漏打时可以调高检测灵敏度'],
    showcase: [{ title: '原视频 / 马赛克 / 高斯模糊', items: [video('三种效果对比', 'face-blur/compare.mp4', true)] }],
  },

  'face-swap': {
    intro:
      '上传一段视频和一张清晰的正脸照片，自动把视频中画面最大的人脸替换成照片里的人脸，完整保留原视频的表情、口型和动作，光影过渡自然。',
    highlights: ['保留原视频表情和动作', '一张照片即可', '支持 1080P'],
    scenarios: [
      { title: '数字人形象替换', desc: '同一套口播视频，快速换成不同的数字人形象' },
      { title: '广告本地化', desc: '同一条广告换成不同地区的模特面孔' },
      { title: '创意娱乐', desc: '经授权后制作趣味换脸视频' },
    ],
    tips: ['仅支持 MP4，不超过 10 分钟、1080P', '照片需清晰、无遮挡的正脸，不支持动漫', '请确保已获得肖像授权，禁止用于违法用途'],
    showcase: [{ items: [video('换脸前', 'face-swap/before.mp4'), image('目标人脸', 'face-swap/face.jpg'), video('换脸后', 'face-swap/after.mp4')], title: '视频换脸' }],
  },

  'lip-sync': {
    intro:
      '给一段真人视频配上新的音频，自动重绘嘴部区域，让口型和新配音严格对齐。音频比视频长时，可以让视频正放、倒放往复循环补齐时长，适合多语种翻译配音和口播改词。',
    highlights: ['口型自然贴合新配音', '音频更长时自动往复循环', '适合多语种配音'],
    scenarios: [
      { title: '口播改词', desc: '文案改了不用重拍，录一段新配音对上口型即可' },
      { title: '多语种出海', desc: '中文视频配上英文、西语配音后对口型' },
      { title: '数字人驱动', desc: '用一段固定的人物视频，驱动不同的讲解音频' },
    ],
    tips: ['视频为 MP4、单人真人出镜，不超过 30 分钟', '音频建议是清晰的单人声', '处理耗时约为音频时长的 6 – 8 倍'],
    showcase: [{ title: '视频 + 新配音 → 口型对齐', items: [video('原人物视频', 'lip-sync/video.mp4'), audio('新配音', 'lip-sync/audio.m4a'), video('口型对齐后', 'lip-sync/result.mp4')] }],
  },

  'ai-highlights': {
    intro:
      '由视觉大模型逐段看懂视频内容，按行业预设规则或你自己的评分标准挑出高光片段，再按目标时长编排成节奏流畅的集锦，每个片段都附带标题、摘要和入选理由。内置足球、篮球、汽车、财经、发布会、电商带货、知识分享、短剧 8 种行业预设。',
    highlights: ['8 种行业预设，也可自定义标准', '一次生成最多 5 个时长版本', '片段附带标题和入选理由'],
    scenarios: [
      { title: '赛事集锦', desc: '90 分钟比赛剪成 60 秒进球和精彩扑救集锦' },
      { title: '发布会精华', desc: '两小时发布会剪成 3 分钟核心亮点' },
      { title: '直播切片', desc: '带货直播回放自动剪出产品讲解和优惠高光' },
      { title: '课程精华', desc: '长课程提炼出知识点密集的精华片段' },
    ],
    tips: ['单个视频不超过 3 小时，累计不超过 15 小时', '最多同时生成 5 个时长版本'],
  },

  'reframe-vertical': {
    intro:
      '自动识别每个镜头里的主体并平滑跟随裁切，把 16:9、4:3、21:9 的横屏视频转成 9:16 竖屏，人物不会被切掉、镜头也不会乱晃。还可以同时烧录 SRT / ASS 字幕，导出即可发抖音、快手、视频号。',
    highlights: ['主体智能跟随，不是简单居中裁切', '可同时烧录字幕', '支持 4 小时长视频'],
    scenarios: [
      { title: '影视转短视频', desc: '横屏影视素材一键转竖屏，适配短视频平台' },
      { title: '横屏口播转投放', desc: '横屏拍摄的口播转成竖屏投放素材' },
      { title: '直播回放二创', desc: '横屏直播回放转竖屏切片' },
    ],
    tips: ['支持 16:9、4:3、21:9 横屏，不超过 4 小时'],
    showcase: [{ title: '横屏转竖屏', items: [video('横屏原片', 'reframe-vertical/before.mp4'), video('竖屏成片', 'reframe-vertical/after.mp4')] }],
  },

  'erase-image': {
    intro:
      '自动识别并擦除图片中的文字、图标和水印，也可以只擦指定的文字，或者用画笔涂抹、框选任意区域，由 AI 根据周围内容补全背景，修复后看不出痕迹。',
    highlights: ['全图文字 / 图标一键擦除', '涂抹或框选任意区域', '只擦指定文字'],
    scenarios: [
      { title: '商品图清理', desc: '去掉图片上的促销文字和平台水印' },
      { title: '照片修复', desc: '去掉照片里的路人、杂物和电线' },
      { title: '素材复用', desc: '擦掉旧文案，重新排版新的宣传语' },
    ],
    tips: ['尺寸 10×10 – 2560×1440，不超过 10MB'],
    showcase: [{ title: '原图 / 擦除文字 / 擦除图标', items: [image('效果对比', 'erase-image/compare.jpg')] }],
  },

  'remove-background': {
    intro:
      '精准识别人像、商品或通用主体，去掉背景并输出透明图，发丝级边缘处理。人像和商品场景还能自动描边、裁掉多余的透明空白，直接用于海报和主图设计。',
    highlights: ['人像 / 商品 / 通用三种场景', '发丝级边缘', '可描边、自动裁边'],
    scenarios: [
      { title: '电商主图', desc: '商品图一键变白底、透明底，满足平台主图规范' },
      { title: '证件照换底', desc: '人像抠出后换成红、蓝、白任意底色' },
      { title: '海报设计', desc: '抠出主体加描边，直接拖进设计稿' },
    ],
    tips: ['不超过 30MB，通用场景最长边 10240 像素'],
    showcase: [{ title: '人像抠图', desc: '左：描边效果；右：透明背景', items: [image('效果展示', 'remove-background/compare.jpg')] }],
  },

  'expand-image': {
    intro:
      '按设定的比例向上下左右扩展画布，AI 根据原图的内容、光影和风格自然补全新增的区域。竖图改横图、横图改竖图，或者给构图太满的照片留出呼吸感，都只要一步。',
    highlights: ['四个方向独立调整', '补全内容与原图风格一致', '竖图横图互转'],
    scenarios: [
      { title: '改比例', desc: '竖版商品图扩成横版 Banner，横图扩成竖版海报' },
      { title: '构图调整', desc: '人像构图太满时向外扩展，留出文字排版空间' },
      { title: '社交平台适配', desc: '一张图扩成不同平台需要的尺寸' },
    ],
    tips: ['原图最长边不超过 4160 像素，不超过 10MB', '每边最多扩展短边的 40%，需要更大时可以多次扩展'],
    showcase: [
      { title: '竖图扩成横图', items: [image('原图 764×1146', 'expand-image/ex1-before.jpg'), image('扩图后 2290×1146', 'expand-image/ex1-after.jpg')] },
      { title: '横图扩成竖图', items: [image('原图 750×500', 'expand-image/ex2-before.jpg'), image('扩图后', 'expand-image/ex2-after.jpg')] },
    ],
  },

  'remove-image-elements': {
    intro:
      '专为电商图片训练，自动识别并擦除价格标签、促销文案、贴纸、水印等"牛皮癣"元素，完整保留商品主体和背景，不需要任何框选和参数。',
    highlights: ['自动识别牛皮癣元素', '完整保留商品主体', '无需任何参数'],
    scenarios: [
      { title: '电商搬家', desc: '把其他平台的商品图清理干净后重新上架' },
      { title: '供应商图片净化', desc: '去掉供货商图片上的水印和价格贴' },
      { title: '旧图焕新', desc: '主图上过期的促销信息一键清除' },
    ],
    tips: ['宽 128 – 2560、高 128 – 1440 像素，不支持动图'],
    showcase: [{ title: '原图 → 效果图', items: [image('效果对比', 'remove-image-elements/compare.jpg')] }],
  },

  'product-scene': {
    intro:
      '自动识别商品主体，把它放进预设场景或你描述的场景里，生成光影自然、透视正确的商品场景图，一次最多 4 张。标准版有 30 种预设场景开箱即用；专业版可以上传风格参考图，用中文描述自由创作。',
    highlights: ['30 种预设场景', '一次最多生成 4 张', '专业版支持风格参考图'],
    scenarios: [
      { title: '电商主图', desc: '白底商品图秒变氛围感场景图，提升点击率' },
      { title: '节日营销', desc: '同一个商品快速生成不同节日主题的场景' },
      { title: '种草图文', desc: '批量生成家居、户外等生活化场景图' },
    ],
    tips: ['商品图建议主体清晰、背景简单', '按成功生成的张数计费'],
    showcase: [1, 2, 3].map((n) => ({
      title: `示例 ${n}`,
      desc: '只上传一张抠好的商品图，自动生成光影自然、透视正确的场景图',
      items: [image('商品图', `product-scene/ex${n}-before.png`), image('生成的场景图', `product-scene/ex${n}-after.jpg`)],
    })),
  },

  'separate-voice': {
    intro:
      '从视频或音频中分离出干净的人声和背景音；影视、解说、游戏场景还能进一步拆成人声、音乐、音效三轨。分离后的音轨可以单独替换、单独调音量，方便重新配音、配乐和二次创作。',
    highlights: ['两轨 / 三轨分离', '视频可直接输入', 'MP3、WAV 等多种格式'],
    scenarios: [
      { title: '重新配音', desc: '去掉原人声，保留背景音乐和音效，换成新的配音' },
      { title: '提取伴奏', desc: '分离出伴奏用于翻唱，或提取干声用于混音' },
      { title: '换背景音乐', desc: '保留原对白，把背景音乐换成无版权风险的曲子' },
    ],
    tips: ['影视、解说、游戏场景输出人声、音乐、音效三轨'],
    showcase: [
      {
        title: '短剧片段分离',
        items: [video('原视频', 'separate-voice/input.mp4'), audio('分离出的人声', 'separate-voice/voice.m4a'), audio('分离出的背景音', 'separate-voice/background.m4a')],
      },
    ],
  },

  'edit-speech': {
    intro:
      '像改文字一样修改录音里说错的话：指定原话和新文案，AI 用原说话人的音色、语气重新合成这一句并无缝替换，前后衔接自然。输入视频时，口播内容一起修改，不用重新录制。',
    highlights: ['保留原说话人的音色', '一次最多改 10 处', '视频、音频都能改'],
    scenarios: [
      { title: '口播改价格', desc: '价格、日期说错了，不用重拍整条视频' },
      { title: '课程勘误', desc: '课程录音里的术语、数据说错时局部更正' },
      { title: '广告多版本', desc: '同一条广告改几个关键词，快速出多个版本' },
    ],
    tips: ['目前只支持中文', '原话尽量短（10 字以内）、贴近实际发音，数字写成读出来的样子，如“九块九”', '同一句话出现多次时填上大概的时间段', '没找到要改的原话时自动退款'],
    showcase: [
      {
        title: '把“九块九”改成“十九块九”',
        desc: '直播口播里说错的价格，只改这一句，音色和前后语气保持不变（第 9 秒附近）',
        items: [video('原视频', 'edit-speech/before.mp4'), video('修改后', 'edit-speech/after.mp4')],
      },
    ],
  },
};
