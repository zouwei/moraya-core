import type { AIRequest, AIResponse, ChatMessage, ToolCallRequest } from '../types'
import type { TransportRequest } from '../transport'
import type { AIDriver, StreamFold } from './types'
import { formatToolsForProvider, parseGeminiToolCalls } from './tool-bridge'
import { resolveBaseUrl } from './util'

function buildGeminiContents(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map(msg => {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const parts: Array<Record<string, unknown>> = []
      if (msg.content) parts.push({ text: msg.content })
      for (const tc of msg.toolCalls) {
        const sig = tc.providerMeta?.thoughtSignature as string | undefined
        const part: Record<string, unknown> = { functionCall: { name: tc.name, args: tc.arguments } }
        if (sig) part.thoughtSignature = sig
        parts.push(part)
      }
      return { role: 'model', parts }
    } else if (msg.role === 'tool') {
      return { role: 'user', parts: [{ functionResponse: { name: msg.toolName, response: { content: msg.content } } }] }
    }
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      const parts: Array<Record<string, unknown>> = []
      for (const img of msg.images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } })
      if (msg.content) parts.push({ text: msg.content })
      return { role: 'user', parts }
    }
    return { role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] }
  })
}

export const geminiDriver: AIDriver = {
  supportsStreaming: true,

  buildChatRequest(config, request, stream): TransportRequest {
    const baseUrl = resolveBaseUrl(config, 'https://generativelanguage.googleapis.com')
    const systemMessages = request.messages.filter(m => m.role === 'system')
    const chatMessages = request.messages.filter(m => m.role !== 'system')

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens ?? config.maxTokens ?? 41920,
      temperature: request.temperature ?? config.temperature ?? 0.7,
    }
    const topP = request.topP ?? config.topP
    if (topP !== undefined) generationConfig.topP = topP
    if (request.stop && request.stop.length > 0) generationConfig.stopSequences = request.stop

    const body: Record<string, unknown> = { contents: buildGeminiContents(chatMessages), generationConfig }
    if (systemMessages.length > 0) body.systemInstruction = { parts: [{ text: systemMessages.map(m => m.content).join('\n') }] }
    if (request.tools && request.tools.length > 0) Object.assign(body, formatToolsForProvider('gemini', request.tools))

    const model = request.model || config.model
    const verb = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
    return {
      provider: 'gemini',
      configId: config.id,
      method: 'POST',
      url: `${baseUrl}/v1beta/models/${model}:${verb}`,
      headers: {},
      body: JSON.stringify(body),
      auth: { scheme: 'query', queryParam: 'key' },
    }
  },

  parseResponse(json, config): AIResponse {
    const parsed = parseGeminiToolCalls(json)
    const usage = json.usageMetadata as Record<string, number> | undefined
    return {
      content: parsed.textContent,
      model: config.model,
      usage: { inputTokens: usage?.promptTokenCount || 0, outputTokens: usage?.candidatesTokenCount || 0 },
      ...(parsed.toolCalls.length > 0 ? { toolCalls: parsed.toolCalls } : {}),
      stopReason: parsed.stopReason === 'tool_use' ? 'tool_use' : 'end_turn',
    }
  },

  createStreamFold(): StreamFold {
    const toolCalls: ToolCallRequest[] = []
    let stopReason = 'end_turn'
    let usage: { inputTokens: number; outputTokens: number } | undefined
    return {
      pushEnvelope(raw) {
        let v: Record<string, unknown>
        try { v = JSON.parse(raw) } catch { return undefined }
        const um = v.usageMetadata as Record<string, number> | undefined
        if (um) usage = { inputTokens: um.promptTokenCount || 0, outputTokens: um.candidatesTokenCount || 0 }
        const candidates = v.candidates as Array<Record<string, unknown>> | undefined
        const cand = candidates?.[0]
        if (!cand) return undefined
        const parts = (cand.content as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined
        let text = ''
        if (parts) {
          for (const part of parts) {
            if (part.functionCall) {
              const fc = part.functionCall as Record<string, unknown>
              const sig = (part.thoughtSignature as string | undefined) ?? (fc.thoughtSignature as string | undefined)
              toolCalls.push({
                id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: fc.name as string,
                arguments: (fc.args as Record<string, unknown>) || {},
                ...(sig ? { providerMeta: { thoughtSignature: sig } } : {}),
              })
              stopReason = 'tool_use'
            } else if (part.text) {
              text += part.text as string
            }
          }
        }
        return text || undefined
      },
      finish() { return { ...(toolCalls.length > 0 ? { toolCalls } : {}), stopReason, ...(usage ? { usage } : {}) } },
    }
  },
}
