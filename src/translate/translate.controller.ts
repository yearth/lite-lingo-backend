import {
  Body,
  Controller,
  MessageEvent,
  Post,
  Sse,
  UsePipes,
  ValidationPipe,
  Version, // Import Version decorator
} from '@nestjs/common';
import { Observable } from 'rxjs'; // Import 'of' for creating simple observable
import { map } from 'rxjs/operators';
import { ApiResponse } from '../common/dto/api-response.dto';
import { StreamEventPayload } from '../common/dto/stream-event-payload.dto'; // Import StreamEventPayload
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
  @Post('stream')
  @Sse()
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @Version('2') // Specify this method handles version 2
  streamTranslationV2(
    @Body() translateRequestDto: TranslateRequestDto,
  ): Observable<MessageEvent> {
    // Call the V2 service method
    return this.translateServiceV2.generateStreamV2(translateRequestDto).pipe(
      map((apiResponse): MessageEvent => {
        // Serialize the ApiResponseV2 object
        return { data: JSON.stringify(apiResponse) };
      }),
    );
  }
  // -----------------------
}
