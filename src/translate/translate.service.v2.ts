import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
import { ApiResponse } from '../common/dto/api-response.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';

// Define the structure for the V2 ApiResponse data
interface ApiResponseV2Data {
  type: 'analysis_info' | 'text_chunk' | 'error' | 'done';
  text?: string; // For text_chunk
  payload?: any; // For analysis_info, error, done
}

// Define the structure for the analysis info payload
interface AnalysisInfoPayload {
  inputType: 'word_or_phrase' | 'sentence' | 'fragment';
  sourceText: string;
}

@Injectable()
export class TranslateServiceV2 {
  private readonly logger = new Logger(TranslateServiceV2.name);

  constructor(private aiProviderFactory: AiProviderFactory) {}

  // Build the V2 prompt for AI analysis and translation (Marker-based output)
  private buildPromptV2(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    // Define markers
    const ANALYSIS_START = '[ANALYSIS_INFO_START]';
    const ANALYSIS_END = '[ANALYSIS_INFO_END]';
    const CONTEXT_START = '[CONTEXT_EXPLANATION_START]';
    const CONTEXT_END = '[CONTEXT_EXPLANATION_END]';
    const DICT_ENTRY_START = '[DICTIONARY_ENTRY_START]';
    const DICT_ENTRY_END = '[DICTIONARY_ENTRY_END]';
    const DICT_HEADER_START = '[DICTIONARY_HEADER_START]';
    const DICT_HEADER_END = '[DICTIONARY_HEADER_END]';
    const DEF_START = '[DEFINITION_START]';
    const DEF_END = '[DEFINITION_END]';
    const EXAMPLE_START = '[EXAMPLE_START]';
    const EXAMPLE_END = '[EXAMPLE_END]';
    const TRANS_RESULT_START = '[TRANSLATION_RESULT_START]';
    const TRANS_RESULT_END = '[TRANSLATION_RESULT_END]';
    const FRAGMENT_ERR_START = '[FRAGMENT_ERROR_START]';
    const FRAGMENT_ERR_END = '[FRAGMENT_ERROR_END]';
    const STREAM_END_MARKER = '[STREAM_END]'; // Final marker

    let promptText = `You are an expert linguistic analysis and translation assistant. Your task is to analyze the provided "Input Text" within its "Context", determine its type (word, phrase, sentence, fragment), translate it to the "Target Language", and provide additional relevant information.

You MUST respond by **streaming** natural language text, inserting specific **markers** before and after distinct sections of information. Do not include any introductory text or explanations outside the marked sections.

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Follow these steps precisely:
1.  **Immediately** start by streaming the analysis information enclosed in ${ANALYSIS_START} and ${ANALYSIS_END}. The content inside should be a single JSON object like: \`{"inputType": "...", "sourceText": "..."}\`.
2.  Based on the 'inputType', stream the corresponding sections below, ensuring each section's content is enclosed by its respective START and END markers.
3.  Stream text naturally within the markers. Do not output the markers themselves on new lines unless they are part of the natural text flow.
4.  **Finally**, after all other relevant content and markers have been streamed, stream the single marker ${STREAM_END_MARKER} to signal the absolute end of the response.

Marker Schemas and Order:

**A) Analysis Info (ALWAYS First):**
   ${ANALYSIS_START}
   {"inputType": "word_or_phrase" | "sentence" | "fragment", "sourceText": "{original text}"}
   ${ANALYSIS_END}

**B) If inputType is "word_or_phrase":**
   ${CONTEXT_START}
   {Explanation of the word/phrase in context, in ${targetLang}}
   ${CONTEXT_END}
   ${DICT_ENTRY_START}
     ${DICT_HEADER_START}
     {Word/Phrase} ({General Translation}) {Phonetic or empty}
     ${DICT_HEADER_END}
     For EACH definition:
       ${DEF_START}
       ({Part of Speech}) {Definition in ${targetLang}}
       ${DEF_END}
       For EACH corresponding example:
         ${EXAMPLE_START}
         (原) {Example sentence} (译) {Example translation}
         ${EXAMPLE_END}
   ${DICT_ENTRY_END}

**C) If inputType is "sentence":**
   ${TRANS_RESULT_START}
   {Sentence translation in ${targetLang}, considering context}
   ${TRANS_RESULT_END}

**D) If inputType is "fragment":**
   ${FRAGMENT_ERR_START}
   无法识别或翻译选中的片段，请尝试选择完整的单词、短语或句子。 (Source: "{original fragment}")
   ${FRAGMENT_ERR_END}

**E) Final Marker (ALWAYS Last):**
   ${STREAM_END_MARKER}

Important Rules:
- Start **immediately** with ${ANALYSIS_START}.
- Enclose **all** relevant content within the specified START and END markers.
- Do **not** add any text outside the markers, except for the final ${STREAM_END_MARKER}.
- Ensure markers are exactly as specified (e.g., \`${CONTEXT_START}\`).
- End the **entire** stream **only** with ${STREAM_END_MARKER}.`;

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a V2 translation stream with markers, wrapped in ApiResponseV2 structure.
   * @param dto - The translation request DTO.
   * @returns An Observable stream of ApiResponseV2.
   */
  generateStreamV2(
    dto: TranslateRequestDto,
  ): Observable<ApiResponse<ApiResponseV2Data>> {
    const providerName = dto.provider || 'openrouter';
    const requestedModel = dto.model;
    this.logger.log(
      `[V2] Attempting translation via Factory for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    const provider = this.aiProviderFactory.getProvider(providerName);
    if (!provider) {
      this.logger.error(`[V2] AI Provider "${providerName}" is not available.`);
      return throwError(
        () =>
          new HttpException(
            `AI Provider "${providerName}" is not available or configured.`,
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
      );
    }

    // Determine model (same logic as V1 for now)
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
          finalModel = 'deepseek/deepseek-chat-v3-0324:free'; // Example default
          break;
      }
      this.logger.log(
        `[V2] No model specified for ${providerName}, using default: ${finalModel}`,
      );
    }

    const messages = this.buildPromptV2(dto);

    try {
      this.logger.log(
        `[V2] Calling ${providerName} provider (raw stream) with model ${finalModel}.`,
      );
      const rawStreamFromProvider = provider.generateRawChatStream(
        messages,
        finalModel,
      );

      let analysisInfoSent = false;
      let analysisBuffer = '';
      const ANALYSIS_START_MARKER = '[ANALYSIS_INFO_START]';
      const ANALYSIS_END_MARKER = '[ANALYSIS_INFO_END]';

      return rawStreamFromProvider.pipe(
        mergeMap((chunk: string) => {
          const responsesToSend: ApiResponse<ApiResponseV2Data>[] = [];

          // --- Handle Analysis Info Extraction ---
          if (!analysisInfoSent) {
            analysisBuffer += chunk;
            const startIndex = analysisBuffer.indexOf(ANALYSIS_START_MARKER);
            const endIndex = analysisBuffer.indexOf(ANALYSIS_END_MARKER);

            if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
              const jsonStr = analysisBuffer
                .substring(startIndex + ANALYSIS_START_MARKER.length, endIndex)
                .trim();
              try {
                const analysisPayload: AnalysisInfoPayload =
                  JSON.parse(jsonStr);
                // Send the analysis info as a separate event
                responsesToSend.push(
                  ApiResponse.success(
                    { type: 'analysis_info', payload: analysisPayload },
                    'Analysis info extracted',
                    '0',
                  ),
                );
                analysisInfoSent = true;
                // Add the remaining part of the buffer (after ANALYSIS_END) back for normal processing
                chunk = analysisBuffer.substring(
                  endIndex + ANALYSIS_END_MARKER.length,
                );
                analysisBuffer = ''; // Clear buffer
              } catch (e) {
                this.logger.error(
                  '[V2] Failed to parse analysis info JSON:',
                  e,
                  `JSON String: ${jsonStr}`,
                );
                // Decide how to handle parsing error - maybe send an error event?
                // For now, we'll just log and proceed, potentially losing analysis info.
                analysisInfoSent = true; // Prevent trying again
                chunk = analysisBuffer; // Process the whole buffer as text chunk
                analysisBuffer = '';
              }
            } else if (analysisBuffer.length > 500) {
              // Safety break: If buffer gets too long without finding markers, assume something went wrong
              this.logger.warn(
                '[V2] Analysis info markers not found within reasonable buffer length. Proceeding without analysis info.',
              );
              analysisInfoSent = true;
              chunk = analysisBuffer;
              analysisBuffer = '';
            } else {
              // Markers not yet found, keep buffering, don't send anything yet
              return from([]); // Return empty observable for this chunk
            }
          }
          // --- End Analysis Info Extraction ---

          // Send the remaining/normal text chunk
          if (chunk && chunk.length > 0) {
            // Check for the final marker and remove it if present
            const finalMarkerIndex = chunk.indexOf('[STREAM_END]');
            let textToSend = chunk;
            let streamEnded = false;
            if (finalMarkerIndex !== -1) {
              textToSend = chunk.substring(0, finalMarkerIndex);
              streamEnded = true; // We'll handle completion outside this map
              this.logger.log('[V2] Detected [STREAM_END] marker.');
            }

            if (textToSend.length > 0) {
              responsesToSend.push(
                ApiResponse.success(
                  { type: 'text_chunk', text: textToSend },
                  '',
                  '0',
                ),
              );
            }
            // Note: We don't explicitly send a 'done' event here.
            // Completion is handled by the observable finishing naturally after [STREAM_END] is processed.
          }

          return from(responsesToSend); // Emit the prepared responses
        }),
        catchError((err) => {
          this.logger.error(
            `[V2] Error during raw stream generation for ${providerName}: ${err.message}`,
            err.stack,
          );
          const errorPayload: ApiResponseV2Data = {
            type: 'error',
            payload: {
              message:
                err.message ||
                'An unexpected error occurred during V2 streaming',
            },
          };
          // Send error response, assert the type as data is guaranteed not null here
          const errorResponse = ApiResponse.error<ApiResponseV2Data>(
            err.message,
            'STREAM_GENERATION_ERROR',
            errorPayload, // errorPayload is guaranteed to be ApiResponseV2Data
          ) as ApiResponse<ApiResponseV2Data>; // Type assertion here

          return from([
            errorResponse,
            // Let's rely on observable error completion for the frontend to know the stream ended abnormally.
            // No need to send an explicit 'done' with status 'failed' here.
          ]);
        }),
        // Optionally add startWith if you want an initial "connecting" message, but analysis_info serves a similar purpose.
        // startWith(ApiResponse.success({ type: 'info', text: 'Connecting V2 stream...' }, '', '0'))
      );
    } catch (error) {
      this.logger.error(
        `[V2] Error invoking generateRawChatStream for provider ${providerName}:`,
        error,
      );
      return throwError(
        () =>
          new HttpException(
            `[V2] Failed to initiate raw stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }
}
