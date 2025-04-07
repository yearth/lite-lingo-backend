import {
  Body,
  Controller,
  MessageEvent,
  Post,
  Sse, // Import ValidationPipe for DTO validation
  UsePipes,
  ValidationPipe, // Import ValidationPipe for DTO validation
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../common/dto/api-response.dto'; // Import ApiResponse
import { StreamEventPayload } from '../common/dto/stream-event-payload.dto'; // Import StreamEventPayload
import { TranslateRequestDto } from './dto/translate-request.dto';
import { TranslateService } from './translate.service';

@Controller('translate') // Route prefix for this controller
export class TranslateController {
  constructor(private readonly translateService: TranslateService) {}

  @Post('stream') // Handles POST requests to /translate/stream
  @Sse() // Indicates this endpoint returns a Server-Sent Event stream
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true })) // Apply validation
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
}
