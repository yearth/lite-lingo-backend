import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Import ConfigService
import { Observable, Subject, concat, from, of, throwError, timer } from 'rxjs'; // Import necessary RxJS features
import { catchError, concatMap, finalize, map } from 'rxjs/operators'; // Import necessary RxJS operators
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
// ApiResponse and StreamEventPayload are no longer needed for this simplified version
// import { ApiResponse } from '../common/dto/api-response.dto';
// import { StreamEventPayload } from '../common/dto/stream-event-payload.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';

// Mock data (optional, can be removed if mock logic is fully removed or kept for testing)
const MOCK_EXPLANATION_STRING = "在此上下文中，'word' 指的是 模拟含义。";
const MOCK_TRANSLATION_STRING = "这是一个模拟句子翻译。";

@Injectable()
export class TranslateService { // Renamed from TranslateServiceV2 back to TranslateService
  private readonly logger = new Logger(TranslateService.name);

  // Inject the AiProviderFactory and ConfigService
  constructor(
    private aiProviderFactory: AiProviderFactory,
    private configService: ConfigService, // Inject ConfigService
  ) {}

  // Build the new simplified prompt
  private buildPrompt(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    let promptText = `You are a translation assistant. Analyze the "Input Text" and "Context" (if provided).

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Instructions:
1. If the "Input Text" is a single word or a common phrase AND "Context" is provided, respond ONLY with the following formatted text:
   "在此上下文中，'${inputText}' 指的是 {meaning of the input text in the provided context in ${targetLang}}"
2. Otherwise (if input is a sentence, fragment, or a word/phrase without context), respond ONLY with the direct translation of the "Input Text" into the "Target Language".

CRITICAL: Your entire response must be ONLY the explanation text (case 1) or ONLY the translation text (case 2). Do NOT include any other introductory text, labels, quotes, or formatting.`;

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a stream of raw translation/explanation text chunks.
   * @param dto - The translation request DTO containing text, provider, model, etc.
   * @returns An Observable stream of strings (text chunks or markers like [DONE]/[ERROR]).
   */
  generateStream(dto: TranslateRequestDto): Observable<string> {
    // Check mock environment variable (keeping mock logic for now, can be removed later)
    const isMockEnabled = this.configService.get<string>('TRANSLATE_MOCK_ENABLED') === 'true';

    if (isMockEnabled) {
      this.logger.log('[V1 Mock] Mock mode enabled. Returning mock data stream.');
      const mockModel = 'mock-model';
      // Determine if mock should return explanation or translation based on input DTO
      const mockResponse = (dto.text && dto.context) ? MOCK_EXPLANATION_STRING : MOCK_TRANSLATION_STRING;

      // Chunk the mock string
      const chunkSize = 10; // Define chunk size
      const chunks: string[] = [];
      for (let i = 0; i < mockResponse.length; i += chunkSize) {
        chunks.push(mockResponse.substring(i, i + chunkSize));
      }

      // Use concat to send events sequentially with delay between chunks
      // No initial metadata chunk in this simplified version
      return concat(
        from(chunks).pipe( // Stream each chunk from the array
          concatMap(chunk => timer(10).pipe(map(() => chunk))) // Add delay between chunks
        ),
        of('[DONE]') // Send done marker
      );
    }

    // --- Original AI Logic (Simplified) ---
    const providerName = dto.provider || 'deepseek'; // Default provider
    const requestedModel = dto.model;
    this.logger.log(
      `[V1 Forwarding] Attempting translation for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    const provider = this.aiProviderFactory.getProvider(providerName);
    if (!provider) {
      this.logger.error(
        `[V1 Forwarding] AI Provider "${providerName}" is not available.`,
      );
      return throwError(
        () =>
          new HttpException(
            `AI Provider "${providerName}" is not available or configured.`,
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
      );
    }

    // Determine model
    let finalModel: string;
    if (requestedModel) {
      finalModel = requestedModel;
    } else {
      switch (providerName.toLowerCase()) {
        case 'deepseek':
          finalModel = 'deepseek-chat';
          break;
        case 'openrouter':
        default:
          finalModel = 'deepseek-chat'; // Default model for deepseek/openrouter
          break;
      }
      this.logger.log(
        `[V1 Forwarding] No model specified for ${providerName}, using default: ${finalModel}`,
      );
    }

    const messages = this.buildPrompt(dto); // Use the simplified prompt

    // Use a Subject to manually control the output stream
    const subject = new Subject<string>();
    let streamErrored = false;

    try {
      this.logger.log(
        `[V1 Forwarding] Calling ${providerName} provider (raw stream) with model ${finalModel}.`,
      );
      // Call the RAW stream method
      const rawStreamFromProvider = provider.generateRawChatStream(
        messages,
        finalModel,
      );

      // Directly forward raw chunks
      rawStreamFromProvider
        .pipe(
          finalize(() => {
            this.logger.log('[V1 Forwarding] Raw stream finalized.');
            if (!subject.closed) {
              if (!streamErrored) {
                subject.next('[DONE]');
              }
              subject.complete();
            }
          }),
          catchError((err) => {
            streamErrored = true;
            this.logger.error(
              `[V1 Forwarding] Error during raw stream generation for ${providerName}: ${err.message}`,
              err.stack,
            );
            if (!subject.closed) {
              subject.next('[ERROR]');
              subject.complete();
            }
            return throwError(() => err);
          }),
        )
        .subscribe({
          next: (chunk: string) => {
            if (subject.closed) return;
            // Directly send the raw chunk
            if (chunk && chunk.length > 0) {
              subject.next(chunk);
            }
          },
          error: (err) => {
            this.logger.error('[V1 Forwarding] Raw stream subscription error:', err);
          },
          complete: () => {
            this.logger.log('[V1 Forwarding] Raw stream subscription completed.');
          },
        });

      return subject.asObservable();
    } catch (error) {
      this.logger.error(
        `[V1 Forwarding] Error invoking generateRawChatStream for provider ${providerName}:`,
        error,
      );
      if (!subject.closed) {
        subject.error(error);
        subject.complete();
      }
      return throwError(
        () =>
          new HttpException(
            `[V1 Forwarding] Failed to initiate raw stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }
}
