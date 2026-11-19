import { TOOL_CONTENT } from '../../nimble-ai/src/modules/media-tools/media-tools.content'
import { GUIDE } from '../src/views/guide/content'
import { createLegal, type LegalDoc } from '../src/views/legal/content'
import { buildJsonLd } from '../src/seo/schema'
import {
  absoluteUrl,
  COMPANY_NAME,
  CONTACT_EMAIL,
  FAQ,
  FOOTER_LINKS,
  GUIDE_CHAPTERS,
  GUIDE_INTRO,
  HOME_COPY,
  HOME_DESCRIPTION,
  HOME_FEATURES,
  HOME_PROMISES,
  HOME_SCENARIOS,
  HOME_STEPS,
  indexablePaths,
  pageMeta,
  PRICE_STATEMENT,
  PRICING_LEAD,
  PRICING_NOTES,
  PROMPTS_LEAD,
  FORUM_LEAD,
  SITE_ORIGIN,
} from '../src/seo/site'
import { GENERAL_TOOL_MENU, VIDEO_TOOL_MENU, VIRAL_CLONE, toolPath } from '../src/views/tools/menu'

export interface SeoDocument {
  path: string
  title: string
  description: string
  canonicalPath: string
  body: string
  jsonLd: ReturnType<typeof buildJsonLd>
}

