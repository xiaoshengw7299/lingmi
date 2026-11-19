import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { AppModule } from './app.module';
import { mountWebSpa } from './web-spa';

async function bootstrap() {
  // rawBody：Nest 在 listen() 里也会挂 JSON 解析器。这里打开后，无论哪一个解析器先读到 body，签名校验都能拿到原始字节。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // 调整请求体大小限制；verify 回调把原始字节挂到 req.rawBody，供 模型平台API Webhook 签名校验使用
  // （签名是对原始 body 字节算的，JSON.parse 后再序列化会因字段顺序/空白差异导致校验失败）
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 获取配置服务
  const configService = app.get(ConfigService);

  // 全局API前缀
  const apiPrefix = configService.get('APP_PREFIX', 'api');
  app.setGlobalPrefix(apiPrefix);

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 反向代理（Nginx / SLB）后面取真实客户端 IP，限流依赖它
  if (configService.get('TRUST_PROXY') === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // CORS：生产环境用 CORS_ORIGINS 限定前端域名（逗号分隔）；未配置时放开，仅限本地开发
  const corsOrigins = (configService.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!corsOrigins.length && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ 生产环境未配置 CORS_ORIGINS，当前允许任意来源跨域访问');
  }
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  });

  mountWebSpa(app, apiPrefix);

  // 启动应用
  const port = configService.get('APP_PORT', 3000);
  await app.listen(port);
  console.log(`🚀 应用已启动: http://localhost:${port}`);
}

bootstrap();
