import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TranslateRequestDto {
  @IsString()
  @IsNotEmpty()
  text: string; // The word or phrase to translate

  @IsString()
  @IsOptional()
  context?: string; // Optional context surrounding the text

  @IsString()
  @IsOptional()
  targetLanguage?: string; // Optional target language (e.g., 'zh-CN')

  @IsString()
  @IsOptional()
  sourceLanguage?: string; // Optional source language (e.g., 'en')

  @IsString()
  @IsOptional()
  provider?: string = 'deepseek'; // Optional provider ('openrouter', 'deepseek'), defaults to 'openrouter'

  @IsString()
  @IsOptional()
  model?: string = 'deepseek-chat'; // Optional model name (e.g., 'deepseek-chat', 'deepseek/deepseek-chat-v3-0324:free')
}
