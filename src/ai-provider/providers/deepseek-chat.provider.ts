import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Observable, throwError } from 'rxjs';
import { AiChatProvider } from '../ai-chat.provider.interface';
import { ChatMessage } from '../chat-message.interface';

@Injectable() // Mark as Injectable if needed elsewhere, though Factory might instantiate directly
export class DeepseekChatProvider implements AiChatProvider {
  private readonly logger = new Logger(DeepseekChatProvider.name);
  private client: OpenAI | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (apiKey) {
      this.client = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey: apiKey,
      });
      this.logger.log('DeepseekChatProvider initialized.');
    } else {
      this.logger.warn(
        'DeepseekChatProvider not initialized due to missing DEEPSEEK_API_KEY.',
      );
    }
  }

  generateChatStream(
    messages: ChatMessage[],
    model: string,
    options?: Record<string, any>,
  ): Observable<string> {
    if (!this.client) {
      this.logger.error('DeepSeek client is not initialized.');
      return throwError(
        () =>
          new Error(
            'DeepSeek API Key not configured or client failed to initialize.',
          ),
      );
    }

    // Ensure messages format is compatible (OpenAI SDK expects specific roles)
    const compatibleMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    return new Observable<string>((subscriber) => {
      let streamClosed = false;
      const closeStream = () => {
        if (!streamClosed) {
          streamClosed = true;
          subscriber.complete();
        }
      };

      this.logger.log(`Calling DeepSeek model: ${model}`);
      // Add null check again before accessing the client inside the promise logic
      if (this.client) {
        this.client.chat.completions
          .create({
            model: model,
            messages: compatibleMessages,
            stream: true,
            ...options, // Pass additional options if provided
          })
          .then(async (stream) => {
            try {
              for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                  subscriber.next(content);
                }
              }
              this.logger.log('DeepSeek stream finished.');
              closeStream();
            } catch (error) {
              this.logger.error('Error processing DeepSeek stream:', error);
              subscriber.error(error);
              streamClosed = true;
            }
          })
          .catch((error) => {
            this.logger.error('Error creating DeepSeek stream:', error);
            subscriber.error(error);
            streamClosed = true;
          });
      } else {
        // Should not happen if the initial check passed, but satisfies TS
        const error = new Error('DeepSeek client became unexpectedly null.');
        this.logger.error(error.message);
        subscriber.error(error);
        streamClosed = true;
      }

      return () => {
        this.logger.log('DeepSeek stream subscription ended.');
        // OpenAI SDK stream might have abort capabilities, check SDK docs if needed
      };
    });
  }
}
