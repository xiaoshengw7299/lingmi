import {
  absoluteUrl,
  COMPANY_NAME,
  CONTACT_EMAIL,
  FAQ,
  FEATURE_LIST,
  HOME_DESCRIPTION,
  pageMeta,
  SITE_NAME,
  SITE_ORIGIN,
} from './site'

/** 页面里能看见的内容才写进结构化数据。视频换脸不放进 featureList */
export function buildJsonLd(path: string) {
  const meta = pageMeta(path)
  if (meta.noindex) return null
  const orgId = `${SITE_ORIGIN}/#organization`
  const siteId = `${SITE_ORIGIN}/#website`
  const pageUrl = absoluteUrl(meta.canonicalPath)
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: '灵米',
      alternateName: ['LingMI', '灵米LingMI', SITE_NAME],
      url: `${SITE_ORIGIN}/`,
      legalName: COMPANY_NAME,
      description: `${COMPANY_NAME}（广州市灵予科技）运营的 AI 视频创作平台，提供视频制作、一键成片、爆款复刻和视频工具。`,
      email: CONTACT_EMAIL,
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      name: SITE_NAME,
      alternateName: ['灵米', 'LingMI', '灵米LingMI'],
      url: `${SITE_ORIGIN}/`,
      inLanguage: 'zh-CN',
      description: HOME_DESCRIPTION,
      publisher: { '@id': orgId },
    },
    {
      '@type': 'WebPage',
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: meta.title,
      description: meta.description,
      inLanguage: 'zh-CN',
      isPartOf: { '@id': siteId },
      about: { '@id': orgId },
    },
  ]
  if (meta.canonicalPath !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: meta.title.replace(` · ${SITE_NAME}`, ''), item: pageUrl },
      ],
    })
  } else {
    graph.push({
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      alternateName: ['灵米', 'LingMI', '灵米LingMI'],
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      url: `${SITE_ORIGIN}/`,
      inLanguage: 'zh-CN',
      description: HOME_DESCRIPTION,
      featureList: FEATURE_LIST,
      offers: {
        '@type': 'Offer',
        url: `${SITE_ORIGIN}/pricing`,
        priceCurrency: 'CNY',
        description: '按量计费，无月费。充值余额后按模型单价扣费，生成失败自动退回。',
      },
      provider: { '@id': orgId },
    })
  }
  if (meta.canonicalPath === '/' || meta.canonicalPath === '/pricing') {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    })
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}
