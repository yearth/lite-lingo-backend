import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { Observable, catchError, map, mergeMap, throwError } from 'rxjs'; // Import Subscriber, add map, mergeMap back
import { Readable } from 'stream'; // Import Readable
import { StreamEventPayload } from '../../common/dto/stream-event-payload.dto';
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
          const stream = response.data as Readable; // Use Readable type
          let buffer = ''; // Buffer for accumulating chunks

          return new Observable<StreamEventPayload<any>>((subscriber) => {
            // Changed Observable type argument
            stream.on('data', (chunk) => {
              buffer += chunk.toString(); // Append chunk to buffer

              // Process buffer line by line
              let newlineIndex;
              while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex).trim(); // Extract line
                buffer = buffer.substring(newlineIndex + 1); // Remove line from buffer

                if (line) {
                  // Process non-empty lines
                  // OpenRouter might still use SSE format (data: ...), handle it
                  if (line.startsWith('data: ')) {
                    const dataContent = line.substring(6).trim();
                    if (dataContent === '[DONE]') {
                      this.logger.log(
                        'OpenRouter stream finished ([DONE] received).',
                      );
                      // The 'done' event should be the last JSON line from AI now
                      // subscriber.complete(); // Let the final {"type":"done"} handle completion
                      continue; // Skip processing [DONE] itself
                    }
                    // Attempt to parse the dataContent as JSON
                    try {
                      const parsedJson = JSON.parse(dataContent);
                      subscriber.next(parsedJson as StreamEventPayload<any>);
                    } catch (parseError) {
                      this.logger.error(
                        'Failed to parse JSON line from OpenRouter (data: prefix):',
                        parseError,
                        `Line: ${dataContent}`,
                      );
                      subscriber.next({
                        type: 'parsing_error',
                        payload: {
                          message: 'Failed to parse AI response line.',
                          line: dataContent,
                        },
                      });
                    }
                  } else {
                    // Handle case where line might be just the JSON object without "data: "
                    try {
                      const parsedJson = JSON.parse(line);
                      subscriber.next(parsedJson as StreamEventPayload<any>);
                    } catch (parseError) {
                      this.logger.error(
                        'Failed to parse JSON line from OpenRouter (no data: prefix):',
                        parseError,
                        `Line: ${line}`,
                      );
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
            });

            stream.on('end', () => {
              this.logger.log('OpenRouter stream ended.');
              // Process any remaining data in the buffer
              if (buffer.trim()) {
                this.logger.warn(
                  'Processing remaining buffer data after stream end.',
                );
                const line = buffer.trim();
                // Try parsing the remaining buffer content
                try {
                  const parsedJson = JSON.parse(line);
                  subscriber.next(parsedJson as StreamEventPayload<any>);
                } catch (parseError) {
                  this.logger.error(
                    'Failed to parse remaining JSON buffer from OpenRouter:',
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
              // Ensure completion
              if (!subscriber.closed) {
                subscriber.complete();
              }
            });

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

  // --- Add V2 Method ---
  generateRawChatStream(
    messages: ChatMessage[],
    model: string,
    options?: Record<string, any>,
  ): Observable<string> {
    if (!this.apiKey) {
      this.logger.error('OpenRouter API Key is not configured.');
      return throwError(() => new Error('OpenRouter API Key not configured.'));
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    const body = {
      model: model,
      messages: messages,
      stream: true,
      ...options,
    };

    this.logger.log(`Calling OpenRouter (raw stream) model: ${model}`);
    return this.httpService
      .post(this.apiUrl, body, {
        headers: headers,
        responseType: 'stream',
      })
      .pipe(
        map((response) => {
          const stream = response.data as Readable;
          let buffer = ''; // Buffer for potential partial SSE lines

          return new Observable<string>((subscriber) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString();

              // Process buffer line by line (assuming SSE format: "data: ...\n\n")
              let eventEndIndex;
              while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
                const eventLines = buffer
                  .substring(0, eventEndIndex)
                  .split('\n');
                buffer = buffer.substring(eventEndIndex + 2); // Remove processed event

                for (const line of eventLines) {
                  if (line.startsWith('data: ')) {
                    const dataContent = line.substring(6).trim();
                    if (dataContent === '[DONE]') {
                      // Ignore the [DONE] signal in raw stream
                      continue;
                    }
                    try {
                      // Attempt to parse as JSON to extract the actual text chunk if it's nested
                      // e.g., data: {"choices": [{"delta": {"content": "Hello"}}]}
                      const parsed = JSON.parse(dataContent);
                      const textChunk = parsed?.choices?.[0]?.delta?.content;
                      if (typeof textChunk === 'string') {
                        subscriber.next(textChunk);
                      }
                      // If parsing fails or structure is different, maybe log a warning?
                      // Or just emit the raw dataContent? For now, we assume the standard structure.
                    } catch (e) {
                      // If it's not JSON, maybe it's just raw text after "data: "?
                      // This part might need adjustment based on actual OpenRouter raw stream format.
                      // For now, let's assume we only care about the JSON structure above.
                      this.logger.warn(
                        `Received non-JSON data line in raw stream: ${dataContent}`,
                      );
                      // subscriber.next(dataContent); // Option: emit raw content if not JSON
                    }
                  }
                }
              }
            });

            stream.on('end', () => {
              this.logger.log('OpenRouter raw stream ended.');
              // Process any remaining buffer? Unlikely with SSE format ending in \n\n
              if (buffer.trim()) {
                this.logger.warn(
                  `Processing remaining buffer data after raw stream end: ${buffer}`,
                );
                // Attempt to process remaining buffer similarly?
              }
              if (!subscriber.closed) {
                subscriber.complete();
              }
            });

            stream.on('error', (error) => {
              this.logger.error(
                'Error reading OpenRouter raw response stream:',
                error,
              );
              subscriber.error(`Error reading raw stream: ${error.message}`);
            });
          });
        }),
        mergeMap((innerObservable) => innerObservable),
        catchError((error: AxiosError) => {
          this.logger.error(
            'Error calling OpenRouter API (raw stream):',
            error.response?.data || error.message,
          );
          const errorMessage =
            (error.response?.data as any)?.error?.message || error.message;
          return throwError(
            () => new Error(`OpenRouter API Error (raw): ${errorMessage}`),
          );
        }),
      );
  }
  // -------------------
}
