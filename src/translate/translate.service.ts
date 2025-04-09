import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs'; // Import 'from'
import { catchError, map } from 'rxjs/operators'; // Import operators (add map back)
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
import { ApiResponse } from '../common/dto/api-response.dto';
import { StreamEventPayload } from '../common/dto/stream-event-payload.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';

// Define interfaces for expected AI JSON response structures (These are for documentation/typing, AI returns raw JSON)
interface AiWordResponsePayload {
  inputType: 'word_or_phrase';
  sourceText: string;
}
interface AiContextExplanationPayload {
  text: string;
}
interface AiDictionaryStartPayload {
  word: string;
  translation: string;
  phonetic: string | null;
}
interface AiDefinitionPayload {
  pos: string;
  def: string;
}
interface AiExamplePayload {
  original: string;
  translation: string;
}
interface AiTranslationResultPayload {
  text: string;
}
interface AiFragmentErrorPayload {
  message: string;
  sourceText: string;
}
// No specific payload needed for dictionary_end or done

@Injectable()
export class TranslateService {
  private readonly logger = new Logger(TranslateService.name);

  // Inject the AiProviderFactory
  constructor(private aiProviderFactory: AiProviderFactory) {}

  // Build the prompt for AI analysis and translation (JSON Lines output)
  private buildPrompt(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN'; // Default to Chinese
    const inputText = dto.text;
    const context = dto.context;

    // Base prompt structure for JSON Lines output
    let promptText = `You are an expert linguistic analysis and translation assistant for a Chrome extension. Your task is to analyze the provided "Input Text" within its "Context", determine its type (word, phrase, sentence, fragment), translate it to the "Target Language", and provide additional relevant information.

You MUST respond by **streaming** a sequence of **JSON objects**, with **each JSON object on a new line**. Each JSON object represents a specific piece of information or an event. Do not include any introductory text, explanations, or markdown formatting outside of the JSON objects.

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Follow these steps:
1. Analyze the "Input Text" to determine its type: "word", "phrase", "sentence", or "fragment".
2. Stream the JSON objects line by line according to the identified type and the schemas below.
3. Ensure the translation and explanations consider the provided "Context".

JSON Line Schemas (Stream one JSON object per line):

If Input Text is a SINGLE WORD or a standard PHRASE, stream these JSON objects sequentially:
{"type": "analysis_info", "payload": {"inputType": "word_or_phrase", "sourceText": "{original word/phrase}"}}
{"type": "context_explanation", "payload": {"text": "在这个上下文中，'{original word/phrase}' 表示 {meaning in context in target language}。"}}
{"type": "dictionary_start", "payload": {"word": "{original word/phrase}", "translation": "{general translation}", "phonetic": "{phonetic or null}"}}
For EACH definition found, stream:
{"type": "definition", "payload": {"pos": "{part of speech}", "def": "{definition in target language}"}}
For EACH corresponding example (if available), stream:
{"type": "example", "payload": {"original": "{example sentence}", "translation": "{example translation}"}}
After all definitions/examples, stream:
{"type": "dictionary_end"}
Fallback for uncommon word/phrase: If dictionary info is unavailable, after dictionary_start, stream only dictionary_end.

If Input Text is a complete SENTENCE, stream these JSON objects sequentially:
{"type": "analysis_info", "payload": {"inputType": "sentence", "sourceText": "{original sentence}"}}
{"type": "translation_result", "payload": {"text": "{sentence translation in target language, considering context}"}}

If Input Text is an INCOMPLETE FRAGMENT or cannot be meaningfully interpreted/translated, stream ONLY this JSON object:
{"type": "fragment_error", "payload": {"message": "无法识别或翻译选中的片段，请尝试选择完整的单词、短语或句子。", "sourceText": "{original fragment}"}}

Finally, after all other relevant JSON objects have been streamed, stream the 'done' signal:
{"type": "done"}

Important Rules:
- Output **each** JSON object on a **new line**.
- Ensure each line contains a **single, complete, valid** JSON object.
- Do **not** add any text or formatting before, after, or between the JSON lines.
- For 'word_or_phrase', stream the components ('dictionary_start', 'definition', 'example', 'dictionary_end') separately.
- For 'fragment_error', stream **only** that single JSON line and then the 'done' line.
- Always end the entire stream with the \`{"type": "done"}\` JSON line.`; // Escaped backtick here

    // Return the message array format expected by the providers
    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a translation stream wrapped in ApiResponse structure.
   * @param dto - The translation request DTO containing text, provider, model, etc.
   * @returns An Observable stream of ApiResponse containing StreamEventPayload.
   */
  generateStream(
    dto: TranslateRequestDto,
  ): Observable<ApiResponse<StreamEventPayload<any>>> {
    const providerName = dto.provider || 'openrouter'; // Default to 'openrouter'
    const requestedModel = dto.model;

    this.logger.log(
      `Attempting translation via Factory for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    // 1. Get the appropriate provider instance from the factory
    const provider = this.aiProviderFactory.getProvider(providerName);

    if (!provider) {
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
      // Provider now returns Observable<StreamEventPayload<any>> containing parsed JSON lines
      const streamFromProvider = provider.generateChatStream(
        messages,
        finalModel,
      );

      // Process each event (parsed JSON line) from the provider and wrap it in ApiResponse
      return streamFromProvider.pipe(
        map((eventPayload: StreamEventPayload<any>) => {
          // Simply wrap the received payload (which is already structured by the provider)
          // The 'type' inside eventPayload now dictates the kind of info (e.g., 'context_explanation', 'definition')
          if (eventPayload.type === 'fragment_error') {
            // If provider parsed a fragment error JSON line, wrap it as an error ApiResponse
            return ApiResponse.error<StreamEventPayload<any>>(
              eventPayload.payload.message, // Use message from payload
              'FRAGMENT_ERROR',
              eventPayload, // Keep the original payload structure in data
            ) as ApiResponse<StreamEventPayload<any>>; // Assertion needed due to static method signature
          } else if (eventPayload.type === 'parsing_error') {
            // If provider sent a parsing error event
            return ApiResponse.error<StreamEventPayload<any>>(
              eventPayload.payload.message,
              'AI_JSON_PARSE_ERROR',
              eventPayload,
            ) as ApiResponse<StreamEventPayload<any>>;
          } else {
            // For all other valid event types from AI ('analysis_info', 'context_explanation', 'dictionary_start', etc.)
            return ApiResponse.success(eventPayload, '', '0');
          }
        }),
        catchError((err) => {
          // Handle errors from the provider stream itself (e.g., network error, API key error)
          this.logger.error(
            `Error during stream generation for ${providerName}: ${err.message}`,
            err.stack,
          );
          const errorPayload: StreamEventPayload<{ message: string }> = {
            type: 'error', // Generic error type for stream failure
            payload: {
              message:
                err.message || 'An unexpected error occurred during streaming',
            },
          };
          // Return an Observable emitting the error ApiResponse, followed by a 'done' event indicating failure
          return from([
            ApiResponse.error<StreamEventPayload<{ message: string }>>(
              err.message,
              'STREAM_GENERATION_ERROR',
              errorPayload,
            ) as ApiResponse<StreamEventPayload<any>>, // Use Type Assertion
            ApiResponse.success(
              { type: 'done', payload: { status: 'failed' } }, // Signal stream ended due to error
              'Stream ended with error',
              '0',
            ),
          ]);
        }),
        // Note: The 'done' event with status 'completed' should now be sent by the AI
        // as the last JSON line: {"type": "done"}
        // and processed like any other event in the map operator above.
        // We no longer need endWith here.
      );
    } catch (error) {
      // Catch synchronous errors during setup (e.g., provider init)
      this.logger.error(
        `Error invoking generateChatStream for provider ${providerName}:`,
        error,
      );
      return throwError(
        () =>
          new HttpException(
            `Failed to initiate stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }
}
