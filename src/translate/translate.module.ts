import { Module } from '@nestjs/common';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { TranslateServiceV2 } from './translate.service.v2'; // Import V2 Service

@Module({
  imports: [], // AiProviderModule is Global
  controllers: [TranslateController],
  providers: [TranslateService, TranslateServiceV2], // Add V2 Service to providers
})
export class TranslateModule {}
