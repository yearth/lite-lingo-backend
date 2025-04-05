import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SynthesizeSpeechDto {
  @IsNotEmpty()
  @IsString()
  text: string; // 需要转换的文本

  @IsOptional()
  @IsString()
  voice?: string; // 可选的发音人 ID (例如 'Aixia', 'Aiyu' 等阿里云提供的音色)
  // 如果不提供，Service 中会根据 language 选择默认音色

  @IsOptional()
  @IsString()
  language?: string = 'en'; // 可选的语言代码，默认为 'en' (例如 'en', 'zh')

  // 未来可以添加 format, sampleRate, speechRate, pitchRate 等参数
}
