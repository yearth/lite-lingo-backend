import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Observable, catchError, map, mergeMap, of } from 'rxjs'; // Re-add mergeMap
import { TranslateRequestDto } from './dto/translate-request.dto';

// Define the structure for OpenRouter messages
interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class TranslateService {
  private readonly openRouterUrl =
    'https://openrouter.ai/api/v1/chat/completions';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  // 构建适用于 OpenRouter 的 Prompt
  private buildOpenRouterPrompt(dto: TranslateRequestDto): OpenRouterMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN'; // 默认翻译成中文
    let promptText = `Translate the following text to ${targetLang}:\n\nText: "${dto.text}"`;

    if (dto.context) {
      promptText += `\n\nContext: "${dto.context}"`;
      promptText += `\n\nConsider the context when translating the text. Only provide the translation for the specified text.`;
    } else {
      promptText += `\n\nOnly provide the translation for the specified text.`;
    }

    // OpenRouter API 需要 messages 数组
    return [{ role: 'user', content: promptText }];
  }

  // 使用 OpenRouter API 进行流式翻译
  generateStream(
    dto: TranslateRequestDto,
    // Default to a free model on OpenRouter, adjust as needed
    modelName = 'deepseek/deepseek-chat-v3-0324:free',
  ): Observable<string> {
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      // Immediately return an error Observable if API key is missing
      return of('Error: OPENROUTER_API_KEY is not configured.');
    }

    const messages = this.buildOpenRouterPrompt(dto);
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Optional headers for OpenRouter ranking:
      // 'HTTP-Referer': '<YOUR_SITE_URL>',
      // 'X-Title': '<YOUR_SITE_NAME>',
    };
    const body = {
      model: modelName,
      messages: messages,
      stream: true, // Request streaming response
    };

    return this.httpService
      .post(this.openRouterUrl, body, {
        headers: headers,
        responseType: 'stream', // Important: Tell Axios to handle the response as a stream
      })
      .pipe(
        // The response data will be a stream (e.g., NodeJS.ReadableStream)
        map((response) => {
          // We need to process this stream to extract SSE events
          // This part requires careful handling of the stream data
          const stream = response.data as NodeJS.ReadableStream;
          let buffer = '';

          return new Observable<string>((subscriber) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString();
              let boundary = buffer.indexOf('\n\n');
              while (boundary !== -1) {
                const message = buffer.substring(0, boundary);
                buffer = buffer.substring(boundary + 2);
                if (message.startsWith('data: ')) {
                  const dataContent = message.substring(6);
                  if (dataContent.trim() === '[DONE]') {
                    subscriber.complete();
                    return;
                  }
                  try {
                    const parsed = JSON.parse(dataContent);
                    const textChunk = parsed?.choices?.[0]?.delta?.content;
                    if (typeof textChunk === 'string') {
                      subscriber.next(textChunk);
                    }
                  } catch (e) {
                    console.error(
                      'Error parsing SSE data chunk:',
                      e,
                      dataContent,
                    );
                    // Decide how to handle parsing errors, maybe ignore?
                  }
                }
                boundary = buffer.indexOf('\n\n');
              }
            });

            stream.on('end', () => {
              // Process any remaining buffer content if needed
              subscriber.complete();
            });

            stream.on('error', (error) => {
              console.error('Error reading response stream:', error);
              subscriber.error(`Error reading stream: ${error.message}`);
            });

            // Return teardown logic - often not needed for HTTP streams managed by Axios/HttpModule
            // return () => { /* stream cleanup if necessary */ };
          });
        }),
        // Flatten the Observable<Observable<string>> into Observable<string>
        mergeMap((innerObservable) => innerObservable), // Use mergeMap here
        catchError((error: AxiosError) => {
          console.error(
            'Error calling OpenRouter API:',
            error.response?.data || error.message,
          );
          // Safely access nested error message
          const errorMessage =
            (error.response?.data as any)?.error?.message || error.message;
          return of(`Error translating: ${errorMessage}`);
        }),
      );
  }
}
