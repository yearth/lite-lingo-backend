import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response.dto';

/**
 * 全局响应拦截器，用于将成功的控制器返回值包装在 ApiResponse 结构中。
 * 它通过检查响应头 Content-Type 是否为 'text/event-stream' 来跳过 SSE 端点。
 */
@Injectable() // 返回类型可能是原始类型 T (对于 SSE) 或包装后的 ApiResponse<T>
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | T> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse();

    // 检查 Content-Type 是否为 'text/event-stream'
    // 这是由 @Sse() 装饰器设置的，可以可靠地识别 SSE 端点
    if (response.getHeader('Content-Type') === 'text/event-stream') {
      // 如果是 SSE 流，则直接传递，不进行包装
      return next.handle();
    }

    // 对于非 SSE 响应，包装在 ApiResponse 中
    return next.handle().pipe(
      map((data) => {
        // 如果控制器已经返回了 ApiResponse 实例，则直接返回，避免重复包装
        if (data instanceof ApiResponse) {
          return data;
        }
        // 否则，使用静态方法创建成功的 ApiResponse
        // 假设 '0' 代表成功代码
        return ApiResponse.success(data, 'Success', '0');
      }),
      // 注意：错误处理由 HttpExceptionFilter 负责，这里不处理错误
    );
  }
}
