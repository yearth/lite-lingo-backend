# 翻译接口文档 (`/translate`)

本文档描述了用于文本翻译的 API 端点。

## 流式翻译 (`/translate/stream`)

该端点提供基于 Server-Sent Events (SSE) 的流式翻译和分析功能。后端会代理 AI 服务生成的 JSON Lines 流，并将其包装在标准的 `ApiResponse` 结构中发送。

- **URL**: `/translate/stream`
- **Method**: `POST`
- **Content-Type**: `application/json` (请求体)
- **Accept**: `text/event-stream` (客户端期望的响应类型)

### 请求体 (Request Body)

请求体应为一个 JSON 对象，包含以下字段：

```typescript
interface TranslateRequestDto {
  /**
   * 需要翻译的文本 (必填)
   * @example "hello world"
   */
  text: string;

  /**
   * 可选的上下文信息，有助于提高翻译准确性
   * @example "This is a greeting."
   */
  context?: string;

  /**
   * 目标语言代码 (可选, 默认为 'zh-CN')
   * @example "fr" (法语), "es" (西班牙语)
   */
  targetLanguage?: string;

  /**
   * 源语言代码 (可选, AI 通常会自动检测)
   * @example "en" (英语)
   */
  sourceLanguage?: string;

  /**
   * 指定使用的 AI 服务提供商 (可选, 默认为 'openrouter')
   * 可选值: 'openrouter', 'deepseek'
   */
  provider?: string;

  /**
   * 指定使用的具体 AI 模型名称 (可选, 不提供则使用对应 provider 的默认模型)
   * @example "deepseek-chat", "openai/gpt-4o-mini" (OpenRouter 模型标识)
   */
  model?: string;
}
```

**示例请求体:**

```json
{
  "text": "Manage API keys",
  "context": "User settings page description",
  "targetLanguage": "zh-CN",
  "provider": "openrouter",
  "model": "openai/gpt-4o-mini"
}
```

### 响应 (Response)

响应是一个 Server-Sent Events (SSE) 流。每个事件都遵循以下格式：

```
data: <JSON_String>\n\n
```

其中 `<JSON_String>` 是一个 JSON 字符串，解析后得到一个 `ApiResponse` 对象。

**`ApiResponse` 结构:**

```typescript
interface ApiResponse<T = StreamEventPayload<any>> {
  /**
   * 状态码:
   * - '0': 成功事件 (data 字段包含一个 StreamEventPayload)
   * - 'FRAGMENT_ERROR': AI 识别输入为片段 (data 字段包含 fragment_error 类型的 StreamEventPayload)
   * - 'AI_JSON_PARSE_ERROR': 后端解析 AI 输出的某行 JSON 失败 (data 字段包含 parsing_error 类型的 StreamEventPayload)
   * - 'STREAM_GENERATION_ERROR': 调用 AI Provider 或处理流时发生错误 (data 字段包含 error 类型的 StreamEventPayload)
   * - 其他 HTTP 错误码 ('400', '500', etc.): 由全局 Filter 捕获的请求错误 (data 字段可能包含错误详情或为 null)
   */
  code: string | number;

  /**
   * 提示信息:
   * - 成功事件通常为空字符串 '' 或 'Stream ended' / 'Stream ended with error' (对于 done 事件)
   * - 错误事件包含错误描述
   */
  message: string;

  /**
   * 实际数据负载 (通常是 StreamEventPayload):
   * 包含了来自 AI 的具体事件信息 (type 和 payload) 或错误详情。
   */
  data: T;
}
```

`ApiResponse` 中的 `data` 字段通常包含一个 `StreamEventPayload` 对象，其结构如下：

**`StreamEventPayload` 结构:**

