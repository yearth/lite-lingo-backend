/**
 * 通用 API 响应结构 DTO
 */
export class ApiResponse<T> {
  /**
   * 状态码 (例如: '0' 代表成功, 其他字符串或数字代表不同错误类型)
   * 使用 string | number 以提供灵活性
   */
  code: string | number;

  /**
   * 提示信息 (例如: 'Success', 'Error message details')
   */
  message: string;

  /**
   * 实际响应数据
   * 对于错误或无数据的成功响应，可以为 null
   */
  data: T | null;

  /**
   * 构造函数
   * @param code 状态码
   * @param message 提示信息
   * @param data 实际数据
   */
  constructor(code: string | number, message: string, data: T | null) {
    this.code = code;
    this.message = message;
    this.data = data;
  }

  /**
   * 创建一个成功的响应实例
   * @param data 成功时的数据
   * @param message 成功时的消息，默认为 'Success'
   * @param code 成功时的代码，默认为 '0'
   */
  static success<T>(
    data: T,
    message = 'Success',
    code: string | number = '0',
  ): ApiResponse<T> {
    return new ApiResponse(code, message, data);
  }

  /**
   * 创建一个失败的响应实例
   * @param message 失败时的消息
   * @param code 失败时的代码，默认为 'ERROR' 或可以传入具体错误码
   * @param data 可选的附加错误数据
   */
  static error<T = null>(
    message: string,
    code: string | number = 'ERROR',
    data: T | null = null,
  ): ApiResponse<T | null> {
    return new ApiResponse(code, message, data);
  }
}
