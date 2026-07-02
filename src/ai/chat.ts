// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Chat orchestrator — composes a per-provider driver with a platform transport.
 * Platform-agnostic: no fetch, no Tauri. Streaming uses a small callback→async
 * generator pump (ported from the desktop streamViaProxy backpressure logic).
 */
import type { AIProviderConfig, AIRequest, AIResponse, AIStreamEvent } from './types'
import type { AITransport } from './transport'
import { getDriver } from './drivers'
import type { AIDriver } from './drivers/types'

/** Attach the config's key reference to a built request. Drivers stay key-free;
 *  the transport decides what to do with it (PC: Keychain override guard;
 *  web: apply per the auth descriptor). On PC `apiKey` is the `'***'` sentinel
 *  (the real key lives in the OS Keychain), so the real key never enters core. */
function withKey(treq: ReturnType<AIDriver['buildChatRequest']>, config: AIProviderConfig) {
  if (config.apiKey !== undefined) treq.apiKey = config.apiKey
  return treq
}

export async function sendChat(
  config: AIProviderConfig,
  request: AIRequest,
  transport: AITransport,
  signal?: AbortSignal,
): Promise<AIResponse> {
  const driver = getDriver(config.provider)
  const treq = withKey(driver.buildChatRequest(config, request, false), config)
  const res = await transport.fetch(treq, signal)
  if (res.status >= 400) {
    throw new Error(`AI request failed (${res.status}): ${res.body.slice(0, 300)}`)
  }
  let json: Record<string, unknown>
  try { json = JSON.parse(res.body) } catch { throw new Error('AI returned non-JSON response') }
  return driver.parseResponse(json, config)
}

export async function* streamChat(
  config: AIProviderConfig,
  request: AIRequest,
  transport: AITransport,
  signal?: AbortSignal,
): AsyncGenerator<AIStreamEvent> {
  const driver = getDriver(config.provider)
  const canStream = driver.supportsStreaming && (transport.canStream?.(config.provider) ?? true)

  // Providers the transport can't stream (e.g. gemini/ollama on the Rust proxy)
  // → one-shot, then surface as a single delta + terminal event. Preserves PC.
  if (!canStream) {
    const resp = await sendChat(config, request, transport, signal)
    if (resp.content) yield { delta: resp.content }
    yield {
      done: true,
      ...(resp.toolCalls ? { toolCalls: resp.toolCalls } : {}),
      ...(resp.usage ? { usage: resp.usage } : {}),
      ...(resp.stopReason ? { stopReason: resp.stopReason } : {}),
    }
    return
  }

  const treq = withKey(driver.buildChatRequest(config, request, true), config)
  const fold = driver.createStreamFold()

  const queue: string[] = []
  let ended = false
  let err: unknown = null
  let notify: (() => void) | null = null
  const wake = () => { notify?.(); notify = null }

  const pump = transport.stream(treq, {
    ...(signal ? { signal } : {}),
    onText: (delta) => { if (delta) { queue.push(delta); wake() } },
    onEnvelope: (rawJson) => { const d = fold.pushEnvelope(rawJson); if (d) { queue.push(d); wake() } },
  }).then(() => { ended = true; wake() }).catch((e) => { err = e; ended = true; wake() })

  let yieldCount = 0
  while (!ended || queue.length > 0) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (queue.length > 0) {
      yield { delta: queue.shift()! }
      // Periodically cede the event loop so the UI stays responsive.
      if (++yieldCount % 15 === 0) await new Promise<void>(r => setTimeout(r, 0))
    } else if (!ended) {
      await new Promise<void>(resolve => { notify = resolve })
    }
  }
  if (err) throw err instanceof Error ? err : new Error(String(err))
  await pump
  const fin = fold.finish()
  yield {
    done: true,
    ...(fin.toolCalls ? { toolCalls: fin.toolCalls } : {}),
    ...(fin.usage ? { usage: fin.usage } : {}),
    stopReason: fin.stopReason,
  }
}
