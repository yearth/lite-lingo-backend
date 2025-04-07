/**
 * SSE 流中 data 字段内部使用的事件负载结构
 */
export interface StreamEventPayload<P = any> {
  /**
   * 事件类型
   * 例如: 'text_chunk', 'dictionary_entry', 'translation_info', 'error', 'done'
   */
  type: string;

  /**
   * 事件的具体数据负载
   * 其结构取决于 type
   */
  payload: P;
}

// 可以为特定类型定义更具体的 Payload 接口，如果需要强类型检查
// 例如:
// export interface TextChunkPayload { text: string; }
// export interface DonePayload { status: 'completed' | 'failed'; }
// export interface ErrorPayload { message: string; code?: string | number; }
