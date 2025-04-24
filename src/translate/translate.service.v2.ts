import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Import ConfigService
import { Observable, Subject, concat, from, of, throwError, timer } from 'rxjs'; // Import Subject, of, concat, throwError, from, timer
import { catchError, concatMap, finalize, map } from 'rxjs/operators'; // Import finalize, map, concatMap
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
// ApiResponse and ApiResponseV2Data are no longer needed for the stream output format
// import { ApiResponse } from '../common/dto/api-response.dto';
// import { ApiResponseV2Data } from './dto/api-response-v2-data.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
// MarkerStreamProcessor is no longer needed

// Define the structure for the final JSON response expected from the AI
// Note: These interfaces are for documentation/typing, AI might not strictly adhere.
interface WordPhraseContext {
  word_translation: string;
  explanation: string;
}
interface DictionaryDefinition {
  pos: string;
  def: string;
  example: {
    orig: string;
    trans: string;
  };
}
interface DictionaryInfo {
  word: string;
  phonetic: string | null;
  definitions: DictionaryDefinition[];
}
interface WordPhraseResponse {
  context: WordPhraseContext;
  dictionary: DictionaryInfo;
}

// Define Mock data as an object first
const mockDataObject = {
  context: {
    word_translation: "配置 (Mock)",
    explanation: "在模拟上下文中，'configure'指的是对软件或系统进行设置或调整。"
  },
  dictionary: {
    word: "configure (Mock)",
    phonetic: "/kənˈfɪɡjər/",
    definitions: [
      {
        pos: "动词",
        def: "配置，设定 (Mock)",
        example: {
          orig: "You need to configure the software (Mock).",
          trans: "你需要配置这个软件 (Mock)。"
        }
      }
    ]
  }
};
// Convert the object to a compact JSON string
const MOCK_WORD_RESPONSE_STRING = JSON.stringify(mockDataObject);


@Injectable()
export class TranslateServiceV2 {
  private readonly logger = new Logger(TranslateServiceV2.name);

  constructor(
    private aiProviderFactory: AiProviderFactory,
    private configService: ConfigService, // Inject ConfigService
  ) {}

