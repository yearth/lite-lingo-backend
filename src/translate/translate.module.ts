import { HttpModule } from '@nestjs/axios'; // Import HttpModule
import { Module } from '@nestjs/common';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';

@Module({
  imports: [HttpModule], // Import HttpModule here
  controllers: [TranslateController],
  providers: [TranslateService],
})
export class TranslateModule {}
