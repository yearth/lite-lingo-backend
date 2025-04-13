// Define the structure for the SSE events sent to the frontend in V2
export interface ApiResponseV2Data {
  type: 'text_chunk' | 'error' | 'done'; // Simplified event types
  text?: string; // For text_chunk
  payload?: any; // For error, done (e.g., { message: string } for error, { status: 'completed' | 'failed' } for done)
}
