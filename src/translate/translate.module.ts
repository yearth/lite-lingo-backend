import { Module } from '@nestjs/common';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
// Removed TranslateServiceV2 import

@Module({
  imports: [], // AiProviderModule is Global
  controllers: [TranslateController],
  providers: [TranslateService], // Removed TranslateServiceV2 from providers
})
export class TranslateModule {}
