import type { AIProviderConfig, AIRequest, AIResponse, ChatMessage, ToolCallRequest } from '../types'
import type { TransportRequest } from '../transport'
import type { AIDriver, StreamFold } from './types'
import { formatToolsForProvider, parseOpenAIToolCalls } from './tool-bridge'
import { resolveBaseUrl, openaiEndpoint } from './util'

function buildOpenAIMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map(tc => ({
          id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    } else if (msg.role === 'tool') {
      return { role: 'tool', tool_call_id: msg.toolCallId, content: msg.content }
    } else if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      const content: Array<Record<string, unknown>> = []
      for (const img of msg.images) content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })
      if (msg.content) content.push({ type: 'text', text: msg.content })
      return { role: 'user', content }
    }
    return { role: msg.role, content: msg.content }
  })
}

/** OpenAI-compatible driver: openai/deepseek/grok/mistral/glm/minimax/doubao/custom. */
export const openaiDriver: AIDriver = {
  supportsStreaming: true,

  buildChatRequest(config, request, stream): TransportRequest {
    const baseUrl = resolveBaseUrl(config, 'https://api.openai.com')
    const body: Record<string, unknown> = {
      model: request.model || config.model,
      max_tokens: request.maxTokens ?? config.maxTokens ?? 41920,
      temperature: request.temperature ?? config.temperature ?? 0.7,
      messages: buildOpenAIMessages(request.messages),
    }
    if (stream) {
      body.stream = true
      // Ask for token usage in the final SSE chunk. Limited to OpenAI/DeepSeek —
      // some other OpenAI-compatible endpoints reject unknown body fields.
      if (config.provider === 'openai' || config.provider === 'deepseek') {
        body.stream_options = { include_usage: true }
      }
    }
    const topP = request.topP ?? config.topP
    if (topP !== undefined) body.top_p = topP
    // OpenAI rejects >4 stop sequences (400) — trim quietly.
    if (request.stop && request.stop.length > 0) body.stop = request.stop.slice(0, 4)
    if (request.tools && request.tools.length > 0) Object.assign(body, formatToolsForProvider(config.provider, request.tools))

    // Proxy-provider key: deepseek keeps its own (for Rust auth), everything
    // else OpenAI-compatible maps to 'openai'.
    const proxyProvider = config.provider === 'deepseek' ? 'deepseek' : 'openai'
    return {
      provider: proxyProvider,
      configId: config.id,
      method: 'POST',
      url: openaiEndpoint(baseUrl, '/chat/completions'),
      headers: {},
      body: JSON.stringify(body),
      auth: { scheme: 'bearer' },
    }
  },

  parseResponse(json, _config): AIResponse {
    const parsed = parseOpenAIToolCalls(json)
    const usage = json.usage as Record<string, number> | undefined
    return {
      content: parsed.textContent,
      model: (json.model as string) || _config.model,
      usage: { inputTokens: usage?.prompt_tokens || 0, outputTokens: usage?.completion_tokens || 0 },
      ...(parsed.toolCalls.length > 0 ? { toolCalls: parsed.toolCalls } : {}),
      stopReason: parsed.stopReason,
    }
  },

  createStreamFold(): StreamFold {
    const toolMap = new Map<number, { id: string; name: string; args: string }>()
    let stopReason = 'end_turn'
    let usage: { inputTokens: number; outputTokens: number } | undefined
    return {
      pushEnvelope(raw) {
        let v: Record<string, unknown>
        try { v = JSON.parse(raw) } catch { return undefined }
        const u = v.usage as Record<string, number> | undefined
        if (u) usage = { inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 }
        const choices = v.choices as Array<Record<string, unknown>> | undefined
        if (!choices || choices.length === 0) return undefined
        const choice = choices[0]!
        const fr = choice.finish_reason as string | null
        if (fr) stopReason = fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'max_tokens' : fr
        const delta = choice.delta as Record<string, unknown> | undefined
        const rawTC = delta?.tool_calls as Array<Record<string, unknown>> | undefined
        if (rawTC) {
          for (const tc of rawTC) {
            const idx = (tc.index as number) ?? 0
            const fn = tc.function as Record<string, unknown> | undefined
            let entry = toolMap.get(idx)
            if (!entry) { entry = { id: (tc.id as string) || '', name: '', args: '' }; toolMap.set(idx, entry) }
            if (tc.id) entry.id = tc.id as string
            if (fn?.name) entry.name = fn.name as string
            if (fn?.arguments) entry.args += fn.arguments as string
          }
        }
        return (delta?.content as string) || undefined
      },
      finish() {
        const toolCalls: ToolCallRequest[] = []
        for (const [, entry] of [...toolMap.entries()].sort((a, b) => a[0] - b[0])) {
          let args: Record<string, unknown> = {}
          try { args = JSON.parse(entry.args || '{}') } catch { continue }
          toolCalls.push({ id: entry.id, name: entry.name, arguments: args })
        }
        return { ...(toolCalls.length > 0 ? { toolCalls } : {}), stopReason, ...(usage ? { usage } : {}) }
      },
    }
  },
}
