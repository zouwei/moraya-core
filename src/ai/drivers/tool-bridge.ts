/**
 * Tool formatting + response parsing, shared by all consumers.
 * Ported verbatim from the desktop app's tool-bridge (MCP-specific glue like
 * `mcpToolsToToolDefs` stays in the desktop repo — it has no place in core).
 */
import type { AIProvider, ToolDefinition, ToolCallRequest } from '../types'

const GEMINI_UNSUPPORTED_KEYS = new Set([
  'additionalProperties', '$schema', '$id', '$ref', '$defs', 'definitions',
  'patternProperties', 'unevaluatedProperties', 'dependentRequired',
  'dependentSchemas', 'const',
])

function sanitizeGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeGeminiSchema)
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
      if (GEMINI_UNSUPPORTED_KEYS.has(key)) continue
      out[key] = sanitizeGeminiSchema(value)
    }
    return out
  }
  return schema
}

/** Format tools into provider-specific request-body fields (merge into body). */
export function formatToolsForProvider(
  provider: AIProvider,
  tools: ToolDefinition[],
): Record<string, unknown> {
  if (tools.length === 0) return {}
  switch (provider) {
    case 'claude':
      return {
        tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      }
    case 'gemini':
      return {
        tools: [{
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: sanitizeGeminiSchema(t.input_schema),
          })),
        }],
      }
    default:
      // OpenAI-compatible (openai/deepseek/grok/mistral/glm/minimax/doubao/custom/ollama)
      return {
        tools: tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      }
  }
}

export function parseClaudeToolCalls(data: Record<string, unknown>): {
  toolCalls: ToolCallRequest[]; textContent: string; stopReason: string
} {
  const content = data.content as Array<Record<string, unknown>> | undefined
  const stopReason = (data.stop_reason as string) || 'end_turn'
  const toolCalls: ToolCallRequest[] = []
  let textContent = ''
  if (content) {
    for (const block of content) {
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id as string, name: block.name as string, arguments: (block.input as Record<string, unknown>) || {} })
      } else if (block.type === 'text') {
        textContent += block.text as string
      }
    }
  }
  return { toolCalls, textContent, stopReason }
}

export function parseOpenAIToolCalls(data: Record<string, unknown>): {
  toolCalls: ToolCallRequest[]; textContent: string; stopReason: string
} {
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  if (!choices || choices.length === 0) return { toolCalls: [], textContent: '', stopReason: 'stop' }
  const choice = choices[0]!
  const message = choice.message as Record<string, unknown> | undefined
  const finishReason = (choice.finish_reason as string) || 'stop'
  const textContent = (message?.content as string) || ''
  const toolCalls: ToolCallRequest[] = []
  const rawToolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined
  if (rawToolCalls) {
    for (const tc of rawToolCalls) {
      const fn = tc.function as Record<string, unknown>
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(fn.arguments as string) } catch { /* truncated */ }
      toolCalls.push({ id: tc.id as string, name: fn.name as string, arguments: args })
    }
  }
  return { toolCalls, textContent, stopReason: finishReason === 'tool_calls' ? 'tool_use' : finishReason }
}

export function parseGeminiToolCalls(data: Record<string, unknown>): {
  toolCalls: ToolCallRequest[]; textContent: string; stopReason: string
} {
  const candidates = data.candidates as Array<Record<string, unknown>> | undefined
  if (!candidates || candidates.length === 0) return { toolCalls: [], textContent: '', stopReason: 'stop' }
  const content = candidates[0]!.content as Record<string, unknown> | undefined
  const parts = content?.parts as Array<Record<string, unknown>> | undefined
  const toolCalls: ToolCallRequest[] = []
  let textContent = ''
  if (parts) {
    for (const part of parts) {
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>
        const thoughtSignature =
          (part.thoughtSignature as string | undefined) ?? (fc.thoughtSignature as string | undefined)
        toolCalls.push({
          id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: fc.name as string,
          arguments: (fc.args as Record<string, unknown>) || {},
          ...(thoughtSignature ? { providerMeta: { thoughtSignature } } : {}),
        })
      } else if (part.text) {
        textContent += part.text as string
      }
    }
  }
  return { toolCalls, textContent, stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop' }
}

export function buildClaudeToolResultMessages(
  toolResults: Array<{ callId: string; content: string; isError?: boolean }>,
): Record<string, unknown> {
  return {
    role: 'user',
    content: toolResults.map(r => ({
      type: 'tool_result', tool_use_id: r.callId, content: r.content, is_error: r.isError || false,
    })),
  }
}

export function buildOpenAIToolResultMessages(
  toolResults: Array<{ callId: string; name: string; content: string }>,
): Array<Record<string, unknown>> {
  return toolResults.map(r => ({ role: 'tool', tool_call_id: r.callId, content: r.content }))
}