function esc(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function paras(list?: string[]) {
  return (list ?? []).map((text) => `<p>${esc(text)}</p>`).join('')
}

function link(path: string, label: string) {
  return `<a href="${esc(absoluteUrl(path))}">${esc(label)}</a>`
}

function toolArticle(id: string, title: string, path: string, level: 'h1' | 'h2' | 'h3' | 'none' = 'h2') {
  const content = TOOL_CONTENT[id]
  const summary = content?.intro || ''
  const highlights = (content?.highlights ?? []).map((item) => `<li>${esc(item)}</li>`).join('')
  const scenarios = (content?.scenarios ?? []).map((item) => `<li><b>${esc(item.title)}</b>：${esc(item.desc)}</li>`).join('')
  const tips = (content?.tips ?? []).map((item) => `<li>${esc(item)}</li>`).join('')
  const heading = level === 'none' ? '' : `<${level}>${esc(title)}</${level}>`
  return `<section id="${esc(id)}">
    ${heading}
    ${paras(summary ? [summary] : [])}
    ${highlights ? `<ul>${highlights}</ul>` : ''}
    ${scenarios ? `<h3>适合的场景</h3><ul>${scenarios}</ul>` : ''}
    ${tips ? `<h3>使用时注意</h3><ul>${tips}</ul>` : ''}
    <p>${link(path, `打开${title}`)}</p>
  </section>`
}

function renderHome() {
  const features = HOME_FEATURES.map((feature) => {
    const points = feature.points.map((point) => `<li>${esc(point)}</li>`).join('')
    const extra = (feature.links ?? []).map((item) => link(item.path, item.label)).join(' ')
    const target = feature.path.startsWith('#') ? `${SITE_ORIGIN}/${feature.path}` : absoluteUrl(feature.path)
    return `<section>
      <h3><a href="${esc(target)}">${esc(feature.title)}</a></h3>
      <p>${esc(feature.desc)}</p>
      <ul>${points}</ul>
      ${extra ? `<p>${extra}</p>` : ''}
    </section>`
  }).join('')
  const scenarios = HOME_SCENARIOS.map((group) => {
    const tools = group.tools.map((tool) => `<li>${link(tool.path, tool.title)}</li>`).join('')
    return `<section><h3>${esc(group.title)}</h3><p>${esc(group.desc)}</p><ul>${tools}</ul></section>`
  }).join('')
  const steps = HOME_STEPS.map((step, index) => `<li><b>${index + 1}. ${esc(step.title)}</b> ${esc(step.desc)}</li>`).join('')
  const promises = HOME_PROMISES.map((item) => `<li><b>${esc(item.title)}</b>：${esc(item.desc)}</li>`).join('')
  const faq = FAQ.map((item) => `<section><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></section>`).join('')
  const footer = FOOTER_LINKS.map((item) => link(item.to, item.label)).join(' ')
  return `<header>
      <p>灵米 LingMI · AI 视频创作平台</p>
      <h1>${esc(HOME_COPY.h1)}</h1>
      <p>${esc(HOME_COPY.lead)}</p>
      <p>灵米（LingMI，也写作灵米LingMI）由${esc(COMPANY_NAME)}运营，提供视频制作、一键成片、爆款复刻和视频工具。</p>
      <p>${link('/short-video', '开始一键成片')} ${link('/pricing', '查看模型价格')}</p>
    </header>
    <section>
      <h2>${esc(HOME_COPY.featuresTitle)}</h2>
      <p>${esc(HOME_COPY.featuresLead)}</p>
      ${features}
    </section>
    <section id="scenarios">
      <h2>${esc(HOME_COPY.scenariosTitle)}</h2>
      <p>${esc(HOME_COPY.scenariosLead)}</p>
      ${scenarios}
    </section>
    <section>
      <h2>${esc(HOME_COPY.stepsTitle)}</h2>
      <ol>${steps}</ol>
    </section>
    <section>
      <h2>${esc(HOME_COPY.pricingTitle)}</h2>
      <p>${esc(HOME_COPY.pricingLead)}</p>
      <p>${esc(PRICE_STATEMENT.desc)}</p>
      <ul>${promises}</ul>
      <p>各模型的实时单价在页面中加载，并与官方价格并排显示。</p>
      <p>${link('/pricing', '查看全部模型价格')}</p>
    </section>
    <section>
      <h2>${esc(HOME_COPY.faqTitle)}</h2>
      ${faq}
    </section>
    <footer>
      <p>${footer}</p>
      <p>© ${new Date().getFullYear()} 灵米 LingMI · ${esc(COMPANY_NAME)}</p>
    </footer>`
}

function renderGuide() {
  const chapters = GUIDE.map((chapter) => {
    const sections = chapter.sections.map((section) => {
      const blocks = section.blocks.map((block) => {
        const points = (block.points ?? []).map((point) => `<li>${esc(point)}</li>`).join('')
        return `<section><h4>${esc(block.title)}</h4>${paras(block.paragraphs)}${points ? `<ul>${points}</ul>` : ''}</section>`
      }).join('')
      const tips = (section.tips ?? []).map((tip) => `<li>${esc(tip)}</li>`).join('')
      const open = section.to ? link(section.to, section.toLabel || section.title) : ''
      return `<section id="${esc(section.id)}"><h3>${esc(section.title)}</h3>${open ? `<p>${open}</p>` : ''}${blocks}${tips ? `<ul>${tips}</ul>` : ''}</section>`
    }).join('')
    return `<section id="${esc(chapter.id)}">
      <h2>${esc(chapter.title)}</h2>
      <p>${esc(chapter.lead)}</p>
      <p>${link(chapter.to, chapter.toLabel)}</p>
      ${sections}
    </section>`
  }).join('')
  const clone = toolArticle(VIRAL_CLONE.id, GUIDE_CHAPTERS.clone.title, '/viral-clone', 'none')
  const videos = VIDEO_TOOL_MENU.map((item) => toolArticle(item.id, item.title, toolPath(item.id, 'video'), 'h3')).join('')
  const generals = GENERAL_TOOL_MENU.map((item) => toolArticle(item.id, item.title, toolPath(item.id, 'general'), 'h3')).join('')
  return `<header>
      <h1>产品介绍</h1>
      <p>${esc(GUIDE_INTRO)}</p>
    </header>
    ${chapters}
    <section id="${GUIDE_CHAPTERS.clone.id}"><h2>${esc(GUIDE_CHAPTERS.clone.title)}</h2><p>${esc(GUIDE_CHAPTERS.clone.lead)}</p>${clone}</section>
    <section id="${GUIDE_CHAPTERS.video.id}"><h2>${esc(GUIDE_CHAPTERS.video.title)}</h2><p>${esc(GUIDE_CHAPTERS.video.lead)}</p>${videos}</section>
    <section id="${GUIDE_CHAPTERS.general.id}"><h2>${esc(GUIDE_CHAPTERS.general.title)}</h2><p>${esc(GUIDE_CHAPTERS.general.lead)}</p>${generals}</section>`
}

function renderLegal(doc: LegalDoc, other: { path: string; label: string }) {
  const sections = doc.sections.map((section, index) => {
    const items = (section.items ?? []).map((item) => `<li>${esc(item)}</li>`).join('')
    return `<section><h2>${index + 1}. ${esc(section.heading)}</h2>${paras(section.paragraphs)}${items ? `<ul>${items}</ul>` : ''}</section>`
  }).join('')
  return `<article>
    <h1>${esc(doc.title)}</h1>
    <p>更新日期：${esc(doc.updatedAt)}</p>
    <p>${esc(doc.intro)}</p>
    ${sections}
    <p>${link(other.path, other.label)} ${link('/', '返回首页')}</p>
  </article>`
}

function renderSimple(title: string, lead: string, more?: string) {
  return `<article><h1>${esc(title)}</h1><p>${esc(lead)}</p>${more ?? ''}<p>${link('/', '返回首页')}</p></article>`
}

function bodyFor(path: string, company: string, email?: string) {
  if (path === '/') return renderHome()
  if (path === '/guide') return renderGuide()
  if (path === '/pricing') {
    const notes = PRICING_NOTES.map((note) => `<li><b>${esc(note.title)}</b>：${esc(note.desc)}</li>`).join('')
    const faq = FAQ.map((item) => `<section><h2>${esc(item.q)}</h2><p>${esc(item.a)}</p></section>`).join('')
    return renderSimple('模型价格，一目了然', PRICING_LEAD, `<p>${esc(PRICE_STATEMENT.desc)}</p><ul>${notes}</ul><p>价目表在页面打开后按当前模型加载。</p>${faq}`)
  }
  if (path === '/prompts') return renderSimple('提示词库', PROMPTS_LEAD, '<p>提示词列表在页面打开后加载。</p>')
  if (path === '/forum') return renderSimple('论坛&反馈', FORUM_LEAD, '<p>帖子列表在页面打开后加载。</p>')
  if (path === '/terms' || path === '/privacy') {
    const docs = createLegal(company, email)
    return path === '/terms'
      ? renderLegal(docs.terms, { path: '/privacy', label: '查看隐私政策' })
      : renderLegal(docs.privacy, { path: '/terms', label: '查看用户协议' })
  }
  const video = VIDEO_TOOL_MENU.find((item) => toolPath(item.id, 'video') === path)
  if (video) return toolArticle(video.id, video.title, path, 'h1') + `<p>${link('/guide', '查看产品介绍')}</p>`
  const general = GENERAL_TOOL_MENU.find((item) => toolPath(item.id, 'general') === path)
  if (general) return toolArticle(general.id, general.title, path, 'h1') + `<p>${link('/guide', '查看产品介绍')}</p>`
  if (path === '/viral-clone') return toolArticle(VIRAL_CLONE.id, VIRAL_CLONE.title, path, 'h1')
  if (path === '/video-producer/studio') {
    return renderSimple('通用创作', '用对话生成分镜脚本，在素材库里用 @ 保持角色一致，再逐镜生成并合成成片。', `<p>${link('/video-producer/canvas', '无限画布')} ${link('/guide', '查看产品介绍')}</p>`)
  }
  if (path === '/video-producer/canvas') {
    return renderSimple('无限画布', '把图片、视频、音频和文本放成节点，连线当作生成参考，也可以让画布助手搭好流程。', `<p>${link('/video-producer/studio', '通用创作')} ${link('/guide', '查看产品介绍')}</p>`)
  }
  if (path === '/short-video') {
    return renderSimple('一键成片', '写一句提示词，自动完成文案、配音、字幕、素材和合成。成片可以生成发布码，发到抖音或小红书。', `<p>${link('/guide', '查看产品介绍')}</p>`)
  }
  return `<article><h1>${esc(pageMeta(path).title)}</h1><p>${esc(HOME_DESCRIPTION)}</p></article>`
}

export function buildDocuments(company = COMPANY_NAME, email = CONTACT_EMAIL): SeoDocument[] {
  return indexablePaths().map((path) => {
    const meta = pageMeta(path)
    return {
      path,
      title: meta.title,
      description: meta.description,
      canonicalPath: meta.canonicalPath,
      body: bodyFor(path, company, email),
      jsonLd: buildJsonLd(path),
    }
  })
}

export function robotsTxt() {
  return `# 公开页面允许搜索引擎和生成式搜索抓取
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /user/
Disallow: /distributor/
Disallow: /login
Disallow: /s/
Disallow: /assets/
Disallow: /socket.io
Disallow: /spa-shell.html

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`
}

export function sitemapXml(paths: string[]) {
  const lastmod = new Date().toISOString().slice(0, 10)
  const urls = paths.map((path) => {
    const priority = path === '/' ? '1.0' : path === '/guide' || path === '/pricing' ? '0.8' : '0.6'
    return `  <url><loc>${esc(absoluteUrl(path))}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${priority}</priority></url>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

function toolLines(withIntro: boolean) {
  const items = [
    { ...VIRAL_CLONE, path: toolPath(VIRAL_CLONE.id) },
    ...VIDEO_TOOL_MENU.map((item) => ({ ...item, path: toolPath(item.id, 'video') })),
    ...GENERAL_TOOL_MENU.map((item) => ({ ...item, path: toolPath(item.id, 'general') })),
  ]
  return items.map((item) => {
    const intro = withIntro ? TOOL_CONTENT[item.id]?.intro : item.summary
    return `- [${item.title}](${absoluteUrl(item.path)}): ${intro || item.summary}`
  }).join('\n')
}

export function llmsTxt() {
  return `# 灵米 LingMI

> 灵米（LingMI，也写作灵米LingMI）是${COMPANY_NAME}（广州市灵予科技）运营的 AI 视频创作平台，网站为 ${SITE_ORIGIN}/ 。用户用中文描述想法，或上传已有素材，完成视频制作、一键成片、爆款复刻，或用视频工具处理成片。计费为人民币余额按量扣费，没有月费，生成失败自动退回。

## 关键事实

- 产品名：灵米。英文名 LingMI。连写为灵米LingMI，中间加空格为灵米 LingMI。这些名字指同一个产品。
- 运营主体：${COMPANY_NAME}，也称为广州市灵予科技
- 联系邮箱：${CONTACT_EMAIL}
- 网站：${SITE_ORIGIN}/
- 语言：简体中文
- 登录方式：微信扫码，也可使用账号和密码
- 计费：充值余额，按模型单价扣费，余额不过期；赠送和奖励不可提现

## 核心能力

- [视频制作 / 通用创作](${SITE_ORIGIN}/video-producer/studio): 对话生成分镜脚本，素材库用 @ 保持角色一致，逐镜生成后合成成片。
- [无限画布](${SITE_ORIGIN}/video-producer/canvas): 图片、视频、音频、文本节点，连线即参考，可让画布助手搭流程。
- [一键成片](${SITE_ORIGIN}/short-video): 一句提示词完成文案、配音、字幕、素材和合成，成片可生成抖音或小红书发布码。
- [爆款复刻](${SITE_ORIGIN}/viral-clone): 提取参考视频的动作和镜头运动，换成用户自己的人物和商品后重新生成，不保留原片画面。
- [视频工具](${SITE_ORIGIN}/guide#video-tools): 处理已经拍好的视频，包括字幕擦除、高光智剪、解说、口型对齐、转码和横转竖。
- [模型价格](${SITE_ORIGIN}/pricing): 单价公开，与官方价并排，部分模型更低。
- [产品介绍](${SITE_ORIGIN}/guide): 操作步骤和各工具说明。

## 工具

${toolLines(false)}

## 其他公开页

- [提示词库](${SITE_ORIGIN}/prompts)
- [论坛](${SITE_ORIGIN}/forum)
- [用户协议](${SITE_ORIGIN}/terms)
- [隐私政策](${SITE_ORIGIN}/privacy)

## 不要索引

管理后台、用户钱包、分销后台、登录页，以及某个用户的扫码发布页（/s/）不对外公开。

更完整的说明见 ${SITE_ORIGIN}/llms-full.txt
`
}

export function llmsFullTxt() {
  return `${llmsTxt()}
## 工具说明

${toolLines(true)}

## 常见问题

${FAQ.map((item) => `### ${item.q}\n\n${item.a}`).join('\n\n')}

## 关于平台

${HOME_DESCRIPTION}
运营主体是${COMPANY_NAME}。联系邮箱 ${CONTACT_EMAIL}。
`
}
