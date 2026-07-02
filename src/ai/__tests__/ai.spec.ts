// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { claudeDriver, openaiDriver, geminiDriver } from '../drivers'
import { getDriver, streamChat, sendChat, normalizeProvider } from '../index'
import type { AITransport, TransportRequest, StreamCallbacks } from '../transport'
import type { AIProviderConfig, AIRequest } from '../types'

const cfg = (over: Partial<AIProviderConfig> = {}): AIProviderConfig => ({
  id: 'cfg-1', provider: 'claude', model: 'claude-sonnet-4-6', ...over,
})
const req = (over: Partial<AIRequest> = {}): AIRequest => ({
  messages: [{ role: 'user', content: 'hi' }], ...over,
})

describe('drivers.buildChatRequest — no secret leakage', () => {
  it('claude: x-api-key auth descriptor, key never in headers/body', () => {
    const t = claudeDriver.buildChatRequest(cfg({ apiKey: 'sk-secret' }), req(), false)
    expect(t.url).toMatch(/\/v1\/messages$/)
    expect(t.auth).toEqual({ scheme: 'header', headerName: 'x-api-key' })
    const blob = JSON.stringify(t.headers) + t.body
    expect(blob).not.toContain('sk-secret')
    expect(JSON.stringify(t.headers).toLowerCase()).not.toContain('authorization')
    expect(t.body).toContain('"max_tokens"')
  })
  it('openai-compat: bearer auth; deepseek keeps proxy provider', () => {
    expect(openaiDriver.buildChatRequest(cfg({ provider: 'grok' }), req(), false).provider).toBe('openai')
    expect(openaiDriver.buildChatRequest(cfg({ provider: 'deepseek' }), req(), false).provider).toBe('deepseek')
    expect(openaiDriver.buildChatRequest(cfg({ provider: 'openai' }), req(), true).auth.scheme).toBe('bearer')
  })
  it('gemini: query-param auth; stream verb switches', () => {
    const oneShot = geminiDriver.buildChatRequest(cfg({ provider: 'gemini', model: 'gemini-2.5-flash' }), req(), false)
    const stream = geminiDriver.buildChatRequest(cfg({ provider: 'gemini', model: 'gemini-2.5-flash' }), req(), true)
    expect(oneShot.url).toMatch(/:generateContent$/)
    expect(stream.url).toMatch(/:streamGenerateContent\?alt=sse$/)
    expect(oneShot.auth).toEqual({ scheme: 'query', queryParam: 'key' })
  })
})

describe('getDriver / aliases', () => {
  it('maps openai-compat ids to the openai driver', () => {
    for (const p of ['openai', 'grok', 'mistral', 'glm', 'minimax', 'doubao', 'custom'] as const) {
      expect(getDriver(p)).toBe(openaiDriver)
    }
  })
  it('normalizeProvider maps anthropic→claude', () => {
    expect(normalizeProvider('anthropic')).toBe('claude')
    expect(normalizeProvider('openai')).toBe('openai')
  })
  it('throws for on-device providers (handled by consumer)', () => {
    expect(() => getDriver('local-mlx')).toThrow()
  })
})

describe('parseResponse', () => {
  it('claude non-streaming text + usage', () => {
    const r = claudeDriver.parseResponse({
      model: 'claude-x', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 3, output_tokens: 5 },
    }, cfg())
    expect(r.content).toBe('hello')
    expect(r.usage).toEqual({ inputTokens: 3, outputTokens: 5 })
  })
})

/** Transport that replays scripted text + envelope chunks. */
class FakeTransport implements AITransport {
  constructor(private script: { text?: string; env?: string }[], private oneShotBody?: string) {}
  async fetch(): Promise<{ status: number; body: string }> {
    return { status: 200, body: this.oneShotBody ?? '{}' }
  }
  async stream(_req: TransportRequest, cb: StreamCallbacks): Promise<void> {
    for (const s of this.script) {
      if (s.text) cb.onText(s.text)
      if (s.env) cb.onEnvelope(s.env)
    }
  }
}

describe('streamChat', () => {
  it('claude: surfaces text deltas + assembles a streamed tool call', async () => {
    const transport = new FakeTransport([
      { text: 'Hel' }, { text: 'lo' },
      { env: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'search' } }) },
      { env: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":' } }) },
      { env: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"x"}' } }) },
      { env: JSON.stringify({ type: 'content_block_stop', index: 0 }) },
      { env: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) },
    ])
    let text = ''
    let tool: unknown = null
    for await (const ev of streamChat(cfg(), req(), transport)) {
      if (ev.delta) text += ev.delta
      if (ev.done) tool = ev.toolCalls
    }
    expect(text).toBe('Hello')
    expect(tool).toEqual([{ id: 't1', name: 'search', arguments: { q: 'x' } }])
  })

  it('web-style claude SSE: text_delta envelopes become deltas', async () => {
    const transport = new FakeTransport([
      { env: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A' } }) },
      { env: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'B' } }) },
    ])
    let text = ''
    for await (const ev of streamChat(cfg(), req(), transport)) if (ev.delta) text += ev.delta
    expect(text).toBe('AB')
  })

  it('ollama: one-shot path (supportsStreaming=false)', async () => {
    const body = JSON.stringify({ model: 'llama3.3', message: { content: 'pong' }, prompt_eval_count: 1, eval_count: 1 })
    const transport = new FakeTransport([], body)
    let text = ''
    for await (const ev of streamChat(cfg({ provider: 'ollama', model: 'llama3.3' }), req(), transport)) {
      if (ev.delta) text += ev.delta
    }
    expect(text).toBe('pong')
  })

  it('sendChat openai parses content', async () => {
    const body = JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content: 'hi there' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2 } })
    const r = await sendChat(cfg({ provider: 'openai', model: 'gpt-4o' }), req(), new FakeTransport([], body))
    expect(r.content).toBe('hi there')
  })
})
