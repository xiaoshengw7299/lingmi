import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'
import { absoluteUrl } from '../src/seo/site'
import { buildDocuments, llmsFullTxt, llmsTxt, robotsTxt, sitemapXml, type SeoDocument } from './documents'

function esc(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 把构建出的空壳换成带正文的 HTML。搜索引擎不执行 JS 时也能读到页面内容 */
function renderPage(shell: string, page: SeoDocument) {
  const url = absoluteUrl(page.canonicalPath)
  const json = JSON.stringify(page.jsonLd ?? {}).replace(/</g, '\\u003c')
  const head = `
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="zh_CN" />
    <meta property="og:site_name" content="灵米 LingMI" />
    <meta property="og:title" content="${esc(page.title)}" />
    <meta property="og:description" content="${esc(page.description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${esc(page.title)}" />
    <meta name="twitter:description" content="${esc(page.description)}" />
    <link rel="alternate" type="text/plain" href="${esc(absoluteUrl('/llms.txt'))}" title="llms.txt" />
    <script type="application/ld+json" id="lingmi-ld">${json}</script>
    <style>
      .seo-snapshot { max-width: 880px; margin: 0 auto; padding: 32px 20px 48px; color: inherit; }
      .seo-snapshot a { color: var(--color-primary, #0b8f5f); }
      .seo-snapshot h1 { font-size: 32px; line-height: 1.25; margin: 8px 0 12px; }
      .seo-snapshot h2 { font-size: 22px; margin: 28px 0 8px; }
      .seo-snapshot h3 { font-size: 18px; margin: 18px 0 6px; }
      .seo-snapshot ul, .seo-snapshot ol { padding-left: 1.2em; }
    </style>`
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta\s+name="description"[\s\S]*?>/, `<meta name="description" content="${esc(page.description)}" />`)
    .replace('</head>', `${head}\n  </head>`)
    .replace('<div id="app"></div>', `<div id="app"><main class="seo-snapshot">${page.body}</main></div>`)
}

export function lingmiSeoPlugin(): Plugin {
  let outDir = ''
  let company = ''
  let email = ''
  return {
    name: 'lingmi-seo',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      company = config.env.VITE_COMPANY_NAME || ''
      email = config.env.VITE_CONTACT_EMAIL || ''
    },
    closeBundle() {
      const indexPath = join(outDir, 'index.html')
      const raw = readFileSync(indexPath, 'utf8')
      writeFileSync(
        join(outDir, 'spa-shell.html'),
        raw.replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>'),
      )
      const pages = buildDocuments(company || undefined, email || undefined)
      for (const page of pages) {
        const file = page.path === '/' ? indexPath : join(outDir, page.path.replace(/^\//, ''), 'index.html')
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, renderPage(raw, page))
      }
      writeFileSync(join(outDir, 'robots.txt'), robotsTxt())
      writeFileSync(join(outDir, 'sitemap.xml'), sitemapXml(pages.map((page) => page.path)))
      writeFileSync(join(outDir, 'llms.txt'), llmsTxt())
      writeFileSync(join(outDir, 'llms-full.txt'), llmsFullTxt())
    },
  }
}
