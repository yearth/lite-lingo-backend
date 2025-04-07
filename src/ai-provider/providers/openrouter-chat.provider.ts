import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Observable, catchError, map, mergeMap, throwError } from 'rxjs';
import { StreamEventPayload } from '../../common/dto/stream-event-payload.dto'; // Import the payload type
import { AiChatProvider } from '../ai-chat.provider.interface';
import { ChatMessage } from '../chat-message.interface';

@Injectable()
export class OpenRouterChatProvider implements AiChatProvider {
  private readonly logger = new Logger(OpenRouterChatProvider.name);
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private apiKey: string | undefined;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    if (!this.apiKey) {
      this.logger.warn(
        'OpenRouterChatProvider not fully initialized due to missing OPENROUTER_API_KEY.',
      );
    } else {
      this.logger.log('OpenRouterChatProvider initialized.');
    }
  }

  generateChatStream(
    messages: ChatMessage[],
    model: string,
    options?: Record<string, any>, // Options not directly used by OpenRouter in this basic setup
  ): Observable<StreamEventPayload<any>> {
    // Changed return type
    if (!this.apiKey) {
      this.logger.error('OpenRouter API Key is not configured.');
      return throwError(() => new Error('OpenRouter API Key not configured.'));
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      // Optional headers for OpenRouter ranking:
      // 'HTTP-Referer': '<YOUR_SITE_URL>',
      // 'X-Title': '<YOUR_SITE_NAME>',
    };
    const body = {
      model: model,
      messages: messages,
      stream: true,
      ...options, // Pass additional options if provided (though OpenRouter might ignore some)
    };

    this.logger.log(`Calling OpenRouter model: ${model}`);
    return this.httpService
      .post(this.apiUrl, body, {
        headers: headers,
        responseType: 'stream',
      })
      .pipe(
        map((response) => {
          // Process the SSE stream from OpenRouter
          const stream = response.data as NodeJS.ReadableStream;
          let buffer = '';

          return new Observable<StreamEventPayload<any>>((subscriber) => {
            // Changed Observable type argument
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
                    if (typeof textChunk === 'string' && textChunk.length > 0) {
                      // Ensure non-empty chunk
                      // Wrap the text chunk in the StreamEventPayload structure
                      const event: StreamEventPayload<{ text: string }> = {
                        type: 'text_chunk',
                        payload: { text: textChunk },
                      };
                      subscriber.next(event);
                    }
                    // TODO: Check if OpenRouter provides other info like finish_reason
                    // in the stream to potentially send a 'done' or other event types.
                  } catch (e) {
                    this.logger.error(
                      'Error parsing OpenRouter SSE data chunk:',
                      e,
                      dataContent,
                    );
                  }
                }
                boundary = buffer.indexOf('\n\n');
              }
            });

            stream.on('end', () => subscriber.complete());
            stream.on('error', (error) => {
              this.logger.error(
                'Error reading OpenRouter response stream:',
                error,
              );
              subscriber.error(`Error reading stream: ${error.message}`);
            });
          });
        }),
        mergeMap((innerObservable) => innerObservable), // Flatten the observable
        catchError((error: AxiosError) => {
          this.logger.error(
            'Error calling OpenRouter API:',
            error.response?.data || error.message,
          );
          const errorMessage =
            (error.response?.data as any)?.error?.message || error.message;
          // Return an observable that emits the error message and completes
          // Or use throwError to propagate the error
          // return of(`Error translating via OpenRouter: ${errorMessage}`);
          return throwError(
            () => new Error(`OpenRouter API Error: ${errorMessage}`),
          );
        }),
      );
  }
}
