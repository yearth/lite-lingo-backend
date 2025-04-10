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

        // Emit text before the marker if it exists and we are inside a section
        if (textBeforeMarker.length > 0) {
          if (this.currentSection) {
            eventsToSend.push(
              ApiResponse.success({
                type: 'text_chunk',
                text: textBeforeMarker,
              }),
            );
          } else if (textBeforeMarker.trim() !== '') {
            // Text outside any section - log warning?
            this.logger.warn(
              `Text found outside section: "${textBeforeMarker}"`,
            );
          }
        }

        // Handle the marker itself
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
              `Encountered ${marker} but expected end for ${this.currentSection} or no section open.`,
            );
            // Ignore unexpected end marker?
          }
        }

        // Remove processed text and marker from buffer
        this.buffer = this.buffer.substring(index + marker.length);
        continueProcessing = true; // A marker was processed, loop again to check the rest of the buffer
      }
    } // End while loop

    // IMPORTANT: Do NOT emit remaining buffer here.
    // It might contain partial markers or text that belongs to the next chunk.
    // Only emit text *before* a detected marker within the loop.
    // The finalize method will handle any truly remaining text at the very end.

    return eventsToSend;
  }

  finalize(): ApiResponse<ApiResponseV2Data>[] {
    const eventsToSend: ApiResponse<ApiResponseV2Data>[] = [];
    // Process any final remaining buffer content as text if a section is open
    if (this.buffer.length > 0 && this.currentSection) {
      this.logger.warn(
        `Emitting remaining buffer content for section ${this.currentSection} on finalize.`,
      );
      eventsToSend.push(
        ApiResponse.success({ type: 'text_chunk', text: this.buffer }),
      );
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
