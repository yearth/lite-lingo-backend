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
}
