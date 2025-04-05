import {
  Body,
  Controller,
  HttpCode, // <-- Import HttpCode
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'stream';
import { SynthesizeSpeechDto } from './dto/synthesize-speech.dto';
import { TtsService } from './tts.service';

@Controller('tts')
export class TtsController {
  private readonly logger = new Logger(TtsController.name); // 初始化 Logger
  constructor(private readonly ttsService: TtsService) {}

  @Post()
  @HttpCode(HttpStatus.OK) // <-- Specify HTTP 200 OK for successful POST
  async synthesize(
    @Body() synthesizeSpeechDto: SynthesizeSpeechDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    this.logger.log(
      `Received TTS request for text: "${synthesizeSpeechDto.text.substring(0, 30)}...", Voice: ${synthesizeSpeechDto.voice || 'default'}`,
    );
    try {
      const audioStream = await this.ttsService.synthesizeSpeech(
        synthesizeSpeechDto.text,
        synthesizeSpeechDto.language, // <-- 传递 language
        synthesizeSpeechDto.voice,
      );

      // 验证 synthesizeSpeech 返回的是可读流
      if (!audioStream || !(audioStream instanceof Readable)) {
        this.logger.error('TtsService did not return a readable stream.');
        throw new HttpException(
          'Failed to generate audio stream',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // 设置响应头
      res.setHeader('Content-Type', 'audio/mpeg');
      this.logger.log('Sending audio stream response.');

      // 返回 StreamableFile
      return new StreamableFile(audioStream);
    } catch (error) {
      this.logger.error(
        `Error during TTS synthesis: ${error.message}`,
        error.stack,
      );
      // 检查是否已经是 HttpException，否则包装成通用的内部错误
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Internal server error during TTS synthesis',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
