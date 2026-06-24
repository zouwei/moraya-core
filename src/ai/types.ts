/**
 * Shared AI provider types — baselined on the Moraya desktop app, reconciled
 * with the web/mobile app. Platform-agnostic: no host/native imports, no Node
 * APIs. Transport (HTTP/SSE execution + key injection) is supplied by the
 * consumer via the `AITransport` adapter in `./transport`.
 */

/** Chat/LLM provider ids. PC's 11 + the 2 on-device ids used by web/mobile.
 *  Note: there is no `anthropic` — web migrates `anthropic` → `claude`. */
export type AIProvider =
  | 'claude'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'ollama'
  | 'grok'
  | 'mistral'
  | 'glm'
  | 'minimax'
  | 'doubao'
  | 'custom'
  | 'local-mlx'
  | 'local-llama'

export interface ImageAttachment {
  id?: string
  /** "image/jpeg", "image/png", … */
  mimeType: string
  /** base64-encoded data WITHOUT the `data:` prefix. */
  base64: string
  previewUrl?: string
  fileName?: string
}

export interface ToolCallRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
  /** Provider-specific echo-back metadata (e.g. Gemini thoughtSignature). */
  providerMeta?: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** PC sets it; optional so web can omit. */
  timestamp?: number
  images?: ImageAttachment[]
  toolCalls?: ToolCallRequest[]
  toolCallId?: string
  toolName?: string
  isError?: boolean
  isSuccess?: boolean
}

export interface AIProviderConfig {
  /** configId — used by the Tauri transport for Keychain lookup. */
  id: string
  provider: AIProvider
  /** Cloud key (web) or `'***'` sentinel / paste-override (PC). Local: unused. */
  apiKey?: string
  baseUrl?: string
  model: string
  maxTokens?: number
  temperature?: number
  topP?: number
}

export interface AIRequest {
  messages: ChatMessage[]
  stream?: boolean
  tools?: ToolDefinition[]
  /** Per-request overrides (web feature); fall back to config.* */
  model?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stop?: string[]
}

export interface AIUsage {
  inputTokens: number
  outputTokens: number
}

export interface AIResponse {
  content: string
  model: string
  usage?: AIUsage
  toolCalls?: ToolCallRequest[]
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop' | string
}

/** One event yielded by the orchestrator (NOT a raw SSE line). */
export interface AIStreamEvent {
  delta?: string
  toolCalls?: ToolCallRequest[]
  usage?: AIUsage
  stopReason?: string
  done?: boolean
}

/** Result shape kept for the PC `streamAIRequestWithTools` wrapper. */
export interface StreamToolResult {
  content: string
  toolCalls?: ToolCallRequest[]
  stopReason?: string
}
