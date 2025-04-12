import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, throwError } from 'rxjs'; // Import Subject
import { catchError, finalize } from 'rxjs/operators'; // Import finalize
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
import { ApiResponse } from '../common/dto/api-response.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
// MarkerStreamProcessor is no longer needed

// Define the structure for the V2 ApiResponse data (Frontend will receive text chunks to build this)
interface FinalJsonResponse {
  analysisInfo?: {
    inputType: 'word_or_phrase' | 'sentence' | 'fragment';
    sourceText: string;
  };
  explanation?: string; // Basic word/phrase + translation
  contextExplanation?: string;
  dictionary?: {
    definitions: { pos: string; def: string }[];
    examples: { original: string; translation: string }[];
  };
  translationResult?: string;
  fragmentError?: string; // Error message for fragment
}

// Define the structure for the SSE events sent to the frontend
interface ApiResponseV2Data {
  type: 'text_chunk' | 'error' | 'done'; // Simplified event types
  text?: string; // For text_chunk
  payload?: any; // For error, done
}

// AnalysisInfo is no longer sent as a separate event type
// interface AnalysisInfoPayload { ... }

@Injectable()
export class TranslateServiceV2 {
  private readonly logger = new Logger(TranslateServiceV2.name);

  constructor(private aiProviderFactory: AiProviderFactory) {}

  // Build the V2 prompt asking for a single JSON output (V2.3)
  private buildPromptV2(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    // Note: We rely on the AI's streaming capability to send the JSON structure incrementally.
    let promptText = `You are an expert linguistic analysis and translation assistant. Your task is to analyze the provided "Input Text" within its "Context", determine its type (word, phrase, sentence, fragment), translate it to the "Target Language", and provide additional relevant information.

You MUST respond with a **single, complete JSON object** containing all the analysis and translation results. Do not include any introductory text, explanations, apologies, or markdown formatting outside the final JSON object.

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Generate a JSON object with the following structure, omitting fields that are not applicable based on the input type analysis:

\`\`\`json
{
  "analysisInfo": {
    "inputType": "word_or_phrase" | "sentence" | "fragment",
    "sourceText": "{original text}"
  },
  "explanation": "{Original Word/Phrase} ({General Translation})", // Only for word_or_phrase
  "contextExplanation": "{Explanation of the word/phrase in context, in ${targetLang}}", // Only for word_or_phrase
  "dictionary": { // Only for word_or_phrase
    "definitions": [ // Array containing 1 to 3 definition objects
      { "pos": "{Part of Speech}", "def": "{Definition in ${targetLang}}" }
      // ... up to 2 more definitions
    ],
    "examples": [
      { "original": "{Example sentence}", "translation": "{Example translation}" }
      // ... more examples (try to associate with definitions if possible)
    ]
  },
  "translationResult": "{Sentence translation in ${targetLang}, considering context}", // Only for sentence
  "fragmentError": "无法识别或翻译选中的片段..." // Only for fragment
}
\`\`\`

Important Rules:
- Output **only** the JSON object. Nothing before or after it.
- Ensure the JSON is valid.
- Provide information relevant to the analyzed 'inputType'. For example, if it's a sentence, only include 'analysisInfo' and 'translationResult'. If it's a fragment, only include 'analysisInfo' and 'fragmentError'.
- For 'word_or_phrase', include 'analysisInfo', 'explanation', 'contextExplanation', and 'dictionary' (if definitions/examples are found). The 'dictionary.definitions' array should contain between 1 and 3 definitions.`;

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a V2 translation stream by forwarding raw text chunks.
   * Frontend is responsible for parsing the streamed JSON.
   * @param dto - The translation request DTO.
   * @returns An Observable stream of ApiResponseV2.
   */
  generateStreamV2(
    dto: TranslateRequestDto,
  ): Observable<ApiResponse<ApiResponseV2Data>> {
    const providerName = dto.provider || 'openrouter';
    const requestedModel = dto.model;
    this.logger.log(
      `[V2 Forwarding] Attempting translation for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    const provider = this.aiProviderFactory.getProvider(providerName);
    if (!provider) {
      this.logger.error(
        `[V2 Forwarding] AI Provider "${providerName}" is not available.`,
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
          finalModel = 'deepseek/deepseek-chat-v3-0324:free';
          break;
      }
      this.logger.log(
        `[V2 Forwarding] No model specified for ${providerName}, using default: ${finalModel}`,
      );
    }

    const messages = this.buildPromptV2(dto);

    // Use a Subject to manually control the output stream
    const subject = new Subject<ApiResponse<ApiResponseV2Data>>();
    let streamErrored = false;

    try {
      this.logger.log(
        `[V2 Forwarding] Calling ${providerName} provider (raw stream) with model ${finalModel}.`,
      );
      const rawStreamFromProvider = provider.generateRawChatStream(
        messages,
        finalModel,
      );

      // Simplified logic: Directly forward chunks
      rawStreamFromProvider
        .pipe(
          finalize(() => {
            this.logger.log('[V2 Forwarding] Raw stream finalized.');
            if (!subject.closed) {
              // Send the final 'done' event ONLY if the stream completed successfully
              if (!streamErrored) {
                subject.next(
                  ApiResponse.success<ApiResponseV2Data>(
                    { type: 'done', payload: { status: 'completed' } },
                    'Stream ended',
                    '0',
                  ),
                );
              }
              subject.complete();
            }
          }),
          catchError((err) => {
            streamErrored = true;
            this.logger.error(
              `[V2 Forwarding] Error during raw stream generation for ${providerName}: ${err.message}`,
              err.stack,
            );
            if (!subject.closed) {
              const errorPayload: ApiResponseV2Data = {
                type: 'error',
                payload: {
                  message:
                    err.message ||
                    'An unexpected error occurred during V2 streaming',
                },
              };
              subject.next(
                ApiResponse.error<ApiResponseV2Data>(
                  err.message,
                  'STREAM_GENERATION_ERROR',
                  errorPayload,
                ) as ApiResponse<ApiResponseV2Data>,
              );
              subject.next(
                ApiResponse.success<ApiResponseV2Data>(
                  { type: 'done', payload: { status: 'failed' } },
                  'Stream ended with error',
                  '0',
                ),
              );
              subject.complete();
            }
            return throwError(() => err); // Propagate error
          }),
        )
        .subscribe({
          next: (chunk: string) => {
            if (subject.closed) return;
            // Directly forward the raw text chunk
            if (chunk && chunk.length > 0) {
               subject.next(ApiResponse.success({ type: 'text_chunk', text: chunk }));
            }
          },
          error: (err) => {
            // Handled by catchError
            this.logger.error('[V2 Forwarding] Raw stream subscription error:', err);
          },
          complete: () => {
            // Handled by finalize
            this.logger.log('[V2 Forwarding] Raw stream subscription completed.');
          },
        });

      // Return the subject as an Observable
      return subject.asObservable();
    } catch (error) {
      this.logger.error(
        `[V2 Forwarding] Error invoking generateRawChatStream for provider ${providerName}:`,
        error,
      );
      if (!subject.closed) {
        subject.error(error);
        subject.complete();
      }
      return throwError(
        () =>
          new HttpException(
            `[V2 Forwarding] Failed to initiate raw stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }
}
