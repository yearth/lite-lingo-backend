import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as NlsClient from 'alibabacloud-nls'; // 使用已安装的 SDK
import { Readable } from 'stream';
// ！！可能需要引入 STS SDK 或 HTTP 客户端来获取 Token
// import StsClient from '@alicloud/sts-sdk'; // 示例

@Injectable()
export class TtsService implements OnModuleInit {
  private readonly logger = new Logger(TtsService.name);
  private appKey: string;
  private token: string; // 直接存储从 .env 读取的 Token
  // ！！WebSocket URL 需要查阅阿里云文档确认，不同地域可能不同
  private readonly NLS_URL = 'wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1';

  constructor(private configService: ConfigService) {
    const appKey = this.configService.get<string>('ALIYUN_APP_KEY');
    const token = this.configService.get<string>('ALIYUN_TOKEN'); // 读取 Token

    if (!appKey || !token) {
      const missingKeys = [
        !appKey && 'ALIYUN_APP_KEY',
        !token && 'ALIYUN_TOKEN', // 检查 Token
      ]
        .filter(Boolean)
        .join(', ');
      this.logger.error(
        `Missing Aliyun credentials in .env file: ${missingKeys}`,
      );
      // 在服务启动时就明确失败
      throw new Error(
        `Missing Aliyun credentials in .env file: ${missingKeys}`,
      );
    }

    this.appKey = appKey;
    this.token = token; // 存储 Token
  }

  // onModuleInit 不再需要获取 Token
  async onModuleInit() {
    this.logger.log('TtsService initialized using token from .env.');
  }

  // 移除了 refreshAccessToken 和 ensureValidToken 方法

  // 定义不同语言的默认音色
  private getDefaultVoice(language: string): string {
    switch (language?.toLowerCase()) {
      case 'zh':
      case 'zh-cn':
        return 'aixia'; // 中文默认
      case 'en':
      case 'en-us':
      default:
        return 'Olivia'; // 英文或未知语言默认 (请根据阿里云文档确认 'Sean' 是否可用)
    }
  }

  async synthesizeSpeech(
    text: string,
    language: string = 'en',
    voice?: string,
  ): Promise<Readable> {
    // 确定最终使用的音色
    const finalVoice = voice || this.getDefaultVoice(language);

    this.logger.log(
      `Synthesizing speech for text: "${text.substring(0, 30)}...", Language: ${language}, Voice: ${finalVoice}`,
    );

    return new Promise((resolve, reject) => {
      let synthesizer: NlsClient.SpeechSynthesizer | null = null;
      const audioStream = new Readable({
        read() {},
        destroy(err, callback) {
          // 确保在流销毁时清理引用
          if (synthesizer) {
            // synthesizer.close(); // 移除调用，SDK 可能自动处理或不需要关闭
            synthesizer = null; // 清理引用
          }
          callback(err);
        },
      });

      try {
        // 1. 创建 Synthesizer 实例 (参考 Demo)
        synthesizer = new NlsClient.SpeechSynthesizer({
          url: this.NLS_URL,
          appkey: this.appKey,
          token: this.token, // 直接使用从 .env 读取的 Token
        });

        // 2. 获取默认参数并修改 (参考 Demo)
        const params = synthesizer.defaultStartParams();
        params.text = text;
        params.voice = finalVoice; // 使用最终确定的音色
        params.format = 'mp3';
        params.sample_rate = 16000;
        // params.language = language; // SDK 是否需要 language 参数？需查文档
        // params.pitch_rate = 100; // 可选
        // params.speech_rate = 100; // 可选
        // params.enable_subtitle = true; // 可选

        // 3. 设置事件监听 (参考 Demo)
        synthesizer.on('meta', (msg) => {
          this.logger.debug('Client recv metainfo:', msg);
        });

        synthesizer.on('data', (msg) => {
          this.logger.debug(`Received audio data chunk size: ${msg.length}`);
          audioStream.push(msg); // 推送音频数据
        });

        synthesizer.on('completed', (msg) => {
          this.logger.log('Synthesis completed successfully:', msg);
          audioStream.push(null); // 结束流
          resolve(audioStream);
          // Demo 中没有显式关闭，但通常建议关闭以释放资源
          // synthesizer?.close();
          // synthesizer = null;
        });

        synthesizer.on('closed', () => {
          this.logger.log('TTS WebSocket connection closed.');
          // 确保流已结束
          if (!audioStream.readableEnded) {
            audioStream.push(null);
          }
          synthesizer = null; // 清理引用
        });

        synthesizer.on('failed', (msg) => {
          this.logger.error('Synthesis task failed:', msg);
          const error = new Error(
            `TTS synthesis failed: ${JSON.stringify(msg)}`,
          );
          audioStream.destroy(error); // 销毁流并传递错误
          reject(error);
          // synthesizer?.close();
          // synthesizer = null;
        });

        // 4. 启动合成 (参考 Demo)
        this.logger.log('Starting speech synthesis...');
        // Demo 使用了 await tts.start(param, true, 6000)
        // 第三个参数可能是超时时间，第二个参数 true 可能是指等待完成
        // 但在流式处理中，我们通常不希望阻塞等待完成，而是通过事件处理
        // 需要确认 start 方法是否支持非阻塞/事件驱动模式
        // 这里暂时按照 Demo 的 await 方式，但标记为可能需要调整
        synthesizer.start(params, true, 6000).catch((error) => {
          // 如果 start 本身就可能 reject
          this.logger.error('Error calling synthesizer.start:', error);
          const startError = new Error(
            `TTS start failed: ${error.message || error}`,
          );
          audioStream.destroy(startError);
          reject(startError);
          // synthesizer?.close();
          // synthesizer = null;
        });
      } catch (error) {
        this.logger.error(
          'Error initializing or starting TTS synthesis:',
          error,
        );
        const initError = new Error(
          `TTS initialization failed: ${error.message || error}`,
        );
        audioStream.destroy(initError);
        reject(initError);
        // synthesizer?.close(); // 确保关闭
        // synthesizer = null;
      }
    });
  }
}
