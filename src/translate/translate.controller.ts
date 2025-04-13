import {
  Body,
  Controller,
  MessageEvent, // Restore for V1
  Post,
  Res, // Keep for V2
  Sse, // Restore for V1
  UsePipes,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import { Response } from 'express'; // Keep for V2
import { Observable } from 'rxjs'; // Restore for V1
import { map } from 'rxjs/operators'; // Restore for V1
import { ApiResponse } from '../common/dto/api-response.dto'; // Restore for V1 & Keep for V2 (used in V1)
import { StreamEventPayload } from '../common/dto/stream-event-payload.dto'; // Restore for V1
// ApiResponseV2Data is no longer needed here as the V2 stream emits strings
// import { ApiResponseV2Data } from './dto/api-response-v2-data.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslateService } from './translate.service';
import { TranslateServiceV2 } from './translate.service.v2'; // Import V2 Service

@Controller('translate') // Route prefix for this controller
export class TranslateController {
  constructor(
    private readonly translateService: TranslateService, // Inject V1 Service
    private readonly translateServiceV2: TranslateServiceV2, // Inject V2 Service
  ) {}

  @Post('stream')
  @Sse()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Version('1') // Specify this method handles version 1
  streamTranslation(
    @Body() translateRequestDto: TranslateRequestDto,
  ): Observable<MessageEvent> {
    // Pass the entire DTO to the service method
    // Service now returns Observable<ApiResponse<StreamEventPayload<any> | null>>
    return this.translateService.generateStream(translateRequestDto).pipe(
      map(
        (
          apiResponse: ApiResponse<StreamEventPayload<any> | null>,
        ): MessageEvent => {
          // Serialize the entire ApiResponse object into the data field
          return { data: JSON.stringify(apiResponse) };
        },
      ),
    );
  }

  // --- Add V2 Endpoint ---
  @Post('stream') // Keep the route
  // @Sse() // Remove Sse decorator
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Version('2')
  streamTranslationV2( // No longer async, returns void implicitly
    @Body() translateRequestDto: TranslateRequestDto,
    @Res() res: Response, // Inject Response object
  ): void { // Return void as we handle the response directly via subscription
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none'); // Important to prevent compression
    res.flushHeaders(); // Send headers immediately

    // Call the V2 service method which returns an Observable
    const streamObservable = this.translateServiceV2.generateStreamV2(
      translateRequestDto,
    );

    // Subscribe to the Observable (which now emits strings) to handle SSE events
    const subscription = streamObservable.subscribe({
      next: (dataChunk: string) => {
        // Format the raw string data (chunk or marker) as an SSE event
        res.write(`data: ${dataChunk}\n\n`);
      },
      error: (error) => {
        // Handle errors from the Observable stream
        console.error('Error streaming translation V2:', error);
        // Check if headers have already been sent
        if (!res.headersSent) {
          // If not sent, send a standard HTTP error response
          res.status(500).json({
            statusCode: 500,
            message: 'Error generating translation stream.',
            error: error.message || 'Internal Server Error',
          });
          // No need to call res.end() here as .json() does it.
        } else {
          // If headers are sent, the SSE stream is active.
          // Try to send the '[ERROR]' marker event (best effort) and then close.
          try {
            res.write(`data: [ERROR]\n\n`);
          } catch (writeError) {
            console.error("Error writing SSE '[ERROR]' marker:", writeError);
          } finally {
             res.end(); // End the response regardless
          }
        }
      },
      complete: () => {
        // Stream finished successfully, close the connection
        res.end();
      },
    });

    // Handle client disconnects (optional but recommended)
    res.on('close', () => {
      console.log('Client disconnected, unsubscribing from translation stream.');
      subscription.unsubscribe(); // Clean up the subscription
    });
  }
}
