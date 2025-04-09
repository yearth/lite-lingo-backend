import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Observable, Subscriber, throwError } from 'rxjs'; // Import Subscriber
import { StreamEventPayload } from '../../common/dto/stream-event-payload.dto';
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
  ): Observable<StreamEventPayload<any>> {
    // Changed return type
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

    return new Observable<StreamEventPayload<any>>((subscriber) => {
      // Changed Observable type argument
      const handleStream = async (
        subscriber: Subscriber<StreamEventPayload<any>>,
      ) => {
        let buffer = ''; // Buffer to accumulate incoming chunks
        try {
          this.logger.log(`Calling DeepSeek model: ${model}`);
          if (!this.client) {
            throw new Error('DeepSeek client is not initialized.');
          }

          const stream = await this.client.chat.completions.create({
            model: model,
            messages: compatibleMessages,
            stream: true,
            ...options,
          });

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              buffer += content; // Append chunk to buffer

              // Process buffer line by line
              let newlineIndex;
              while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex).trim(); // Extract line
                buffer = buffer.substring(newlineIndex + 1); // Remove line from buffer

                if (line) {
                  // Process non-empty lines
                  try {
                    const parsedJson = JSON.parse(line);
                    // Assume parsedJson has { type: string, payload?: any } structure
                    // We directly forward this parsed object as StreamEventPayload
                    subscriber.next(parsedJson as StreamEventPayload<any>);
                  } catch (parseError) {
                    this.logger.error(
                      'Failed to parse JSON line from DeepSeek:',
                      parseError,
                      `Line: ${line}`,
                    );
                    // Send a parsing error event
                    subscriber.next({
                      type: 'parsing_error',
                      payload: {
                        message: 'Failed to parse AI response line.',
                        line: line,
                      },
                    });
                  }
                }
              }
            }
            // Check for finish reason if needed (e.g., chunk.choices[0]?.finish_reason)
            // If finish_reason indicates completion, we might break or ensure buffer is processed.
          }

          // Process any remaining data in the buffer after the stream ends
          if (buffer.trim()) {
            this.logger.warn(
              'Processing remaining buffer data after stream end.',
            );
            try {
              const parsedJson = JSON.parse(buffer.trim());
              subscriber.next(parsedJson as StreamEventPayload<any>);
            } catch (parseError) {
              this.logger.error(
                'Failed to parse remaining JSON buffer from DeepSeek:',
                parseError,
                `Buffer: ${buffer}`,
              );
              subscriber.next({
                type: 'parsing_error',
                payload: {
                  message: 'Failed to parse final AI response buffer.',
                  buffer: buffer,
                },
              });
            }
          }

          this.logger.log('DeepSeek stream finished.');
          subscriber.complete(); // Signal completion after processing everything
        } catch (error) {
          this.logger.error('Error during DeepSeek stream processing:', error);
          subscriber.error(error); // Propagate the error
        }
      };

      handleStream(subscriber);

      // Cleanup logic (if any specific cleanup is needed for DeepSeek streams)
      return () => {
        this.logger.log('DeepSeek stream subscription ended.');
      };
    });
  }

  // --- Add V2 Method ---
  generateRawChatStream(
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

    const compatibleMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    return new Observable<string>((subscriber) => {
      const handleStream = async (subscriber: Subscriber<string>) => {
        try {
          this.logger.log(`Calling DeepSeek (raw stream) model: ${model}`);
          if (!this.client) {
            throw new Error('DeepSeek client is not initialized.');
          }

          const stream = await this.client.chat.completions.create({
            model: model,
            messages: compatibleMessages,
            stream: true,
            ...options,
          });

          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            // Check if content is a non-empty string before emitting
            if (typeof content === 'string' && content.length > 0) {
              subscriber.next(content);
            }
            // Check for finish reason if needed
            // const finishReason = chunk.choices[0]?.finish_reason;
            // if (finishReason) {
            //   this.logger.log(`DeepSeek raw stream finished with reason: ${finishReason}`);
            //   break; // Exit loop if finished
            // }
          }

          this.logger.log('DeepSeek raw stream finished.');
          subscriber.complete(); // Signal completion after the loop
        } catch (error) {
          this.logger.error(
            'Error during DeepSeek raw stream processing:',
            error,
          );
          subscriber.error(error); // Propagate the error
        }
      };

      handleStream(subscriber);

      return () => {
        this.logger.log('DeepSeek raw stream subscription ended.');
        // Add any necessary cleanup for the stream if the OpenAI SDK requires it
      };
    });
  }
  // -------------------
}
