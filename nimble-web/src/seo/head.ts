import { buildJsonLd } from './schema'
import { absoluteUrl, pageMeta, SITE_NAME } from './site'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

function setJsonLd(path: string) {
  const data = buildJsonLd(path)
  let el = document.getElementById('lingmi-ld')
  if (!data) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('script')
    el.id = 'lingmi-ld'
    el.setAttribute('type', 'application/ld+json')
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

/** 路由切换后同步标题、摘要、canonical 和结构化数据。首屏 HTML 由构建时的预渲染写入 */
export function applyHead(path: string, routeTitle?: string) {
  const meta = pageMeta(path)
  const title = path === '/404'
    ? `页面不存在 · ${SITE_NAME}`
    : meta.noindex && routeTitle
      ? `${routeTitle} · ${SITE_NAME}`
      : meta.title
  document.title = title
  upsertMeta('name', 'description', meta.description)
  upsertMeta('name', 'robots', meta.noindex ? 'noindex, nofollow' : 'index, follow')
  if (meta.noindex) {
    document.head.querySelector('link[rel="canonical"]')?.remove()
    for (const key of ['og:title', 'og:description', 'og:url', 'twitter:title', 'twitter:description']) {
      document.head.querySelector(`meta[property="${key}"]`)?.remove()
      document.head.querySelector(`meta[name="${key}"]`)?.remove()
    }
  } else {
    const url = absoluteUrl(meta.canonicalPath)
    upsertLink('canonical', url)
    upsertMeta('property', 'og:type', 'website')
    upsertMeta('property', 'og:locale', 'zh_CN')
    upsertMeta('property', 'og:site_name', '灵米 LingMI')
    upsertMeta('property', 'og:title', meta.title)
    upsertMeta('property', 'og:description', meta.description)
    upsertMeta('property', 'og:url', url)
    upsertMeta('name', 'twitter:card', 'summary')
    upsertMeta('name', 'twitter:title', meta.title)
    upsertMeta('name', 'twitter:description', meta.description)
  }
  setJsonLd(path)
}
