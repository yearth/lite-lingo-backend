import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, throwError } from 'rxjs'; // Import Subject
import { catchError, finalize } from 'rxjs/operators'; // Import finalize
import { AiProviderFactory } from '../ai-provider/ai-provider.factory';
import { ChatMessage } from '../ai-provider/chat-message.interface';
import { ApiResponse } from '../common/dto/api-response.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { MarkerStreamProcessor } from './marker-stream.processor'; // Import the processor

// Define the structure for the V2 ApiResponse data (can potentially be moved to a shared DTO file)
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

// Define the structure for the analysis info payload (can potentially be moved)
interface AnalysisInfoPayload {
  inputType: 'word_or_phrase' | 'sentence' | 'fragment';
  sourceText: string;
}

@Injectable()
export class TranslateServiceV2 {
  private readonly logger = new Logger(TranslateServiceV2.name);

  constructor(private aiProviderFactory: AiProviderFactory) {}

  // Build the V2 prompt (Simplified V2.1 - unchanged)
  private buildPromptV2(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    // Define simplified markers V2.1
    const ANALYSIS_START = '[ANALYSIS_INFO_START]';
    const ANALYSIS_END = '[ANALYSIS_INFO_END]';
    const EXPLANATION_START = '[EXPLANATION_START]';
    const EXPLANATION_END = '[EXPLANATION_END]';
    const CONTEXT_START = '[CONTEXT_EXPLANATION_START]';
    const CONTEXT_END = '[CONTEXT_EXPLANATION_END]';
    const DICTIONARY_START = '[DICTIONARY_START]';
    const DICTIONARY_END = '[DICTIONARY_END]';
    const TRANS_RESULT_START = '[TRANSLATION_RESULT_START]';
    const TRANS_RESULT_END = '[TRANSLATION_RESULT_END]';
    const FRAGMENT_ERR_START = '[FRAGMENT_ERROR_START]';
    const FRAGMENT_ERR_END = '[FRAGMENT_ERROR_END]';
    // STREAM_END_MARKER is removed, backend handles 'done' event

    let promptText = `You are an expert linguistic analysis and translation assistant. Your task is to analyze the provided "Input Text" within its "Context", determine its type (word, phrase, sentence, fragment), translate it to the "Target Language", and provide additional relevant information.

You MUST respond by **streaming** natural language text, inserting specific **markers** before and after distinct sections of information. Do not include any introductory text or explanations outside the marked sections. The backend will automatically signal the end of the stream.

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Follow these steps precisely:
1.  **Immediately** start by streaming the analysis information enclosed in ${ANALYSIS_START} and ${ANALYSIS_END}. The content inside should be a single JSON object like: \`{"inputType": "...", "sourceText": "..."}\`.
2.  Based on the 'inputType', stream the corresponding sections below, ensuring each section's content is enclosed by its respective START and END markers.
3.  Stream text naturally within the markers. Do not output the markers themselves on new lines unless they are part of the natural text flow.
4.  Do **NOT** add any marker at the very end of the stream.

Marker Schemas and Order:

**A) Analysis Info (ALWAYS First):**
   ${ANALYSIS_START}
   {"inputType": "word_or_phrase" | "sentence" | "fragment", "sourceText": "{original text}"}
   ${ANALYSIS_END}

**B) If inputType is "word_or_phrase":**
   ${EXPLANATION_START}
   {Original Word/Phrase} ({General Translation})
   ${EXPLANATION_END}
   ${CONTEXT_START}
   {Explanation of the word/phrase in context, in ${targetLang}}
   ${CONTEXT_END}
   ${DICTIONARY_START}
   For EACH definition found:
   DEFINITION: ({Part of Speech}) {Definition in ${targetLang}}
   For EACH corresponding example (if available):
   EXAMPLE: (原) {Example sentence} (译) {Example translation}
   (Output each DEFINITION and EXAMPLE on a new line within this block)
   ${DICTIONARY_END}

**C) If inputType is "sentence":**
   ${TRANS_RESULT_START}
   {Sentence translation in ${targetLang}, considering context}
   ${TRANS_RESULT_END}

**D) If inputType is "fragment":**
   ${FRAGMENT_ERR_START}
   无法识别或翻译选中的片段，请尝试选择完整的单词、短语或句子。 (Source: "{original fragment}")
   ${FRAGMENT_ERR_END}

Important Rules:
- Start **immediately** with ${ANALYSIS_START}.
- Enclose **all** relevant content within the specified START and END markers.
- Inside ${DICTIONARY_START}/${DICTIONARY_END}, prefix each definition with "DEFINITION: " and each example with "EXAMPLE: ", each on its own line.
- Do **not** add any text outside the markers.
- Ensure markers are exactly as specified (e.g., \`${CONTEXT_START}\`).
- Do **NOT** output any marker after the final content block's END marker.`;

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a V2 translation stream with eventized markers using MarkerStreamProcessor.
   * @param dto - The translation request DTO.
   * @returns An Observable stream of ApiResponseV2.
   */
  generateStreamV2(
    dto: TranslateRequestDto,
  ): Observable<ApiResponse<ApiResponseV2Data>> {
    const providerName = dto.provider || 'openrouter';
    const requestedModel = dto.model;
    this.logger.log(
      `[V2 Refactored] Attempting translation for provider: ${providerName}, model: ${requestedModel || 'default'}`,
    );

    const provider = this.aiProviderFactory.getProvider(providerName);
    if (!provider) {
      this.logger.error(
        `[V2 Refactored] AI Provider "${providerName}" is not available.`,
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
        `[V2 Refactored] No model specified for ${providerName}, using default: ${finalModel}`,
      );
    }

    const messages = this.buildPromptV2(dto);

    // Use a Subject to manually control the output stream
    const subject = new Subject<ApiResponse<ApiResponseV2Data>>();
    let streamErrored = false;

    try {
      this.logger.log(
        `[V2 Refactored] Calling ${providerName} provider (raw stream) with model ${finalModel}.`,
      );
      const rawStreamFromProvider = provider.generateRawChatStream(
        messages,
        finalModel,
      );

      const processor = new MarkerStreamProcessor(); // Instantiate the processor
      let analysisInfoSent = false;
      const ANALYSIS_START_MARKER = '[ANALYSIS_INFO_START]';
      const ANALYSIS_END_MARKER = '[ANALYSIS_INFO_END]';
      let analysisBuffer = ''; // Buffer specifically for analysis info

      // Start the subscription but don't need to store the reference
      rawStreamFromProvider
        .pipe(
          finalize(() => {
            this.logger.log('[V2 Refactored] Raw stream finalized.');
            if (!subject.closed) {
              // Process any remaining buffer in the processor
              const finalEvents = processor.finalize();
              finalEvents.forEach((event) => subject.next(event));

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
              `[V2 Refactored] Error during raw stream generation for ${providerName}: ${err.message}`,
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
            if (subject.closed) return; // Don't process if downstream unsubscribed

            // 1. Handle Analysis Info Extraction Separately First
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
                  subject.next(
                    ApiResponse.success({
                      type: 'analysis_info',
                      payload: analysisPayload,
                    }),
                  );
                  analysisInfoSent = true;
                  // Process the remaining part of the buffer using the processor
                  const remainingChunk = analysisBuffer.substring(
                    endIndex + ANALYSIS_END_MARKER.length,
                  );
                  analysisBuffer = ''; // Clear analysis buffer
                  if (remainingChunk.length > 0) {
                    const events = processor.process(remainingChunk);
                    events.forEach((event) => subject.next(event));
                  }
                } catch (e) {
                  this.logger.error(
                    '[V2 Refactored] Failed to parse analysis info JSON:',
                    e,
                    `JSON String: ${jsonStr}`,
                  );
                  analysisInfoSent = true; // Skip trying again
                  // Process the entire buffer using the processor now
                  const events = processor.process(analysisBuffer);
                  events.forEach((event) => subject.next(event));
                  analysisBuffer = '';
                }
              } else if (analysisBuffer.length > 1000) {
                this.logger.warn(
                  '[V2 Refactored] Analysis info markers not found within buffer limit.',
                );
                analysisInfoSent = true; // Give up
                // Process the entire buffer using the processor
                const events = processor.process(analysisBuffer);
                events.forEach((event) => subject.next(event));
                analysisBuffer = '';
              }
              // If analysis info not yet sent/parsed, wait for more data
            } else {
              // 2. Analysis info already sent, process chunk normally
              const events = processor.process(chunk);
              events.forEach((event) => subject.next(event));
            }
          },
          error: (err) => {
            // Error is handled by catchError
            this.logger.error(
              '[V2 Refactored] Raw stream subscription error:',
              err,
            );
          },
          complete: () => {
            // Completion is handled by finalize
            this.logger.log(
              '[V2 Refactored] Raw stream subscription completed signal received.',
            );
          },
        });

      // Return the subject as an Observable
      return subject.asObservable();
    } catch (error) {
      this.logger.error(
        `[V2 Refactored] Error invoking generateRawChatStream for provider ${providerName}:`,
        error,
      );
      if (!subject.closed) {
        subject.error(error);
        subject.complete();
      }
      return throwError(
        () =>
          new HttpException(
            `[V2 Refactored] Failed to initiate raw stream with provider ${providerName}.`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          ),
      );
    }
  }
}
