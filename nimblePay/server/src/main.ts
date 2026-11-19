import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { isApiRoute, PUBLIC_PAY_PREFIX } from './common/constants';
import { AllExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

function isAllowedBrowserOrigin(origin?: string) {
  if (!origin) return true;
  if (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return true;
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(origin);
}

function isBackendPath(path: string) {
  const prefix = process.env.APP_PREFIX || 'api';
  return path === `/${prefix}` || path.startsWith(`/${prefix}/`);
}

function mountAdminSpa(app: NestExpressApplication) {
  const vueDist = join(__dirname, '..', 'vue-dist');
  const indexHtml = join(vueDist, 'index.html');
  if (!existsSync(indexHtml)) return;
  app.useStaticAssets(vueDist, { index: false });
  app.getHttpAdapter().getInstance().use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isBackendPath(String(req.path || ''))) return next();
    if (!String(req.headers.accept || '').includes('text/html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const apiPrefix = config.get('APP_PREFIX', 'api');
  app.setGlobalPrefix(apiPrefix);
  const apiHelmet = helmet();
  const payHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'style-src': ["'unsafe-inline'"],
        'script-src': ["'unsafe-inline'"],
        'form-action': ['*', 'https:', 'http:'],
        'base-uri': ["'none'"],
        'frame-ancestors': ["'none'"],
      },
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const path = String(req.path || '');
    if (isApiRoute(path, `${PUBLIC_PAY_PREFIX}/pay`)) return payHelmet(req, res, next);
    if (path === `/${apiPrefix}` || path.startsWith(`/${apiPrefix}/`)) return apiHelmet(req, res, next);
    return next();
  });
  app.enableCors((req, callback) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    callback(null, { origin: isAllowedBrowserOrigin(origin), credentials: true });
  });
  app.use(
    json({
      verify: (req, _res, buf) => {
        (req as Express.Request).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(urlencoded({ extended: false }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());
  mountAdminSpa(app);
  const port = Number(config.get('APP_PORT', 8090));
  await app.listen(port);
  console.log(`nimblePay http://127.0.0.1:${port}`);
}

bootstrap();
