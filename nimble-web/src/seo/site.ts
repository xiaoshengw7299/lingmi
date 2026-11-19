import { GENERAL_TOOL_MENU, VIDEO_TOOL_MENU, VIRAL_CLONE, toolPath, type ToolMenuItem } from '../views/tools/menu'

/** 正式站。canonical、sitemap、结构化数据都用这个地址 */
export const SITE_ORIGIN = 'https://lingmi.ly.hb.cn'
export const SITE_NAME = '灵米 LingMI'
export const COMPANY_NAME = '广州市灵予科技有限公司'
export const CONTACT_EMAIL = 'lingyutech@yeah.net'

export const HOME_TITLE = '灵米 LingMI · AI 视频创作平台'
export const HOME_DESCRIPTION =
  '灵米（LingMI，也写作灵米LingMI）是广州市灵予科技有限公司的 AI 视频创作平台。支持视频制作、一键成片、爆款复刻和视频工具，对话生成脚本、画面、配音和成片。按量计费，失败自动退回。'

/** 首页和结构化数据里强调的能力。视频换脸留在工具名单中，不放进这里 */
export const FEATURE_LIST = [
  '视频制作：对话生成分镜、逐镜出片并合成',
  '无限画布：用节点和连线组织图片、视频、音频参考',
  '一键成片：文案、配音、字幕、配乐一次合成，可生成抖音和小红书发布码',
  '爆款复刻：提取动作和运镜，换成自己的人物与商品后重新生成',
  '视频工具：字幕擦除、高光智剪、解说、口型对齐、转码、横转竖',
  '图片与音频工具：电商主图、抠图、扩图、牛皮癣擦除、人声分离',
]

export const HOME_COPY = {
  h1: '把手机实拍素材，剪成带配音和字幕的短视频',
  lead: '上传几段实拍素材，填一个视频主题。灵米帮你写文案、配音、加字幕，生成一条可下载的竖屏短视频。',
  featuresTitle: '从灵感到成片，一个平台做完',
  featuresLead: '视频制作、一键成片、爆款复刻和后期工具都在这里，随用随开，不用来回换软件。',
  scenariosTitle: '按场景选用工具',
  scenariosLead: '点名称进入对应工具，上传素材后按量计费。',
  stepsTitle: '三步，种子长成视频',
  pricingTitle: '价格透明，充多少用多少',
  pricingLead: '每个模型的单价都公开，和官方价格并排对比；部分模型比官方更低。失败的不收费。',
  faqTitle: '常见问题',
}

export interface HomeFeature {
  path: string
  icon: string
  tone: string
  title: string
  desc: string
  points: string[]
  links?: Array<{ label: string; path: string }>
}

export const HOME_FEATURES: HomeFeature[] = [
  {
    path: '/video-producer/studio',
    icon: 'VideoCamera',
    tone: '#0b8f5f',
    title: '视频制作',
    desc: '通用创作用对话写出分镜，再逐镜生成画面和视频。无限画布把素材连成节点，适合来回试镜头。',
    points: ['对话生成分镜与脚本', '素材库和 @ 引用保持角色一致', '逐镜生成、挑选、合成成片'],
    links: [{ label: '打开无限画布', path: '/video-producer/canvas' }],
  },
  {
    path: '/short-video',
    icon: 'Film',
    tone: '#e39b12',
    title: '一键成片',
    desc: '给一条提示词，自动写文案、配音、配字幕、找素材并合成。',
    points: ['文案、配音、字幕一次完成', '一次可排队多条，每条文案都会重写', '成片可生成发布码，发到抖音或小红书'],
  },
  {
    path: '/viral-clone',
    icon: 'MagicStick',
    tone: '#08724c',
    title: '爆款复刻',
    desc: '抽出一段视频的动作和运镜，换成你的人物、商品和场景，生成一条新视频。',
    points: ['只学动作和镜头运动', '人物、服装和背景都会换成新的', '同一套动作可以换模型再生成'],
  },
  {
    path: '#scenarios',
    icon: 'Tools',
    tone: '#0f766e',
    title: '创作工具',
    desc: '字幕、高光、口播和电商图不用再换软件。选一个场景，上传素材就能开始。',
    points: ['短剧：高光、解说、擦字幕、横转竖', '电商：主图、抠图、扩图、去牛皮癣', '口播：对口型、转字幕、分离人声'],
  },
]