```typescript
interface StreamEventPayload<P = any> {
  /**
   * 事件类型 (由 AI 生成或后端添加):
   * - 'analysis_info': 包含输入类型分析结果 (如 inputType: 'word_or_phrase')
   * - 'context_explanation': 包含单词/短语在上下文中的解释
   * - 'dictionary_start': 词典条目开始，包含单词、翻译、音标
   * - 'definition': 包含一个词性 + 释义
   * - 'example': 包含一个例句 (原文+译文)
   * - 'dictionary_end': 词典条目结束
   * - 'translation_result': 包含句子/短语的主要翻译
   * - 'fragment_error': AI 识别输入为片段时的错误信息 (由 AI 生成)
   * - 'parsing_error': 后端解析 AI JSON 行失败时的错误信息
   * - 'error': 通用流处理错误信息 (由后端 catchError 生成)
   * - 'done': 整个流结束信号 (由 AI 生成，或由后端在错误时生成)
   */
  type: string;

  /**
   * 事件的具体数据负载，结构取决于 type。
   * 例如:
   * - type: 'context_explanation' => payload: { text: string }
   * - type: 'definition' => payload: { pos: string, def: string }
   * - type: 'done' => payload: { status: 'completed' | 'failed' }
   * - type: 'fragment_error' => payload: { message: string, sourceText: string }
   * - type: 'parsing_error' => payload: { message: string, line?: string, buffer?: string }
   */
  payload: P;
}
```

### 响应事件示例 (JSON Lines 模式)

前端会接收到一系列 `ApiResponse` 事件。以下是解析 `event.data` 后得到的 `ApiResponse` 对象示例：

1.  **分析信息**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": {
        "type": "analysis_info",
        "payload": { "inputType": "word_or_phrase", "sourceText": "Manage" }
      }
    }
    ```
2.  **上下文解释**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": {
        "type": "context_explanation",
        "payload": {
          "text": "在这个上下文中，'Manage' 表示对 API 密钥的使用和控制..."
        }
      }
    }
    ```
3.  **词典开始**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": {
        "type": "dictionary_start",
        "payload": {
          "word": "Manage",
          "translation": "管理",
          "phonetic": "/ˈmænɪdʒ/"
        }
      }
    }
    ```
4.  **释义**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": {
        "type": "definition",
        "payload": {
          "pos": "动词",
          "def": "控制、组织或监督某事物以确保其正常运作。"
        }
      }
    }
    ```
5.  **例句**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": {
        "type": "example",
        "payload": {
          "original": "He needs to manage his time better.",
          "translation": "他需要更好地管理自己的时间。"
        }
      }
    }
    ```
6.  **词典结束**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": { "type": "dictionary_end" }
    }
    ```
7.  **句子翻译**:
    ```json
    {
      "code": "0",
      "message": "",
      "data": {
        "type": "translation_result",
        "payload": { "text": "管理您的 API 密钥以访问 OpenRouter 的所有模型。" }
      }
    }
    ```
8.  **片段错误 (由 AI 识别)**:
    ```json
    {
      "code": "FRAGMENT_ERROR",
      "message": "无法识别或翻译选中的片段...", // 来自 AI 的 message
      "data": {
        "type": "fragment_error",
        "payload": {
          "message": "无法识别或翻译选中的片段...",
          "sourceText": "lities, I can handle..."
        }
      }
    }
    ```
9.  **解析错误 (由后端 Provider 发现)**:
    ```json
    {
      "code": "AI_JSON_PARSE_ERROR",
      "message": "Failed to parse AI response line.",
      "data": {
        "type": "parsing_error",
        "payload": {
          "message": "Failed to parse AI response line.",
          "line": "{invalid json..." // 出错的行
        }
      }
    }
    ```
10. **流处理错误 (由后端 Service 发现)**:
    ```json
    {
      "code": "STREAM_GENERATION_ERROR",
      "message": "AI provider timeout", // 原始错误信息
      "data": {
        "type": "error",
        "payload": {
          "message": "AI provider timeout"
        }
      }
    }
    ```
11. **结束信号 (成功)**:
    ```json
    {
      "code": "0",
      "message": "Stream ended",
      "data": { "type": "done", "payload": { "status": "completed" } }
    }
    ```
