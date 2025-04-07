import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // Import ConfigModule
import { AiProviderModule } from './ai-provider/ai-provider.module'; // <-- Import AiProviderModule
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TranslateModule } from './translate/translate.module';
import { TtsModule } from './tts/tts.module';

@Module({
  imports: [
    AiProviderModule, // <-- Add AiProviderModule here
    ConfigModule.forRoot({
      // Configure ConfigModule
      isGlobal: true, // Make ConfigModule available globally
      envFilePath: '.env', // Specify the .env file path
    }),
    TranslateModule,
    TtsModule, // <-- Add TtsModule here
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