export const HOME_SCENARIOS = [
  {
    title: '电商',
    desc: '商品图、主图和带货素材',
    tools: [
      { title: '电商万创', path: '/general-tools/product-scene' },
      { title: '牛皮癣擦除', path: '/general-tools/remove-image-elements' },
      { title: '智能抠图', path: '/general-tools/remove-background' },
      { title: '智能扩图', path: '/general-tools/expand-image' },
    ],
  },
  {
    title: '短剧',
    desc: '高光、解说和出海字幕',
    tools: [
      { title: '高光智剪 · 短剧', path: '/video-tools/drama-highlights' },
      { title: '解说视频生成', path: '/video-tools/drama-recap' },
      { title: '字幕擦除', path: '/video-tools/erase-subtitle' },
      { title: '视频横转竖', path: '/video-tools/reframe-vertical' },
    ],
  },
  {
    title: '口播与课程',
    desc: '配音、字幕和口型',
    tools: [
      { title: '视频口型对齐', path: '/video-tools/lip-sync' },
      { title: '语音转字幕', path: '/video-tools/asr' },
      { title: '人声背景音分离', path: '/general-tools/separate-voice' },
      { title: '音频内容编辑', path: '/general-tools/edit-speech' },
    ],
  },
  {
    title: '剪辑整理',
    desc: '转码、抽帧和高光',
    tools: [
      { title: '视频转码', path: '/video-tools/transcode' },
      { title: '视频抽帧', path: '/video-tools/extract-frames' },
      { title: 'AI 高光剪辑', path: '/video-tools/ai-highlights' },
      { title: '视频人脸打码', path: '/video-tools/face-blur' },
    ],
  },
]

export const HOME_STEPS = [
  { title: '说出灵感', desc: '一句话、一张商品图，或一段已有视频，不需要会写脚本。' },
  { title: 'AI 创作', desc: '脚本、画面、配音、字幕交给模型；已有素材也可以直接擦字幕、剪高光、对口型。' },
  { title: '成片导出', desc: '合成高清成片，下载或生成发布码。花了多少钱，账单里一清二楚。' },
]

/** 价格说明：首页价格区和价格页共用 */
export const PRICE_STATEMENT = {
  title: '没有会员，没有套路',
  desc: '灵米不设会员、订阅和套餐，也没有最低消费，只是直接接入各模型的官方 API。官方对大额充值的企业提供折扣，我们把这部分优惠让给用户，所以不少模型比官方价更低。价目表里每个模型都并排标出官方价和差价。',
}

export const HOME_PROMISES = [
  { icon: 'Coin', title: '没有会员和套路', desc: '不设会员、订阅和套餐，没有最低消费，余额不过期' },
  { icon: 'Connection', title: '直接对接官方 API', desc: '每个模型都标出官方价与差价，用多少扣多少' },
  { icon: 'Present', title: '官方折扣让给你', desc: '我们拿到的大额充值折扣，让给用户' },
]

export const FAQ = [
  { q: '灵米是什么，是谁运营的？', a: '灵米（LingMI，也写作灵米LingMI）是 AI 视频创作平台，由广州市灵予科技有限公司运营。可以做视频制作、一键成片和爆款复刻，也可以用视频工具处理字幕、高光、口播和电商图。' },
  { q: '有会员、订阅或套餐吗？', a: '没有。灵米不设会员等级、订阅月费和限时套餐，也没有最低消费，只是单纯接入各模型的官方 API，按价目表单价用多少扣多少，余额不过期。' },
  { q: '怎么计费？会不会有隐藏费用？', a: '按价目表单价计费：视频是每秒单价乘以时长，图片按张，配音按千字，音乐按首，文本模型按 token。清晰度和配音开关不另加价。没有订阅费、没有最低消费，每一笔都能在「用户中心 → 我的钱包」里查到。' },
  { q: '生成失败会扣费吗？', a: '不会。任务提交时先扣款，如果生成失败、超时或被中断，这笔钱会自动退回余额，账单里能看到对应的退回记录。' },
  { q: '为什么部分模型比官方更便宜？', a: '官方对大额充值的企业提供折扣，我们把这部分优惠让给用户。价目表里每个模型都并排标出官方价和差价，有折扣的会显示"省"。' },
  { q: '余额会过期吗？', a: '不会。赠送和邀请奖励的余额与充值余额一样可用于消费，但不能提现。' },
  { q: '价格会变动吗？', a: '官方调价后，要等平台重新询价，新任务才会按新单价计费。加价调整后立即生效。已经提交的任务按提交时的价格，不会事后改价。' },
]

