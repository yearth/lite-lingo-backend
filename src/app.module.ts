import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // Import ConfigModule
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TranslateModule } from './translate/translate.module';
import { TtsModule } from './tts/tts.module'; // <-- Import TtsModule

@Module({
  imports: [
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
