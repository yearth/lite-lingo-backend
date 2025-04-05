import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // 确保 ConfigModule 可用
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';

@Module({
  imports: [ConfigModule], // 导入 ConfigModule 以便 TtsService 注入 ConfigService
  controllers: [TtsController],
  providers: [TtsService],
  exports: [TtsService], // 如果其他模块需要使用 TtsService，可以导出
})
export class TtsModule {}
