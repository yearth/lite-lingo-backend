import { Observable } from 'rxjs';
import { StreamEventPayload } from '../common/dto/stream-event-payload.dto'; // Import the new type
import { ChatMessage } from './chat-message.interface';

export interface AiChatProvider {
  /**
   * 生成流式聊天回复
   * @param messages 对话消息列表
   * @param model 指定使用的模型名称
   * @param options 可选的额外参数 (如 temperature, top_p 等)
   * @returns 返回一个包含结构化事件 (StreamEventPayload) 的 Observable 流
   */
  generateChatStream(
    messages: ChatMessage[],
    model: string,
    options?: Record<string, any>,
  ): Observable<StreamEventPayload<any>>; // Changed return type

  // getAvailableModels?(): Promise<string[]>;
}
