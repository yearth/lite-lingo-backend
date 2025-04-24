import { ValidationPipe, VersioningType } from '@nestjs/common'; // Import ValidationPipe & VersioningType
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter'; // Import Filter
import { ResponseInterceptor } from './common/interceptors/response.interceptor'; // Import Interceptor

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // --- 添加 CORS 配置 ---
  app.enableCors({
    origin: true, // 允许所有来源 (开发方便)
    // origin: 'chrome-extension://<your-extension-id>', // 生产环境建议指定来源
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true, // 如果需要传递 cookie 或认证头
  });
  // --------------------

  // --- 启用 API 版本控制 ---
  app.enableVersioning({
    type: VersioningType.URI, // 使用 URI 进行版本控制 (e.g., /v1/route)
    defaultVersion: '1', // 默认版本为 v1
  });
  // -------------------------

  // --- 全局应用 Interceptor 和 Filter ---
  app.useGlobalInterceptors(new ResponseInterceptor()); // 应用响应拦截器
  app.useGlobalFilters(new HttpExceptionFilter()); // 应用异常过滤器
  // ------------------------------------

  // Enable global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Automatically remove non-whitelisted properties
      transform: true, // Automatically transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true, // Allow basic type conversions
      },
    }),
  );

  await app.listen(3000, '127.0.0.1');
  console.log(`Application is running on: ${await app.getUrl()}`); // Log the URL
}
bootstrap();
