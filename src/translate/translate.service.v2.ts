import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, throwError } from 'rxjs'; // Import Subject
import { catchError, finalize } from 'rxjs/operators'; // Import finalize
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
// ApiResponse and ApiResponseV2Data are no longer needed for the stream output format
// import { ApiResponse } from '../common/dto/api-response.dto';
// import { ApiResponseV2Data } from './dto/api-response-v2-data.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
// MarkerStreamProcessor is no longer needed

// Define the structure for the final JSON response expected from the AI
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

{
  "analysisInfo": {
    "inputType": "word_or_phrase" | "sentence" | "fragment",
    "sourceText": "{original text}"
  },
  "context": { // Only for word_or_phrase
    "word_translation": "{General Translation in ${targetLang}}",
    "explanation": "{Explanation of the word/phrase in context, in ${targetLang}}"
  },
  "dictionary": { // Only for word_or_phrase
    "word": "{word}",
    "phonetic": "{phonetic, if applicable}",
    "definitions": [ // MUST BE an array with 1-3 objects. Start with '['.
      {
        "definition": "{Definition in ${targetLang}}",
        "example": "{Example sentence (original and translation)}"
      }
      // ... potentially 1 or 2 more objects like the one above
    ]
  },
  "translationResult": "{Sentence translation in ${targetLang}, considering context}", // Only for sentence
  "fragmentError": "无法识别或翻译选中的片段..." // Only for fragment
}

Important Rules:
- Output **only** the raw JSON object itself. Your entire response **must** start directly with '{' and end directly with '}'.
- **CRITICAL:** Do **NOT** wrap the JSON object in markdown code fences (like \`\`\`json ... \`\`\`). The response must be pure JSON, nothing else.
- Ensure the JSON is valid.
- Provide information relevant to the analyzed 'inputType'.
  - If 'inputType' is 'sentence', only include 'analysisInfo' and 'translationResult'.
  - If 'inputType' is 'fragment', only include 'analysisInfo' and 'fragmentError'.
  - If 'inputType' is 'sentence', only include 'analysisInfo' and 'translationResult'.
  - If 'inputType' is 'fragment', only include 'analysisInfo' and 'fragmentError'.
  - If 'inputType' is 'word_or_phrase', include 'analysisInfo', 'context', and 'dictionary' (if applicable). The 'dictionary.definitions' field MUST be an array containing between 1 and 3 objects, each with 'definition' and 'example' keys. It MUST start with '[' and end with ']'.
`; // End of template literal

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a V2 translation stream by forwarding raw text chunks,
   * ending with '[DONE]' on success or '[ERROR]' on failure.
   * Frontend is responsible for parsing the streamed JSON chunks.
   * @param dto - The translation request DTO.
   * @returns An Observable stream of strings (text chunks or markers).
   */
  generateStreamV2(dto: TranslateRequestDto): Observable<string> {
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

    // Use a Subject to manually control the output stream (now emitting strings)
    const subject = new Subject<string>();
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
              // Send the final '[DONE]' marker ONLY if the stream completed successfully
              if (!streamErrored) {
                subject.next('[DONE]');
              }
              subject.complete(); // Complete the observable stream
            }
          }),
          catchError((err) => {
            streamErrored = true;
            this.logger.error(
              `[V2 Forwarding] Error during raw stream generation for ${providerName}: ${err.message}`,
              err.stack,
            );
            if (!subject.closed) {
              // Send the '[ERROR]' marker
              subject.next('[ERROR]');
              subject.complete(); // Complete the observable stream even on error
            }
            // It's important to still propagate the error for potential higher-level handling
            // but the SSE stream itself is considered 'complete' with the [ERROR] marker.
            return throwError(() => err);
          }),
        )
        .subscribe({
          next: (chunk: string) => {
            if (subject.closed) return;
            // Wrap the raw text chunk in the standard JSON structure
            if (chunk && chunk.length > 0) {
              this.logger.debug(`[V2 Raw Chunk] Received: ${chunk}`); // Add logging for raw chunk
              const wrappedData = {
                code: 0,
                msg: '',
                data: {
                  type: 'text',
                  model: finalModel, // Use the determined model name
                  text: chunk,
                },
              };
              subject.next(JSON.stringify(wrappedData)); // Send the stringified JSON
            }
          },
          error: (err) => {
            // Error handling is now primarily done in catchError
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
