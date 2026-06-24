import type { AIResponse, ChatMessage, ToolCallRequest } from '../types'
import type { TransportRequest } from '../transport'
import type { AIDriver } from './types'
import { formatToolsForProvider } from './tool-bridge'
import { resolveBaseUrl, NOOP_FOLD } from './util'

function buildOllamaMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    } else if (msg.role === 'tool') {
      return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content }
    }
    const result: Record<string, unknown> = { role: msg.role, content: msg.content }
    if (msg.role === 'user' && msg.images && msg.images.length > 0) result.images = msg.images.map(img => img.base64)
    return result
  })
}

/** Ollama uses its native /api/chat. PC always calls it non-streaming, so the
 *  orchestrator one-shots it (supportsStreaming=false). */
export const ollamaDriver: AIDriver = {
  supportsStreaming: false,

  buildChatRequest(config, request, _stream): TransportRequest {
    const baseUrl = resolveBaseUrl(config, 'http://localhost:11434')
    const body: Record<string, unknown> = {
      model: request.model || config.model,
      messages: buildOllamaMessages(request.messages),
      stream: false,
      options: {
        temperature: request.temperature ?? config.temperature ?? 0.7,
        num_predict: request.maxTokens ?? config.maxTokens ?? 41920,
      },
    }
    if (request.tools && request.tools.length > 0) Object.assign(body, formatToolsForProvider('ollama', request.tools))
    return {
      provider: 'ollama',
      configId: config.id,
      method: 'POST',
      url: `${baseUrl}/api/chat`,
      headers: {},
      body: JSON.stringify(body),
      auth: { scheme: 'none' },
    }
  },

  parseResponse(json, _config): AIResponse {
    const message = json.message as Record<string, unknown> | undefined
    const toolCalls: ToolCallRequest[] = []
    const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined
    if (rawToolCalls) {
      for (const tc of rawToolCalls) {
        const fn = tc.function as Record<string, unknown>
        toolCalls.push({
          id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: fn.name as string,
          arguments: (fn.arguments as Record<string, unknown>) || {},
        })
      }
    }
    return {
      content: (message?.content as string) || '',
      model: (json.model as string) || _config.model,
      usage: { inputTokens: (json.prompt_eval_count as number) || 0, outputTokens: (json.eval_count as number) || 0 },
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    }
  },

  createStreamFold() { return NOOP_FOLD },
}
