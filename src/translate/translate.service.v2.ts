import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, throwError } from 'rxjs'; // Import Subject
import { catchError, finalize } from 'rxjs/operators'; // Import finalize
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
import { ApiResponse } from '../common/dto/api-response.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
// Remove MarkerStreamProcessor import as its logic is now integrated
// import { MarkerStreamProcessor } from './marker-stream.processor';

// Define the structure for the V2 ApiResponse data
interface ApiResponseV2Data {
  type:
    | 'analysis_info'
    | 'section_start'
    | 'text_chunk'
    | 'section_end'
    | 'error'
    | 'done';
  text?: string;
  payload?: any;
}

// Define the structure for the analysis info payload
interface AnalysisInfoPayload {
  inputType: 'word_or_phrase' | 'sentence' | 'fragment';
  sourceText: string;
}

// --- Define Single Character Markers V2.2 ---
const MARKERS = {
  ANALYSIS_INFO: '§', // Section Sign (U+00A7) - Followed by JSON
  EXPLANATION: '¶', // Pilcrow Sign (U+00B6)
  CONTEXT_EXPLANATION: '¤', // Currency Sign (U+00A4)
  DICTIONARY: '¦', // Broken Bar (U+00A6)
  TRANSLATION_RESULT: '¬', // Not Sign (U+00AC)
  FRAGMENT_ERROR: '±', // Plus-Minus Sign (U+00B1)
};
const ALL_MARKER_CHARS = Object.values(MARKERS);
// Map marker character back to section name
const SECTION_MAP: Record<string, string> = {
  [MARKERS.EXPLANATION]: 'EXPLANATION',
  [MARKERS.CONTEXT_EXPLANATION]: 'CONTEXT_EXPLANATION',
  [MARKERS.DICTIONARY]: 'DICTIONARY',
  [MARKERS.TRANSLATION_RESULT]: 'TRANSLATION_RESULT',
  [MARKERS.FRAGMENT_ERROR]: 'FRAGMENT_ERROR',
};
// -----------------------------------------

@Injectable()
export class TranslateServiceV2 {
  private readonly logger = new Logger(TranslateServiceV2.name);

  constructor(private aiProviderFactory: AiProviderFactory) {}

