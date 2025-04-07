import { Observable } from 'rxjs';
import { ChatMessage } from './chat-message.interface';

export interface AiChatProvider {
  /**
   * 生成流式聊天回复
   * @param messages 对话消息列表
   * @param model 指定使用的模型名称
   * @param options 可选的额外参数 (如 temperature, top_p 等)
   * @returns 返回一个包含文本块的 Observable 流
   */
  generateChatStream(
    messages: ChatMessage[],
    model: string,
    options?: Record<string, any>,
  ): Observable<string>;

  // getAvailableModels?(): Promise<string[]>;
}