  // Build the V2 prompt asking for either JSON (word/phrase) or plain text (sentence)
  private buildPromptV2(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    // Construct the prompt string carefully, avoiding problematic characters inside the template literal
    let promptText = `You are an expert linguistic analysis and translation assistant. Your task is to analyze the provided "Input Text" within its "Context" and translate it to the "Target Language".

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Analyze the "Input Text":
1. Determine if the input is a **single word or a common phrase** suitable for dictionary lookup.
2. If it is NOT a single word or common phrase, treat it as a **sentence** that needs translation.

Based on the analysis, provide your response following **ONLY ONE** of these formats:

**Format A: If Input is a Word or Phrase**
- Your **entire response** MUST be a **single, complete, valid JSON string**.
- The JSON structure MUST be exactly as follows:
{
  "context": {
    "word_translation": "{General Translation in ${targetLang}}",
    "explanation": "{Explanation of the word/phrase in context, in ${targetLang}}"
  },
  "dictionary": {
    "word": "{original word/phrase}",
    "phonetic": "{phonetic, if applicable, otherwise null}",
    "definitions": [
      {
        "pos": "{part of speech, e.g., '动词'}",
        "def": "{Definition in ${targetLang}}",
        "example": {
          "orig": "{Example sentence in original language}",
          "trans": "{Example sentence translation in ${targetLang}}"
        }
      }
      // Include 1 to 3 relevant definitions with examples.
    ]
  }
}
- **CRITICAL:** Output **only** the raw JSON string itself. Your response **MUST** start directly with '{' and end directly with '}'.
- **ABSOLUTELY FORBIDDEN:** Do **NOT** wrap the JSON string in Markdown code fences (like \`\`\`json ... \`\`\`). The response must be pure JSON.
- **REPEAT:** The output must be **ONLY** the JSON string, nothing before the opening '{', nothing after the closing '}', and no \`\`\`json or \`\`\` markers.

**Format B: If Input is a Sentence (or anything else)**
- Your **entire response** MUST be the **plain text translation** of the sentence into the "Target Language", considering the "Context".
- Do **NOT** include any JSON structure, quotes, labels, or any other text besides the translation itself.

Example for Format A (Input: "configure"):
(Your output should look like this, starting with { and ending with }):
{
  "context": {
    "word_translation": "配置",
    "explanation": "在上下文中，'configure'指的是对软件或系统进行设置或调整。"
  },
  "dictionary": {
    "word": "configure",
    "phonetic": "/kənˈfɪɡjər/",
    "definitions": [
      {{"type":"text","model":"deepseek/deepseek-chat-v3-0324:free","text":"为"}
        "pos": "动词",
        "def": "配置，设定",
        "example": {
          "orig": "You need to configure the software.",
          "trans": "你需要配置这个软件。"
        }
      }
    ]
  }
}

Example for Format B (Input: "Hello world"):
(Your output should look like this, just the plain text):
你好，世界

Choose **only one format** based on your analysis and provide **only** the specified output.`;

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
    // Check mock environment variable
    const isMockEnabled = this.configService.get<string>('TRANSLATE_MOCK_ENABLED') === 'true';

    if (isMockEnabled) {
      this.logger.log('[V2 Mock] Mock mode enabled. Returning mock data stream.');
      const mockModel = 'mock-model';
      // Construct the mock stream: metadata, mock data, done marker
      const metadata = {
        code: 0,
        msg: '',
        data: { type: 'text', model: mockModel },
      };

      // Chunk the mock string
      const chunkSize = 10; // Define chunk size
      const chunks: string[] = [];
      for (let i = 0; i < MOCK_WORD_RESPONSE_STRING.length; i += chunkSize) {
        chunks.push(MOCK_WORD_RESPONSE_STRING.substring(i, i + chunkSize));
      }

      // Use concat to send events sequentially with delay between chunks
      return concat(
        of(JSON.stringify(metadata)), // 1. Send metadata
        from(chunks).pipe( // 2. Stream each chunk from the array
          concatMap(chunk => timer(10).pipe(map(() => chunk))) // Add delay between chunks
        ),
        of('[DONE]') // 3. Send done marker
      );
    }

    // --- Original AI Logic ---
    const providerName = dto.provider || 'deepseek'; // Default provider
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
          // Use a model known to be good at following JSON instructions if possible
          // finalModel = 'deepseek/deepseek-chat-v3-0324:free'; // Reverted default model for openrouter
          finalModel = 'deepseek-chat'; // Fallback to a default model
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

      let isFirstChunk = true; // Flag to send metadata only once

      // Send initial metadata and then forward raw chunks
      rawStreamFromProvider
        .pipe(
          finalize(() => { // Logic for [DONE] remains similar
            this.logger.log('[V2 Forwarding] Raw stream finalized.');
            if (!subject.closed) {
              // Send the final '[DONE]' marker ONLY if the stream completed successfully
              if (!streamErrored) {
                subject.next('[DONE]');
              }
              subject.complete(); // Complete the observable stream
            }
          }),
          catchError((err) => { // Logic for [ERROR] remains similar
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

            if (isFirstChunk) {
              // Send metadata first
              const metadata = {
                code: 0,
                msg: '',
                data: {
                  type: 'text', // Indicate this is metadata + text stream start
                  model: finalModel,
                  // Add any other relevant metadata here if needed
                },
              };
              subject.next(JSON.stringify(metadata));
              isFirstChunk = false; // Don't send metadata again
            }

            // Send the raw chunk directly
            if (chunk && chunk.length > 0) {
               // this.logger.debug(`[V2 Raw Chunk] Sending: ${chunk}`); // Optional log
               subject.next(chunk); // Send raw chunk
            }
          },
          error: (err) => { // Error handling done in catchError
             this.logger.error('[V2 Forwarding] Raw stream subscription error:', err);
          },
          complete: () => { // Completion handling done in finalize
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
