// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import type { AIProviderConfig, AIRequest, AIResponse, ChatMessage, ToolCallRequest } from '../types'
import type { TransportRequest } from '../transport'
import type { AIDriver, StreamFold } from './types'
import { formatToolsForProvider, parseClaudeToolCalls } from './tool-bridge'
import { resolveBaseUrl, stripVersionSuffix } from './util'

function buildClaudeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = []
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const content: Array<Record<string, unknown>> = []
      if (msg.content) content.push({ type: 'text', text: msg.content })
      for (const tc of msg.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      result.push({ role: 'assistant', content })
    } else if (msg.role === 'tool') {
      const lastMsg = result[result.length - 1]
      const toolResultBlock = { type: 'tool_result', tool_use_id: msg.toolCallId, content: msg.content, is_error: msg.isError || false }
      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) &&
          (lastMsg.content as Array<Record<string, unknown>>).every(b => b.type === 'tool_result')) {
        (lastMsg.content as Array<Record<string, unknown>>).push(toolResultBlock)
      } else {
        result.push({ role: 'user', content: [toolResultBlock] })
      }
    } else if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      const content: Array<Record<string, unknown>> = []
      for (const img of msg.images) content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })
      if (msg.content) content.push({ type: 'text', text: msg.content })
      result.push({ role: 'user', content })
    } else {
      result.push({ role: msg.role, content: msg.content })
    }
  }
  return result
}

export const claudeDriver: AIDriver = {
  supportsStreaming: true,

  buildChatRequest(config, request, stream): TransportRequest {
    // Strip any trailing /v1 so a version-suffixed base URL (web convention)
    // doesn't become /v1/v1/messages.
    const baseUrl = stripVersionSuffix(resolveBaseUrl(config, 'https://api.anthropic.com'))
    const systemMessages = request.messages.filter(m => m.role === 'system')
    const chatMessages = request.messages.filter(m => m.role !== 'system')

    const body: Record<string, unknown> = {
      model: request.model || config.model,
      max_tokens: request.maxTokens ?? config.maxTokens ?? 41920,
      messages: buildClaudeMessages(chatMessages),
    }
    if (stream) body.stream = true
    if (systemMessages.length > 0) body.system = systemMessages.map(m => m.content).join('\n')
    const temperature = request.temperature ?? config.temperature
    if (temperature !== undefined) body.temperature = temperature
    const topP = request.topP ?? config.topP
    if (topP !== undefined) body.top_p = topP
    // Anthropic caps stop_sequences (~5) — trim quietly.
    if (request.stop && request.stop.length > 0) body.stop_sequences = request.stop.slice(0, 5)
    if (request.tools && request.tools.length > 0) Object.assign(body, formatToolsForProvider('claude', request.tools))

    return {
      provider: 'claude',
      configId: config.id,
      method: 'POST',
      url: `${baseUrl}/v1/messages`,
      headers: {
        'anthropic-version': '2023-06-01',
        // Required for direct browser fetch; harmless when proxied via Rust.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      auth: { scheme: 'header', headerName: 'x-api-key' },
    }
  },

  parseResponse(json, _config): AIResponse {
    const parsed = parseClaudeToolCalls(json)
    const usage = json.usage as Record<string, number> | undefined
    return {
      content: parsed.textContent,
      model: (json.model as string) || _config.model,
      usage: { inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0 },
      ...(parsed.toolCalls.length > 0 ? { toolCalls: parsed.toolCalls } : {}),
      stopReason: parsed.stopReason,
    }
  },

  createStreamFold(): StreamFold {
    const partials = new Map<number, { id: string; name: string; json: string }>()
    const toolCalls: ToolCallRequest[] = []
    let stopReason = 'end_turn'
    let inputTokens = 0
    let outputTokens = 0
    return {
      pushEnvelope(raw) {
        let v: Record<string, unknown>
        try { v = JSON.parse(raw) } catch { return undefined }
        switch (v.type as string) {
          case 'message_start': {
            const u = (v.message as Record<string, unknown> | undefined)?.usage as Record<string, number> | undefined
            if (u?.input_tokens) inputTokens = u.input_tokens
            break
          }
          case 'content_block_delta': {
            const delta = v.delta as Record<string, unknown> | undefined
            if (delta?.type === 'text_delta') return (delta.text as string) || undefined
            if (delta?.type === 'input_json_delta') {
              const p = partials.get(v.index as number)
              if (p) p.json += (delta.partial_json as string) || ''
            }
            break
          }
          case 'content_block_start': {
            const block = v.content_block as Record<string, unknown> | undefined
            if (block?.type === 'tool_use') partials.set(v.index as number, { id: block.id as string, name: block.name as string, json: '' })
            break
          }
          case 'content_block_stop': {
            const p = partials.get(v.index as number)
            if (p) {
              try { toolCalls.push({ id: p.id, name: p.name, arguments: JSON.parse(p.json || '{}') }) } catch { /* truncated */ }
              partials.delete(v.index as number)
            }
            break
          }
          case 'message_delta': {
            const d = v.delta as Record<string, unknown> | undefined
            if (d?.stop_reason) stopReason = d.stop_reason === 'tool_use' ? 'tool_use' : (d.stop_reason as string)
            const u = v.usage as Record<string, number> | undefined
            if (u?.output_tokens) outputTokens = u.output_tokens
            break
          }
        }
        return undefined
      },
      finish() {
        const usage = (inputTokens || outputTokens) ? { inputTokens, outputTokens } : undefined
        return { ...(toolCalls.length > 0 ? { toolCalls } : {}), stopReason, ...(usage ? { usage } : {}) }
      },
    }
  },
}
