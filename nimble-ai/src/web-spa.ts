import { existsSync, readdirSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as compression from 'compression';
import * as express from 'express';
import { NextFunction, Request, Response } from 'express';

/**
 * 前端（nimble-web）构建产物的托管。
 *
 * 构建产物里，SEO 预渲染页是 `<路由>/index.html`（如 pricing/index.html），目录和前端路由同名。
 * 因此这里有两条硬性约束，违反任何一条都会让浏览器报 ERR_TOO_MANY_REDIRECTS：
 *   1. 静态资源中间件必须关闭 `redirect`。它默认会把 `/pricing`（命中同名目录）301 到 `/pricing/`，
 *      而下面又要把末尾斜杠 301 去掉，两边就互相跳转，永远停不下来。
 *   2. 规范路径只有一种：不带末尾斜杠。所有重定向都只做一次、一步到位。
 */

/** 与 nimble-web 路由里的 redirect 保持一致，让搜索引擎拿到 301 而不是空壳再等前端跳转 */
const HTML_REDIRECTS: Record<string, string> = {
  '/video-producer': '/video-producer/studio',
  '/video-tools': '/video-tools/erase-subtitle',
  '/general-tools': '/general-tools/erase-image',
  '/video-tools/viral-clone': '/viral-clone',
};

/** Vite 产物目录：文件名带内容哈希，可以永久缓存 */
const HASHED_ASSETS_DIR = 'assets';

/** 重定向短时缓存。不带 max-age 的 301 会被浏览器永久缓存，一旦写错就很难让用户恢复 */
const REDIRECT_CACHE_CONTROL = 'public, max-age=3600';

export function isBackendPath(path: string, apiPrefix: string) {
  return (
    path === `/${apiPrefix}` ||
    path.startsWith(`/${apiPrefix}/`) ||
    path === '/socket.io' ||
    path.startsWith('/socket.io/')
  );
}

/** 启动时扫描一次：路由路径 -> 预渲染 HTML。请求时只查 Map，不再碰磁盘 */
function collectPrerenderedPages(vueDist: string) {
  const pages = new Map<string, string>();
  const walk = (dir: string, urlPath: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (urlPath === '' && entry.name === HASHED_ASSETS_DIR) continue;
      const childDir = join(dir, entry.name);
      const childUrl = `${urlPath}/${entry.name}`;
      const html = join(childDir, 'index.html');
      if (existsSync(html)) pages.set(childUrl, html);
      walk(childDir, childUrl);
    }
  };
  walk(vueDist, '');
  pages.set('/', join(vueDist, 'index.html'));
  return pages;
}

function setStaticHeaders(vueDist: string) {
  const hashedDir = join(vueDist, HASHED_ASSETS_DIR) + sep;
  return (res: Response, filePath: string) => {
    if (filePath.startsWith(hashedDir)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  };
}

/** 把 nimble-web 的构建产物挂到同源。没有 vue-dist 时跳过，本地仍走 Vite 开发服务器。 */
export function mountWebSpa(app: NestExpressApplication, apiPrefix: string) {
  const vueDist = join(__dirname, '..', 'vue-dist');
  const indexHtml = join(vueDist, 'index.html');
  if (!existsSync(indexHtml)) return;

  const spaShell = existsSync(join(vueDist, 'spa-shell.html')) ? join(vueDist, 'spa-shell.html') : indexHtml;
  const pages = collectPrerenderedPages(vueDist);
  const server = app.getHttpAdapter().getInstance();

  /** 只处理前端页面和静态资源的 GET/HEAD；接口和 Socket.IO 原样放行（SSE 流式响应不能被压缩缓冲） */
  const onlyWeb =
    (handler: (req: Request, res: Response, next: NextFunction) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (isBackendPath(req.path, apiPrefix)) return next();
      return handler(req, res, next);
    };

  server.use(onlyWeb(compression()));
  server.use(
    onlyWeb(
      express.static(vueDist, {
        index: false,
        redirect: false,
        setHeaders: setStaticHeaders(vueDist),
      }),
    ),
  );

  server.use(
    onlyWeb((req, res, next) => {
      const path = req.path;
      // 带扩展名的是静态文件，走到这里说明文件不存在：给真正的 404，不要回退成 HTML（否则 JS 加载会报 MIME 错误）
      if (extname(path)) return next();

      const queryIndex = req.originalUrl.indexOf('?');
      const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
      const redirect = (target: string) => {
        res.setHeader('Cache-Control', REDIRECT_CACHE_CONTROL);
        res.redirect(301, target + query);
      };

      // 规范路径不带末尾斜杠。先收敛成以单个 / 开头，避免 //evil.com/ 这类地址被重定向到外站
      if (path.length > 1 && path.endsWith('/')) {
        return redirect('/' + path.replace(/^\/+|\/+$/g, ''));
      }
      const target = HTML_REDIRECTS[path];
      if (target) return redirect(target);

      res.sendFile(pages.get(path) ?? spaShell, { headers: { 'Cache-Control': 'no-cache' } }, (err) => {
        if (err && !res.headersSent) next(err);
      });
    }),
  );

  console.log(`前端静态资源: ${vueDist}（预渲染页面 ${pages.size} 个）`);
}
