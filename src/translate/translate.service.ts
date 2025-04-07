import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
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
   * Generates a translation stream using the specified AI provider and model.
   * @param dto - The translation request DTO containing text, provider, model, etc.
   * @returns An Observable stream of translated text chunks.
   */
  generateStream(dto: TranslateRequestDto): Observable<string> {
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
      // Assuming generateChatStream handles internal errors and returns Observable<string> or throws
      return provider.generateChatStream(messages, finalModel);
    } catch (error) {
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
