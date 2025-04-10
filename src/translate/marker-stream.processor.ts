import { Logger } from '@nestjs/common';
import { ApiResponse } from '../common/dto/api-response.dto';

// Re-define necessary types and constants here or import if shared
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

const SectionNames: Record<string, string> = {
  '[EXPLANATION_START]': 'EXPLANATION',
  '[CONTEXT_EXPLANATION_START]': 'CONTEXT_EXPLANATION',
  '[DICTIONARY_START]': 'DICTIONARY',
  '[TRANSLATION_RESULT_START]': 'TRANSLATION_RESULT',
  '[FRAGMENT_ERROR_START]': 'FRAGMENT_ERROR',
};

const EndMarkers: Record<string, string> = {
  EXPLANATION: '[EXPLANATION_END]',
  CONTEXT_EXPLANATION: '[CONTEXT_EXPLANATION_END]',
  DICTIONARY: '[DICTIONARY_END]',
  TRANSLATION_RESULT: '[TRANSLATION_RESULT_END]',
  FRAGMENT_ERROR: '[FRAGMENT_ERROR_END]',
};

const findFirstMarker = (
  text: string,
): { marker: string; index: number; isStart: boolean } | null => {
  let firstMarker: { marker: string; index: number; isStart: boolean } | null =
    null;
  const startMarkers = Object.keys(SectionNames);
  const endMarkers = Object.values(EndMarkers);
  const allMarkers = [...startMarkers, ...endMarkers];

  for (const marker of allMarkers) {
    const index = text.indexOf(marker);
    if (index !== -1) {
      if (firstMarker === null || index < firstMarker.index) {
        firstMarker = { marker, index, isStart: marker.endsWith('_START]') };
      }
    }
  }
  return firstMarker;
};

// --- Helper function to emit text in smaller chunks ---
const emitTextInChunks = (
  text: string,
  chunkSize = 3, // Send 3 characters at a time
): ApiResponse<ApiResponseV2Data>[] => {
  const events: ApiResponse<ApiResponseV2Data>[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.substring(i, i + chunkSize);
    events.push(ApiResponse.success({ type: 'text_chunk', text: chunk }));
  }
  return events;
};
// ----------------------------------------------------

export class MarkerStreamProcessor {
  private buffer = '';
  private currentSection: string | null = null;
  private readonly logger = new Logger(MarkerStreamProcessor.name);

  process(chunk: string): ApiResponse<ApiResponseV2Data>[] {
    this.buffer += chunk;
    const eventsToSend: ApiResponse<ApiResponseV2Data>[] = [];
    let continueProcessing = true;

    while (continueProcessing) {
      continueProcessing = false; // Assume loop stops unless a marker is processed
      const firstMarkerInfo = findFirstMarker(this.buffer);

      if (firstMarkerInfo) {
        const { marker, index, isStart } = firstMarkerInfo;
        const textBeforeMarker = this.buffer.substring(0, index);

        // Emit text *only* if it exists AND we are currently inside a section
        if (textBeforeMarker.length > 0 && this.currentSection) {
          // --- Emit text in chunks ---
          eventsToSend.push(...emitTextInChunks(textBeforeMarker));
          // --------------------------
        } else if (textBeforeMarker.length > 0 && !this.currentSection && textBeforeMarker.trim() !== '') {
           this.logger.warn(
             `Ignoring text found outside section: "${textBeforeMarker}"`,
           );
        }

        // Handle the marker itself (Emit section start/end events)
        if (isStart) {
          const sectionName = SectionNames[marker];
          if (sectionName) {
            if (this.currentSection) {
              this.logger.warn(
                `Starting section ${sectionName} while section ${this.currentSection} was still open. Implicitly closing previous.`,
              );
              eventsToSend.push(
                ApiResponse.success({
                  type: 'section_end',
                  payload: { section: this.currentSection },
                }),
              );
            }
            this.currentSection = sectionName;
            eventsToSend.push(
              ApiResponse.success({
                type: 'section_start',
                payload: { section: this.currentSection },
              }),
            );
          }
        } else { // END marker
          const expectedSection = Object.keys(EndMarkers).find(
            (key) => EndMarkers[key] === marker,
          );
          if (expectedSection && this.currentSection === expectedSection) {
            eventsToSend.push(
              ApiResponse.success({
                type: 'section_end',
                payload: { section: this.currentSection },
              }),
            );
            this.currentSection = null; // Section closed
          } else {
            this.logger.warn(
              `Encountered ${marker} but expected end for ${this.currentSection} or no section open. Ignoring marker.`,
            );
          }
        }

        // Remove processed text *and* the marker from buffer
        this.buffer = this.buffer.substring(index + marker.length);
        continueProcessing = true; // A marker was processed, check buffer again
      }
    } // End while loop

    return eventsToSend;
  }

  finalize(): ApiResponse<ApiResponseV2Data>[] {
    const eventsToSend: ApiResponse<ApiResponseV2Data>[] = [];
    // If there's remaining buffer content AND we were inside a section, emit it as the final text chunk(s).
    if (this.buffer.length > 0 && this.currentSection) {
      this.logger.log(
        `Emitting remaining buffer content for section ${this.currentSection} on finalize.`,
      );
      // --- Emit final text in chunks ---
      eventsToSend.push(...emitTextInChunks(this.buffer));
      // -------------------------------
      // Also close the last section implicitly
      eventsToSend.push(
        ApiResponse.success({
          type: 'section_end',
          payload: { section: this.currentSection },
        }),
      );
      this.currentSection = null;
    } else if (this.buffer.length > 0 && this.buffer.trim() !== '') {
        this.logger.warn(`Finalizing with unprocessed buffer outside section: "${this.buffer}"`);
    }
    this.buffer = ''; // Clear buffer
    return eventsToSend;
  }
}