export const PRICING_NOTES = [
  { title: '怎么算', desc: '视频是每秒单价乘以时长，图片按张，配音按千字，音乐按首。和模型选择器里的单价一致，清晰度、配音开关不另加价。' },
  { title: '差价', desc: '"省"表示比官方价更低，"持平"表示与官方一致。上游调价后，要等平台重新询价，这里的价格才会变。' },
  { title: '币种', desc: '统一以人民币结算，余额 1 元 = 1 元额度。' },
]

export const PRICING_LEAD = '下面是各模型的实际单价，和官方价格并排对比。生成前就能知道花多少，充多少用多少，失败的任务自动退回，不收费。'
export const PROMPTS_LEAD = '大家共享的优质提示词，每条都附带真实生成效果。复制即用，也可以发布你自己的。'
export const FORUM_LEAD = '分享使用经验，一起讨论。选「仅管理员」时，只有你和管理员能看到，适合反馈问题。'

export const GUIDE_INTRO = '按页面上的实际步骤，说明视频制作、一键成片、爆款复刻和创作工具怎么用。工具的效果示例与各工具页是同一套素材。'

export const GUIDE_CHAPTERS = {
  clone: {
    id: 'clone',
    title: '爆款复刻',
    lead: '上传一段参考视频，先抽出动作和镜头运动，再按你的人物、商品和场景重新生成。原片里的人脸、服装和背景不会留在成片里。',
  },
  video: {
    id: 'video-tools',
    title: '视频工具',
    lead: '处理已经拍好的视频。每一项的文字说明和效果示例，与打开该工具时看到的是同一套内容。',
  },
  general: {
    id: 'general-tools',
    title: '通用工具',
    lead: '处理图片和音频。效果示例滚动到对应小节后再加载，素材和工具页相同。',
  },
} as const

export const FOOTER_LINKS = [
  { to: '/video-producer/studio', label: '视频制作' },
  { to: '/short-video', label: '一键成片' },
  { to: '/viral-clone', label: '爆款复刻' },
  { to: '/pricing', label: '模型价格' },
  { to: '/guide', label: '产品介绍' },
  { to: '/prompts', label: '提示词库' },
  { to: '/forum', label: '论坛' },
  { to: '/terms', label: '用户协议' },
  { to: '/privacy', label: '隐私政策' },
]