  // Build the V2 prompt using single-character markers
  private buildPromptV2(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    let promptText = `You are an expert linguistic analysis and translation assistant. Your task is to analyze the provided "Input Text" within its "Context", determine its type (word, phrase, sentence, fragment), translate it to the "Target Language", and provide additional relevant information.

You MUST respond by **streaming** natural language text. You MUST use specific **single special characters** to mark the **beginning** of distinct sections. Do NOT use any end markers. Do not include any introductory text or explanations outside the marked sections.

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Follow these steps precisely:
1.  **Immediately** start the stream with the marker ${MARKERS.ANALYSIS_INFO} followed directly by a single JSON object like: \`{"inputType": "...", "sourceText": "..."}\`. Do not add any characters before ${MARKERS.ANALYSIS_INFO}.
2.  Based on the 'inputType', stream the corresponding sections below, ensuring each section starts **exactly** with its designated single-character marker.
3.  Stream text naturally after the marker.
4.  Do **NOT** add any marker or extra characters at the very end of the entire stream after the last section's content.

Marker Definitions and Order:

Marker | Section Content Starts After Marker
-------|------------------------------------
${MARKERS.ANALYSIS_INFO} | JSON object: {"inputType": "word_or_phrase" | "sentence" | "fragment", "sourceText": "{original text}"} (MUST be first)
${MARKERS.EXPLANATION} | {Original Word/Phrase} ({General Translation}) (Only if inputType is word_or_phrase)
${MARKERS.CONTEXT_EXPLANATION} | {Explanation of the word/phrase in context, in ${targetLang}} (Only if inputType is word_or_phrase)
${MARKERS.DICTIONARY} | For EACH definition: "DEFINITION: ({Part of Speech}) {Definition in ${targetLang}}\\n" For EACH example: "EXAMPLE: (原) {Example sentence} (译) {Example translation}\\n" (Only if inputType is word_or_phrase, output each on new line)
${MARKERS.TRANSLATION_RESULT} | {Sentence translation in ${targetLang}, considering context} (Only if inputType is sentence)
${MARKERS.FRAGMENT_ERROR} | 无法识别或翻译选中的片段，请尝试选择完整的单词、短语或句子。 (Source: "{original fragment}") (Only if inputType is fragment)

Important Rules:
- Start the entire response **immediately** with ${MARKERS.ANALYSIS_INFO} followed by the JSON.
- Each subsequent section MUST start **exactly** with its designated single-character marker (${MARKERS.EXPLANATION}, ${MARKERS.CONTEXT_EXPLANATION}, etc.).
- Do **NOT** use any END markers.
- Do **NOT** add any text outside the content that follows a marker.
- Ensure the JSON after ${MARKERS.ANALYSIS_INFO} is valid and complete on a single logical line (even if streamed).
- Inside the Dictionary section (${MARKERS.DICTIONARY}), prefix each definition with "DEFINITION: " and each example with "EXAMPLE: ", each on its own line (\n).`;

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a V2 translation stream with eventized single-character markers.
   * @param dto - The translation request DTO.
   * @returns An Observable stream of ApiResponseV2.
   */
  generateStreamV2(
    dto: TranslateRequestDto,
  ): Observable<ApiResponse<ApiResponseV2Data>> {
    const providerName = dto.provider || 'openrouter';
    const requestedModel = dto.model;
    this.logger.log(
      `[V2 SingleChar] Attempting translation for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    const provider = this.aiProviderFactory.getProvider(providerName);
    if (!provider) {
      this.logger.error(
        `[V2 SingleChar] AI Provider "${providerName}" is not available.`,
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
        `[V2 SingleChar] No model specified for ${providerName}, using default: ${finalModel}`,
      );
    }

    const messages = this.buildPromptV2(dto);

    // Use a Subject to manually control the output stream
    const subject = new Subject<ApiResponse<ApiResponseV2Data>>();
    let streamErrored = false;

    try {
      this.logger.log(
        `[V2 SingleChar] Calling ${providerName} provider (raw stream) with model ${finalModel}.`,
      );
      const rawStreamFromProvider = provider.generateRawChatStream(
        messages,
        finalModel,
      );

      let analysisInfoSent = false;
      let buffer = '';
      let currentSection: string | null = null;
      let analysisJsonBuffer = '';
      let lookingForAnalysisJson = false; // Flag to indicate we are collecting JSON after §

      const emitTextChunks = (text: string) => {
        if (!text || subject.closed) return;
        for (const char of text) {
          subject.next(ApiResponse.success({ type: 'text_chunk', text: char }));
        }
      };

      const processBuffer = () => {
        if (subject.closed) return;

        // Special handling for Analysis Info JSON right after §
        if (lookingForAnalysisJson) {
          let jsonEndFound = false;
          let jsonEndIndex = -1;

          // Check if any *other* marker appears, indicating end of JSON
          for (const markerChar of ALL_MARKER_CHARS) {
            if (markerChar === MARKERS.ANALYSIS_INFO) continue;
            const idx = buffer.indexOf(markerChar);
            if (idx !== -1) {
              jsonEndFound = true;
              jsonEndIndex = idx;
              break; // Found the earliest next marker
            }
          }

          if (jsonEndFound) {
            analysisJsonBuffer += buffer.substring(0, jsonEndIndex);
            buffer = buffer.substring(jsonEndIndex); // Keep the next marker
            lookingForAnalysisJson = false; // Stop collecting JSON

            try {
              const analysisPayload: AnalysisInfoPayload = JSON.parse(analysisJsonBuffer);
              subject.next(
                ApiResponse.success({
                  type: 'analysis_info',
                  payload: analysisPayload,
                }),
              );
              analysisInfoSent = true;
            } catch (e) {
              this.logger.error(
                '[V2 SingleChar] Failed to parse analysis info JSON:', e, `JSON String: ${analysisJsonBuffer}`,
              );
              analysisInfoSent = true; // Give up
            }
            analysisJsonBuffer = ''; // Clear JSON buffer regardless of success
            // Now, continue processing the rest of the buffer in the main loop
          } else {
            // No other marker found yet, assume current buffer is part of JSON
            analysisJsonBuffer += buffer;
            buffer = '';
            // Safety check
            if (analysisJsonBuffer.length > 1000) {
              this.logger.error('[V2 SingleChar] Analysis JSON buffer exceeded limit.');
              lookingForAnalysisJson = false;
              analysisInfoSent = true; // Give up
              buffer = analysisJsonBuffer; // Process as text/error later?
              analysisJsonBuffer = '';
            } else {
              return; // Need more data for JSON
            }
          }
        } // End if lookingForAnalysisJson

        // Main processing loop for section markers and text
        let continueProcessing = true;
        while (continueProcessing && !subject.closed) {
          continueProcessing = false;
          let markerFoundIndex = -1;
          let foundMarker = '';

          // Find the first section marker (excluding ANALYSIS_INFO)
          for (const markerChar of ALL_MARKER_CHARS) {
            if (markerChar === MARKERS.ANALYSIS_INFO) continue;
            const idx = buffer.indexOf(markerChar);
            if (idx !== -1 && (markerFoundIndex === -1 || idx < markerFoundIndex)) {
              markerFoundIndex = idx;
              foundMarker = markerChar;
            }
          }

          if (markerFoundIndex !== -1) { // Found a section marker
            const textBeforeMarker = buffer.substring(0, markerFoundIndex);
            const sectionName = SECTION_MAP[foundMarker];

            // Emit text before the marker (belongs to previous section)
            if (textBeforeMarker.length > 0 && currentSection) {
              emitTextChunks(textBeforeMarker);
            } else if (textBeforeMarker.length > 0 && !currentSection && textBeforeMarker.trim() !== '') {
              this.logger.warn(`[V2 SingleChar] Ignoring text found outside section: "${textBeforeMarker}"`);
            }

            // End previous section if one was active
            if (currentSection) {
              subject.next(
                ApiResponse.success({
                  type: 'section_end',
                  payload: { section: currentSection },
                }),
              );
            }

            // Start new section
            if (sectionName) {
              currentSection = sectionName;
              subject.next(
                ApiResponse.success({
                  type: 'section_start',
                  payload: { section: currentSection },
                }),
              );
            } else {
              this.logger.error(`[V2 SingleChar] Found marker ${foundMarker} which is not defined.`);
              currentSection = null;
            }

            // Remove processed text and marker
            buffer = buffer.substring(markerFoundIndex + 1);
            continueProcessing = true; // Process rest of buffer

          } else { // No more markers found in the current buffer
            // Emit the entire remaining buffer as text for the current section
            if (buffer.length > 0 && currentSection) {
              emitTextChunks(buffer);
              buffer = ''; // Clear buffer after emitting
            }
            // If not in a section, hold the buffer
          }
        } // End while loop
      };

      rawStreamFromProvider
        .pipe(
          finalize(() => {
            this.logger.log('[V2 SingleChar] Raw stream finalized.');
            if (!subject.closed) {
              // Process any final remaining buffer content
              if (buffer.length > 0 && currentSection) {
                 this.logger.log(`[V2 SingleChar] Emitting final buffer for section ${currentSection}`);
                 emitTextChunks(buffer);
                 subject.next(ApiResponse.success({ type: 'section_end', payload: { section: currentSection } }));
                 currentSection = null;
              } else if (buffer.length > 0) {
                 this.logger.warn(`[V2 SingleChar] Finalizing with unprocessed buffer outside section: "${buffer}"`);
              }
              // Send 'done' only if no error occurred
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
              `[V2 SingleChar] Error during raw stream generation for ${providerName}: ${err.message}`,
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
            return throwError(() => err);
          }),
        )
        .subscribe({
          next: (chunk: string) => {
            if (subject.closed) return;
            buffer += chunk;

            // Initial check for ANALYSIS_INFO marker at the very beginning
            if (!analysisInfoSent && !lookingForAnalysisJson && buffer.startsWith(MARKERS.ANALYSIS_INFO)) {
                lookingForAnalysisJson = true;
                buffer = buffer.substring(1); // Remove marker
                // Don't process buffer further yet, wait for JSON content
                processBuffer(); // Call processBuffer to handle JSON collection
                return; // Wait for more data if JSON wasn't complete
            }

            // If analysis info hasn't been sent yet, and we are not collecting JSON,
            // it means the stream didn't start correctly. Mark analysis as 'sent' to proceed.
            if (!analysisInfoSent && !lookingForAnalysisJson) {
                this.logger.error(`[V2 SingleChar] Stream did not start with ANALYSIS_INFO marker. Proceeding without analysis info.`);
                analysisInfoSent = true;
            }

            // Process buffer normally if analysis info is handled or skipped
            if (analysisInfoSent) {
                processBuffer();
            }
          },
          error: (err) => {
            // Handled by catchError
            this.logger.error('[V2 SingleChar] Raw stream subscription error:', err);
          },
          complete: () => {
            // Handled by finalize
            this.logger.log('[V2 SingleChar] Raw stream subscription completed.');
          },
        });

      // Return the subject as an Observable
      return subject.asObservable();
    } catch (error) {
      this.logger.error(
        `[V2 SingleChar] Error invoking generateRawChatStream for provider ${providerName}:`,
        error,
      );
      if (!subject.closed) {
        subject.error(error);
        subject.complete();
      }
      return throwError(
        () =>
          new HttpException(
            `[V2 SingleChar] Failed to initiate raw stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }
}
