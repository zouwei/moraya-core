// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { claudeDriver, openaiDriver, geminiDriver } from '../drivers'
import { getDriver, streamChat, sendChat, normalizeProvider, resolveCatalog, DEFAULT_MODELS } from '../index'
import type { CatalogView } from '../index'
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

describe('drivers dedup version-suffixed base URLs (web convention)', () => {
  it('claude: /v1-suffixed baseUrl does not become /v1/v1/messages', () => {
    const t = claudeDriver.buildChatRequest(cfg({ baseUrl: 'https://api.anthropic.com/v1' }), req(), false)
    expect(t.url).toBe('https://api.anthropic.com/v1/messages')
  })
  it('claude: origin-only baseUrl still gets /v1', () => {
    const t = claudeDriver.buildChatRequest(cfg({ baseUrl: 'https://api.anthropic.com' }), req(), false)
    expect(t.url).toBe('https://api.anthropic.com/v1/messages')
  })
  it('gemini: /v1beta-suffixed baseUrl does not double-prefix', () => {
    const t = geminiDriver.buildChatRequest(cfg({ provider: 'gemini', model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }), req(), false)
    expect(t.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
  })
  it('gemini: origin-only baseUrl still gets /v1beta', () => {
    const t = geminiDriver.buildChatRequest(cfg({ provider: 'gemini', model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com' }), req(), true)
    expect(t.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
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

describe('resolveCatalog — capability filtering + local overlay', () => {
  const ids = (v: CatalogView) => resolveCatalog(v).map((p) => p.id)

  it('desktop and web hide on-device providers, keep cloud ones', () => {
    for (const platform of ['desktop', 'web'] as const) {
      const got = ids({ platform })
      expect(got).not.toContain('local-mlx')
      expect(got).not.toContain('local-llama')
      expect(got).toContain('claude')
      expect(got).toContain('custom')
    }
  })

  it('ios shows local-mlx only; android shows local-llama only', () => {
    expect(ids({ platform: 'ios' })).toContain('local-mlx')
    expect(ids({ platform: 'ios' })).not.toContain('local-llama')
    expect(ids({ platform: 'android' })).toContain('local-llama')
    expect(ids({ platform: 'android' })).not.toContain('local-mlx')
  })

  it('cloud model lists come from core and are marked not on-device', () => {
    const claude = resolveCatalog({ platform: 'desktop' }).find((p) => p.id === 'claude')!
    expect(claude.models).toEqual(DEFAULT_MODELS.claude)
    expect(claude.onDevice).toBe(false)
  })

  it('localModels overrides the on-device seed; absent an override falls back to seed', () => {
    const custom = ['My-Local-7B', 'My-Local-3B']
    const overridden = resolveCatalog({ platform: 'ios', localModels: { 'local-mlx': custom } }).find((p) => p.id === 'local-mlx')!
    expect(overridden.models).toEqual(custom)
    expect(overridden.onDevice).toBe(true)
    const seeded = resolveCatalog({ platform: 'ios' }).find((p) => p.id === 'local-mlx')!
    expect(seeded.models).toEqual(DEFAULT_MODELS['local-mlx'])
  })
})
