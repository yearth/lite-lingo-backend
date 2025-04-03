import { ValidationPipe } from '@nestjs/common'; // Import ValidationPipe
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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

  await app.listen(3000);
  console.log(`Application is running on: ${await app.getUrl()}`); // Log the URL
}
bootstrap();
