/**
 * @moraya/core/ai — shared, platform-agnostic AI provider layer.
 *
 * Consumers supply an `AITransport` (desktop: Tauri Rust proxy; web/mobile:
 * direct fetch) and call `streamChat` / `sendChat`. Provider catalog, request
 * building, and response/SSE/tool parsing are shared here.
 *
 * Phase 1 covers chat/LLM. Image / voice-STT / realtime follow the same
 * driver+transport pattern (realtime adds a WebSocket transport variant).
 */
export * from './types'
export * from './catalog'
export * from './transport'
export { streamChat, sendChat } from './chat'
export { getDriver } from './drivers'
export type { AIDriver, StreamFold } from './drivers/types'
export {
  formatToolsForProvider,
  parseClaudeToolCalls,
  parseOpenAIToolCalls,
  parseGeminiToolCalls,
  buildClaudeToolResultMessages,
  buildOpenAIToolResultMessages,
} from './drivers/tool-bridge'
export { openaiEndpoint } from './drivers/util'
