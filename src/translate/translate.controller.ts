// Remove MessageEvent, Observable, map, ApiResponse, StreamEventPayload imports for V1
// Keep Res, Response for manual SSE handling
import {
  Body,
  Controller,
  Post,
  Res, // Keep for manual SSE
  UsePipes,
  ValidationPipe,
  Version,
} from '@nestjs/common';
import { Response } from 'express'; // Keep for manual SSE
// ApiResponseV2Data is no longer needed here as the V2 stream emits strings
// import { ApiResponseV2Data } from './dto/api-response-v2-data.dto';
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslateService } from './translate.service';
// Removed TranslateServiceV2 import

@Controller('translate') // Route prefix for this controller
export class TranslateController {
  constructor(
    private readonly translateService: TranslateService, // Inject V1 Service
    // Removed TranslateServiceV2 injection
  ) {}

  // --- Simplified V1 Endpoint ---
  @Post('stream')
  // @Sse() // Remove Sse decorator, handle manually
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Version('1') // Keep versioning for now
  streamTranslation( // Change return type to void
    @Body() translateRequestDto: TranslateRequestDto,
    @Res() res: Response, // Inject Response object
  ): void { // Return void
    // Set SSE headers manually
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none');
    res.flushHeaders();

    // Call the modified V1 service method which returns Observable<string>
    const streamObservable = this.translateService.generateStream(
      translateRequestDto,
    );

    // Subscribe to the raw string stream and write to response
    const subscription = streamObservable.subscribe({
      next: (chunk: string) => {
        // Format the raw string chunk as an SSE event
        res.write(`data: ${chunk}\n\n`);
      },
      error: (error) => {
        console.error('Error streaming translation V1:', error);
        // Try to send error marker if possible
        if (!res.headersSent) {
           res.status(500).json({ message: 'Stream error', error: error.message });
        } else {
          try {
            res.write(`data: [ERROR]\n\n`);
          } catch (writeError) {
             console.error("Error writing SSE '[ERROR]' marker:", writeError);
          } finally {
             res.end();
          }
        }
      },
      complete: () => {
        // Stream finished successfully (should receive [DONE] via next), close connection
        res.end();
      },
    });

    // Handle client disconnect
    res.on('close', () => {
      console.log('Client disconnected V1, unsubscribing.');
      subscription.unsubscribe();
    });
  }

  // --- Removed V2 Endpoint ---
}
