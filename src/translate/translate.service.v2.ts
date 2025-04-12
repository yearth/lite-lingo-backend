import { HttpStatus, Injectable, Logger } from '@nestjs/common';
// import { Observable, Subject, throwError } from 'rxjs'; // No longer needed for Subject/throwError
// import { catchError, finalize } from 'rxjs/operators'; // No longer needed
// import { AiProviderFactory } from '../ai-provider/ai-provider.factory'; // No longer needed
import { ChatMessage } from '../ai-provider/chat-message.interface';
// import { ApiResponse } from '../common/dto/api-response.dto'; // No longer needed for this service
import { TranslateRequestDto } from './dto/translate-request.dto';
// --- Vercel AI SDK Imports ---
import { createDeepSeek } from '@ai-sdk/deepseek'; // Corrected import name
import { streamText } from 'ai'; // Use streamText instead of streamObject
import { ReadableStream, TransformStream } from 'node:stream/web'; // Use Node.js streams
// -----------------------------

// Define the structure for the V2 ApiResponse data (Frontend will receive text chunks to build this)
// This interface might become obsolete or change based on how we handle the final JSON
// interface FinalJsonResponse { ... } // Keep for reference during prompt building

// Define the structure for the SSE events sent to the frontend
// This interface is now less relevant as we format directly for Vercel's protocol
// interface ApiResponseV2Data { ... }

@Injectable()
export class TranslateServiceV2 {
  private readonly logger = new Logger(TranslateServiceV2.name);

  // Remove constructor dependency on AiProviderFactory if directly using createDeepseek
  constructor() {} // Constructor remains empty

  // Build the V2 prompt asking for a single JSON output (V2.3 - Updated for new schema)
  private buildPromptV2(dto: TranslateRequestDto): ChatMessage[] {
    const targetLang = dto.targetLanguage || 'zh-CN';
    const inputText = dto.text;
    const context = dto.context;

    let promptText = `You are an expert linguistic analysis and translation assistant. Your task is to analyze the provided "Input Text" within its "Context", determine its type (word, phrase, sentence, fragment), translate it to the "Target Language", and provide additional relevant information.

You MUST respond with a **single, complete JSON string** containing all the analysis and translation results. Do not include any introductory text, explanations, apologies, or markdown formatting outside the final JSON string. The JSON string should represent an object conforming to the structure described below, but you must output only the raw JSON string itself.

Input Text: "${inputText}"\n`;

    if (context) {
      promptText += `Context: "${context}"\n`;
    }

    promptText += `Target Language: "${targetLang}"

Generate a JSON string representing an object with the following potential structure. Omit fields that are not applicable based on the input type analysis:

Structure Description:
- analysisInfo: (object) Contains 'inputType' ('word_or_phrase', 'sentence', or 'fragment') and 'sourceText'.
- context: (object, optional) Contains 'word_translation' and 'explanation'. Only for 'word_or_phrase'.
- dictionary: (object, optional) Contains 'word', 'phonetic', and 'definitions' object. Only for 'word_or_phrase'. The 'definitions' object should contain 'definition' and 'example' keys, representing only the *first* definition found.
- translationResult: (string, optional) The translation. Only for 'sentence'.
- fragmentError: (string, optional) Error message. Only for 'fragment'.

Important Rules:
- Output **ONLY** the raw JSON string. Absolutely **NO** introductory text, explanations, apologies, or markdown formatting (like \`\`\`) before or after the JSON string.
- The output MUST start directly with the opening curly brace '{' and end directly with the closing curly brace '}'.
- Ensure the JSON string is valid.
- Provide information relevant to the analyzed 'inputType'.
  - If 'inputType' is 'sentence', the JSON string should represent an object with only 'analysisInfo' and 'translationResult'.
  - If 'inputType' is 'fragment', the JSON string should represent an object with only 'analysisInfo' and 'fragmentError'.
  - If 'inputType' is 'word_or_phrase', the JSON string should represent an object with 'analysisInfo', 'context', and 'dictionary' (if a definition/example is found). The 'dictionary.definitions' field MUST be an object containing only the first definition and example, not an array. Do not include 'translationResult' or 'fragmentError'.
- All explanations and definitions within the JSON string should be in the target language: ${targetLang}.`;

    return [{ role: 'user', content: promptText }];
  }

