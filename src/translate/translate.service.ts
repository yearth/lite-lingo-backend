import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs'; // Import 'of'
import { catchError, endWith, map } from 'rxjs/operators'; // Import operators
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
import { ApiResponse } from '../common/dto/api-response.dto'; // Import ApiResponse
import { StreamEventPayload } from '../common/dto/stream-event-payload.dto'; // Import StreamEventPayload
import { TranslateRequestDto } from './dto/translate-request.dto';

@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);

  // Inject the AiProviderFactory
  constructor(private aiProviderFactory: AiProviderFactory) {}

  // Build the prompt (assuming it's compatible with supported providers)
  private buildPrompt(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN'; // Default to Chinese
    let promptText = `Translate the following text to ${targetLang}:\n\nText: "${dto.text}"`;

    if (dto.context) {
      promptText += `\n\nContext: "${dto.context}"`;
      promptText += `\n\nConsider the context when translating the text. Only provide the translation for the specified text.`;
    } else {
      promptText += `\n\nOnly provide the translation for the specified text.`;
    }
    // Return the message array format expected by the providers
    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a translation stream wrapped in ApiResponse structure.
   * @param dto - The translation request DTO containing text, provider, model, etc.
   * @returns An Observable stream of ApiResponse containing StreamEventPayload or null data in case of specific errors.
   */
  generateStream(
    dto: TranslateRequestDto,
  ): Observable<ApiResponse<StreamEventPayload<any> | null>> {
    // Allow null in data generic type
    // Changed return type
    const providerName = dto.provider || 'openrouter'; // Default to 'openrouter'
    const requestedModel = dto.model;

    this.logger.log(
      `Attempting translation via Factory for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    // 1. Get the appropriate provider instance from the factory
    const provider = this.aiProviderFactory.getProvider(providerName);

    if (!provider) {
      // If the factory returns null (provider not found or not initialized)
      this.logger.error(`AI Provider "${providerName}" is not available.`);
      return throwError(
        () =>
          new HttpException(
            `AI Provider "${providerName}" is not available or configured.`,
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
      );
    }

    // 2. Determine the final model name to use
    let finalModel: string;
    if (requestedModel) {
      finalModel = requestedModel;
    } else {
      // Define default models per provider if not specified in the request
      switch (providerName.toLowerCase()) {
        case 'deepseek':
          finalModel = 'deepseek-chat'; // Default for DeepSeek
          break;
        case 'openrouter':
        default:
          finalModel = 'deepseek/deepseek-chat-v3-0324:free'; // Default for OpenRouter
          break;
      }
      this.logger.log(
        `No model specified for ${providerName}, using default: ${finalModel}`,
      );
    }

    // 3. Build the prompt messages
    const messages = this.buildPrompt(dto);

    // 4. Call the selected provider's stream generation method
    try {
      this.logger.log(
        `Calling ${providerName} provider with model ${finalModel}.`,
      );
      // Provider now returns Observable<StreamEventPayload<any>>
      const streamFromProvider = provider.generateChatStream(
        messages,
        finalModel,
      );

      // Wrap the stream events in ApiResponse
      return streamFromProvider.pipe(
        map((eventPayload) => {
          // Wrap successful event payload in ApiResponse
          return ApiResponse.success(eventPayload, '', '0'); // Use success static method
        }),
        catchError((err) => {
          // Handle errors from the provider stream
          this.logger.error(
            `Error during ${providerName} stream processing: ${err.message}`,
            err.stack,
          );
          // Create an error payload and wrap it in ApiResponse
          const errorPayload: StreamEventPayload<{ message: string }> = {
            type: 'error',
            payload: { message: err.message || 'Stream processing error' },
          };
          // Return an Observable emitting a single error ApiResponse
          return of(
            ApiResponse.error(err.message, 'STREAM_ERROR', errorPayload),
          );
        }),
        // Append a 'done' event when the stream completes successfully
        // Note: This 'done' event won't be sent if catchError handles an error,
        // because 'of' creates a new observable that completes after one emission.
        // The HttpExceptionFilter handles sending error events for SSE.
        // We might only want the 'done' on successful completion.
        endWith(
          ApiResponse.success(
            { type: 'done', payload: { status: 'completed' } },
            'Stream ended',
            '0',
          ),
        ),
      );
    } catch (error) {
      // Catch synchronous errors during setup (e.g., provider init)
      this.logger.error(
        `Error invoking generateChatStream for provider ${providerName}:`,
        error,
      );
      // Convert synchronous errors into an Observable error
      return throwError(
        () =>
          new HttpException(
            `Failed to initiate stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }

  // Removed generateDeepseekStream and generateOpenRouterStream methods
  // as their logic is now encapsulated in their respective provider classes.
}