const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/': { title: HOME_TITLE, description: HOME_DESCRIPTION },
  '/pricing': {
    title: `模型价格 · ${SITE_NAME}`,
    description: '灵米各模型单价公开，并与官方价格并排对比。视频按秒、图片按张、配音按千字计费，没有月费，余额不过期，生成失败自动退回。',
  },
  '/guide': {
    title: `产品介绍 · ${SITE_NAME}`,
    description: '灵米产品介绍：通用创作、无限画布、一键成片、爆款复刻的操作步骤，以及字幕、剪辑、抠图、电商图等工具的说明和效果示例。',
  },
  '/terms': {
    title: `用户协议 · ${SITE_NAME}`,
    description: '灵米用户协议：服务内容、账号、按量计费与失败退回、内容规范，以及用户对上传素材和生成结果承担的责任。',
  },
  '/privacy': {
    title: `隐私政策 · ${SITE_NAME}`,
    description: `灵米隐私政策：说明账号、创作内容、充值和日志信息如何收集与存储，以及如何联系${COMPANY_NAME}。`,
  },
  '/prompts': {
    title: `提示词库 · ${SITE_NAME}`,
    description: '灵米提示词库：用户分享的图片和视频提示词，每条都带真实生成效果，可以搜索、复制，也可以发布自己的提示词。',
  },
  '/forum': {
    title: `论坛&反馈 · ${SITE_NAME}`,
    description: '灵米论坛：交流 AI 视频制作经验，提交使用反馈。公开帖所有人可见，选择仅管理员的帖子只对本人和管理员可见。',
  },
  '/video-producer/studio': {
    title: `通用创作 · ${SITE_NAME}`,
    description: '灵米视频制作的通用创作：用对话生成分镜脚本，在素材库里用 @ 保持角色一致，再逐镜生成并合成成片。',
  },
  '/video-producer/canvas': {
    title: `无限画布 · ${SITE_NAME}`,
    description: '灵米无限画布：把图片、视频、音频和文本放成节点，连线当作生成参考，也可以让画布助手搭好流程。',
  },
  '/short-video': {
    title: `一键成片 · ${SITE_NAME}`,
    description: '灵米一键成片：写一句提示词，自动完成文案、配音、字幕、素材和合成。成片可以生成发布码，发到抖音或小红书。',
  },
  '/viral-clone': {
    title: `爆款复刻 · ${SITE_NAME}`,
    description: `灵米爆款复刻：${VIRAL_CLONE.summary}。人物、服装和背景会换成新的，不保留原片画面。`,
  },
}

const NOINDEX = [/^\/user(\/|$)/, /^\/admin(\/|$)/, /^\/distributor(\/|$)/, /^\/login(\/|$)/, /^\/s\//, /^\/assets(\/|$)/]

export interface PageMeta {
  title: string
  description: string
  noindex: boolean
  canonicalPath: string
}

export function cleanPath(path: string) {
  const raw = path.split('?')[0].split('#')[0] || '/'
  if (raw.length > 1 && raw.endsWith('/')) return raw.slice(0, -1)
  return raw || '/'
}

function findTool(path: string): ToolMenuItem | undefined {
  if (path === '/viral-clone') return VIRAL_CLONE
  const video = /^\/video-tools\/([^/]+)$/.exec(path)
  if (video) return VIDEO_TOOL_MENU.find((item) => item.id === video[1])
  const general = /^\/general-tools\/([^/]+)$/.exec(path)
  if (general) return GENERAL_TOOL_MENU.find((item) => item.id === general[1])
  return undefined
}

export function pageMeta(input: string): PageMeta {
  const path = cleanPath(input)
  if (NOINDEX.some((re) => re.test(path))) {
    return { title: HOME_TITLE, description: HOME_DESCRIPTION, noindex: true, canonicalPath: path }
  }
  if (path.startsWith('/video-tools/') || path.startsWith('/general-tools/')) {
    const tool = findTool(path)
    if (!tool) return { title: HOME_TITLE, description: HOME_DESCRIPTION, noindex: true, canonicalPath: path }
    return {
      title: `${tool.title} · ${SITE_NAME}`,
      description: `灵米${tool.title}：${tool.summary}。按使用量计费，生成失败自动退回。`,
      noindex: false,
      canonicalPath: path,
    }
  }
  const known = STATIC_PAGES[path]
  if (known) return { ...known, noindex: false, canonicalPath: path }
  return { title: HOME_TITLE, description: HOME_DESCRIPTION, noindex: true, canonicalPath: path }
}

/** 会生成独立 HTML、并写进 sitemap 的公开地址 */
export function indexablePaths() {
  const tools = [
    ...VIDEO_TOOL_MENU.map((item) => toolPath(item.id, 'video')),
    ...GENERAL_TOOL_MENU.map((item) => toolPath(item.id, 'general')),
  ]
  return [
    '/',
    '/guide',
    '/pricing',
    '/video-producer/studio',
    '/video-producer/canvas',
    '/short-video',
    '/viral-clone',
    ...tools,
    '/prompts',
    '/forum',
    '/terms',
    '/privacy',
  ]
}

export function absoluteUrl(path: string) {
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`
}