  /**
   * Generates a V2 translation stream using Vercel AI SDK and streamObject,
   * formatted according to Vercel's SSE protocol.
   * @param dto - The translation request DTO.
   * @returns A ReadableStream<string> formatted for SSE.
   */
  async generateStreamV2(dto: TranslateRequestDto): Promise<ReadableStream<string>> {
    // --- Provider Setup ---
    // Assuming DEEPSEEK_API_KEY is set in environment variables
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekApiKey) {
      this.logger.error('[V2 Vercel SDK] DEEPSEEK_API_KEY environment variable is not set.');
      // Return error stream immediately
      const errorPayload = { code: HttpStatus.SERVICE_UNAVAILABLE, msg: 'DeepSeek API key not configured.' };
      const errorSse = `data: ${JSON.stringify(errorPayload)}\n\n`;
      return new ReadableStream<string>({ // Ensure it returns a string stream
        start(controller) {
          controller.enqueue(errorSse); // Enqueue the string directly
          controller.close();
        },
      });
    }

    const deepseek = createDeepSeek({ apiKey: deepseekApiKey }); // Corrected function name
    const modelName = dto.model || 'deepseek-chat'; // Use requested or default
    this.logger.log(
      `[V2 Vercel SDK] Attempting translation with DeepSeek model: ${modelName}`,
    );
    const model = deepseek(modelName);
    // --------------------

    const messages = this.buildPromptV2(dto);

    try {
      this.logger.log(`[V2 Vercel SDK] Calling streamText with model ${modelName}.`);

      const result = await streamText({ // Use streamText
        model: model,
        // schema: TranslationResultSchema, // Schema not used with streamText
        prompt: messages[0].content, // Assuming single user message for simplicity
        // messages: messages, // Alternatively pass the full array if needed
      });

      // --- SSE Formatting Stream ---
      // const data = new StreamData(); // Vercel AI SDK helper - Deprecated and not used here

      // Append final message (optional, can be handled by [DONE])
      // data.append({ message: 'Stream completed successfully' });

      // Pipe the text stream through a transformer to format SSE messages
      // Explicitly cast the input stream type for pipeThrough
      const sseStream: ReadableStream<string> = (result.textStream as ReadableStream<string>).pipeThrough(
        new TransformStream({ // Keep TS inference for the TransformStream itself
          transform(chunk: string, controller) { // Chunk is now a string fragment
            // Format according to Vercel AI SDK protocol (or your desired format)
            const payload = {
              code: 0,
              msg: '',
              data: {
                type: 'text', // Vercel's type for text chunks
                model: modelName,
                text: chunk, // Send the raw text chunk
              },
            };
            controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
          },
          flush(controller) {
             // Send the [DONE] marker at the end of the stream
             controller.enqueue(`data: [DONE]\n\n`);
             // data.close(); // No longer needed as StreamData is removed
          }
        }),
      );
      // -----------------------------

      // Return the formatted SSE stream
      return sseStream; // Return the raw transformed stream

    } catch (error) {
      this.logger.error(
        `[V2 Vercel SDK] Error during streamObject generation: ${error.message}`,
        error.stack,
      );

      // --- Error SSE Formatting ---
      // Determine error code (e.g., based on error type)
      const errorCode = error.status || HttpStatus.INTERNAL_SERVER_ERROR; // Example
      const errorMessage = error.message || 'AI stream generation failed.';
      const errorPayload = {
        code: errorCode,
        msg: errorMessage,
      };
      const errorSse = `data: ${JSON.stringify(errorPayload)}\n\n`;

      // Return a stream that emits only the error message string
      const errorStream = new ReadableStream<string>({
        start(controller) {
          controller.enqueue(errorSse); // Enqueue the string directly
          controller.close();
        },
      });
      return errorStream;
      // -----------------------------

      // Or rethrow if Controller should handle HTTP exception
      // throw new HttpException(
      //   `[V2 Vercel SDK] Failed to initiate stream with DeepSeek. ${error.message}`,
      //   HttpStatus.INTERNAL_SERVER_ERROR,
      // );
    }
  }
}