12. **结束信号 (失败)**: (通常在 `FRAGMENT_ERROR`, `AI_JSON_PARSE_ERROR`, `STREAM_GENERATION_ERROR` 等错误后发送)
    ```json
    {
      "code": "0", // 注意：'done' 事件本身是成功的，但 payload 指示了状态
      "message": "Stream ended with error", // 或 "Stream ended with fragment error"
      "data": { "type": "done", "payload": { "status": "failed" } }
    }
    ```

### 前端调用示例 (使用 `EventSource` - 处理 JSON Lines)

```javascript
const requestBody = {
  text: 'Manage',
  context: 'Manage your API keys to access all models from OpenRouter',
  targetLanguage: 'zh-CN',
};

const eventSource = new EventSourcePolyfill('/api/translate/stream', {
  // 使用 polyfill 或原生 EventSource
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // Add any necessary auth headers here
  },
  body: JSON.stringify(requestBody),
});

// --- UI State Management ---
let currentDictionaryEntry = null; // To hold dictionary data between events
let uiElements = {
  // References to UI elements
  contextExplanation: document.getElementById('context-explanation-area'),
  dictionaryArea: document.getElementById('dictionary-area'),
  mainTranslation: document.getElementById('main-translation-area'),
  errorMessage: document.getElementById('error-message-area'),
  loadingIndicator: document.getElementById('loading-indicator'),
};
// Clear previous results
clearUI();
showLoading(true);
// -------------------------

eventSource.onmessage = (event) => {
  try {
    const apiResponse = JSON.parse(event.data);

    console.log('Received ApiResponse:', apiResponse);

    // Process based on the event type within apiResponse.data
    if (apiResponse.data && apiResponse.data.type) {
      const streamEvent = apiResponse.data; // This is the StreamEventPayload
      const payload = streamEvent.payload;

      // Handle potential top-level errors indicated by code first
      if (apiResponse.code !== '0') {
        console.error(
          `Error from server: [${apiResponse.code}] ${apiResponse.message}`,
          payload,
        );
        // Display error based on payload type or message
        if (
          streamEvent.type === 'fragment_error' ||
          streamEvent.type === 'parsing_error' ||
          streamEvent.type === 'error'
        ) {
          displayErrorMessage(payload.message || apiResponse.message);
        } else {
          displayErrorMessage(
            `错误 [${apiResponse.code}]: ${apiResponse.message}`,
          );
        }
        // Don't close yet, wait for 'done' with status 'failed'
        return;
      }

      // Process successful events (code === '0')
      switch (streamEvent.type) {
        case 'analysis_info':
          console.log('Analysis:', payload);
          // Optionally display inputType or sourceText
          break;

        case 'context_explanation':
          console.log('Context Explanation:', payload.text);
          updateUI(uiElements.contextExplanation, payload.text);
          break;

        case 'dictionary_start':
          console.log('Dictionary Start:', payload);
          currentDictionaryEntry = {
            // Initialize dictionary data
            word: payload.word,
            translation: payload.translation,
            phonetic: payload.phonetic,
            definitions: [],
          };
          renderDictionaryHeader(currentDictionaryEntry); // Render header part
          showElement(uiElements.dictionaryArea);
          break;

        case 'definition':
          if (currentDictionaryEntry) {
            console.log('Definition:', payload);
            currentDictionaryEntry.definitions.push({
              pos: payload.pos,
              def: payload.def,
              examples: [], // Prepare for examples
            });
            renderLastDefinition(currentDictionaryEntry); // Render this definition
          }
          break;

        case 'example':
          if (
            currentDictionaryEntry &&
            currentDictionaryEntry.definitions.length > 0
          ) {
            console.log('Example:', payload);
            const lastDef =
              currentDictionaryEntry.definitions[
                currentDictionaryEntry.definitions.length - 1
              ];
            if (lastDef) {
              lastDef.examples = lastDef.examples || [];
              lastDef.examples.push(payload);
              renderLastExample(currentDictionaryEntry); // Render this example
            }
          }
          break;

        case 'dictionary_end':
          console.log('Dictionary End');
          currentDictionaryEntry = null; // Reset state
          break;

        case 'translation_result':
          console.log('Translation Result:', payload.text);
          updateUI(uiElements.mainTranslation, payload.text);
          break;

        // Error types handled by checking apiResponse.code !== '0' above,
        // but we might log them here again if needed.
        case 'fragment_error':
        case 'parsing_error':
        case 'error':
          console.warn(
            `Received error event type ${streamEvent.type} within successful ApiResponse (code=0), might indicate backend issue.`,
          );
          break;

        case 'done':
          console.log('Stream finished:', payload.status);
          showLoading(false);
          eventSource.close(); // Close the connection
          if (payload.status === 'failed') {
            // Ensure an error message is displayed if not already shown by earlier error events
            if (!uiElements.errorMessage.innerText) {
              displayErrorMessage('翻译过程出错。');
            }
          }
          break;

        default:
          console.warn('Received unknown event type:', streamEvent.type);
      }
    } else if (apiResponse.code !== '0') {
      // Handle cases where error response might not have 'data' or 'data.type'
      console.error(
        `Error from server: [${apiResponse.code}] ${apiResponse.message}`,
      );
      displayErrorMessage(`错误 [${apiResponse.code}]: ${apiResponse.message}`);
    }
  } catch (error) {
    console.error('Error parsing SSE data:', error, event.data);
    displayErrorMessage('解析服务器响应时出错。');
    showLoading(false);
    if (eventSource && eventSource.readyState !== EventSource.CLOSED) {
      eventSource.close(); // Close on parsing error
    }
  }
};

eventSource.onerror = (error) => {
  console.error('EventSource failed:', error);
  displayErrorMessage('无法连接到翻译服务或连接中断。');
  showLoading(false);
  // Connection errors close the EventSource automatically
};

// --- Helper UI Functions (Example Implementations - Same as before) ---
function clearUI() {
  uiElements.contextExplanation.innerText = '';
  uiElements.dictionaryArea.innerHTML = ''; // Clear complex area
  uiElements.mainTranslation.innerText = '';
  uiElements.errorMessage.innerText = '';
  hideElement(uiElements.dictionaryArea);
  hideElement(uiElements.errorMessage);
}

function showLoading(isLoading) {
  if (isLoading) {
    showElement(uiElements.loadingIndicator);
  } else {
    hideElement(uiElements.loadingIndicator);
  }
}

function displayErrorMessage(message) {
  uiElements.errorMessage.innerText = message;
  showElement(uiElements.errorMessage);
}

function updateUI(element, text) {
  if (element) {
    element.innerText = text;
    showElement(element);
  }
}

function showElement(element) {
  if (element) element.style.display = ''; // Or 'block', 'flex', etc.
}

function hideElement(element) {
  if (element) element.style.display = 'none';
}

function renderDictionaryHeader(entry) {
  const header = document.createElement('div');
  header.innerHTML = `<h3>${entry.word}</h3> <span class="phonetic">${entry.phonetic || ''}</span> <span class="translation">(${entry.translation})</span>`;
  uiElements.dictionaryArea.appendChild(header);
}

function renderLastDefinition(entry) {
  const def = entry.definitions[entry.definitions.length - 1];
  const defBlock = document.createElement('div');
  defBlock.className = 'definition-block';
  defBlock.innerHTML = `<span class="pos">${def.pos}</span> <span class="def">${def.def}</span>`;
  uiElements.dictionaryArea.appendChild(defBlock);
}

function renderLastExample(entry) {
  const defBlock = uiElements.dictionaryArea.querySelector(
    '.definition-block:last-child',
  );
  if (defBlock) {
    const example =
      entry.definitions[entry.definitions.length - 1].examples.slice(-1)[0];
    const exBlock = document.createElement('div');
    exBlock.className = 'example-block';
    exBlock.innerHTML = `<span class="orig">例: ${example.original}</span> <span class="trans">${example.translation}</span>`;
    defBlock.appendChild(exBlock);
  }
}
// --------------------------------------------------
```

_(注意: 上述前端示例依赖 `event-source-polyfill` 库，并包含基本的 UI 更新逻辑，实际实现需要根据您的前端框架和 UI 结构进行调整。)_
