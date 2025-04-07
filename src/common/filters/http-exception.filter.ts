import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger, // Import Logger
} from '@nestjs/common';
import { Response } from 'express'; // Import Request if needed later
import { ApiResponse } from '../dto/api-response.dto';
import { StreamEventPayload } from '../dto/stream-event-payload.dto';

/**
 * 全局异常过滤器，用于捕获所有未处理的异常（特别是 HttpException），
 * 并将其格式化为标准的 ApiResponse 结构。
 * 对 SSE 流进行特殊处理，发送错误事件而不是 JSON 响应。
 */
@Catch() // 捕获所有异常，可以根据需要细化，例如 @Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name); // Instantiate Logger

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    // const request = ctx.getRequest<Request>(); // Keep for potential future use

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: string | number = '500'; // Default error code
    let errorDetails: any = null; // To hold potential extra error details

    this.logger.error(
      // Log the raw exception
      `Caught exception: ${exception instanceof Error ? exception.message : JSON.stringify(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      code = status.toString(); // Use HTTP status as code by default for HttpExceptions

      if (typeof errorResponse === 'string') {
        message = errorResponse;
      } else if (typeof errorResponse === 'object' && errorResponse !== null) {
        // NestJS validation pipe errors often have 'message' as an array
        message = Array.isArray((errorResponse as any).message)
          ? (errorResponse as any).message.join(', ')
          : (errorResponse as any).message || exception.message;
        // You might want to assign the whole errorResponse to details
        errorDetails = errorResponse;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      // Handle generic errors
      message = exception.message;
      code = 'UNKNOWN_ERROR'; // Custom code for non-HTTP errors
      errorDetails = { name: exception.name, message: exception.message }; // Include basic error info
    }
    // Add more specific error type checks if needed (e.g., PrismaClientKnownRequestError)

    // Check if it's an SSE request
    if (response.getHeader('Content-Type') === 'text/event-stream') {
      this.logger.warn(
        `Sending error event to SSE stream: ${message} (Code: ${code})`,
      );
      // For SSE, send a structured error event within the ApiResponse wrapper
      const errorPayload: StreamEventPayload<{
        message: string;
        details?: any;
      }> = {
        type: 'error',
        payload: { message, details: errorDetails },
      };
      const errorEvent = new ApiResponse(code, message, errorPayload);

      // Write the event data
      response.write(`data: ${JSON.stringify(errorEvent)}\n\n`);

      // Optionally send a 'done' event immediately after error? Or just end?
      // const donePayload: StreamEventPayload<{ status: string }> = { type: 'done', payload: { status: 'failed' } };
      // const doneEvent = new ApiResponse('0', 'Stream ended due to error', donePayload);
      // response.write(`data: ${JSON.stringify(doneEvent)}\n\n`);

      // End the stream after sending the error event
      response.end();
      return; // Stop further processing
    }

    // For regular HTTP requests, send a standard JSON error response
    this.logger.warn(
      `Sending HTTP error response: ${status} ${message} (Code: ${code})`,
    );
    response.status(status).json(new ApiResponse(code, message, errorDetails)); // Include details in data for non-SSE errors
  }
}
