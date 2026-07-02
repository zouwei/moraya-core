// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Shared image generation — the OpenAI-compatible `/images/generations` path
 * used by every Moraya image provider that speaks that protocol (web's
 * openai-image + doubao-image; desktop's openai/grok/doubao/custom). The
 * request body + response extraction live here once; each app keeps its own
 * transport (fetch vs Tauri proxy), key handling, guards, and error mapping.
 *
 * Desktop's gemini-predict + qwen/DashScope two-phase providers are NOT here —
 * they stay in the desktop app (different protocols, no web counterpart).
 */
import { openaiEndpoint } from './drivers/util'

export interface GeneratedImage {
  /** Public URL (caller may re-host). */
  url?: string
  /** Base64 image bytes (no `data:` prefix). */
  b64Json?: string
  /** Provider's safety/clarity-revised prompt, if any. */
  revisedPrompt?: string
}

export interface ImageGenRequest {
  prompt: string
  n?: number
  size?: string
  model?: string
  responseFormat?: 'url' | 'b64_json'
  signal?: AbortSignal
}

export interface ImageGenResult {
  provider: string
  model: string
  images: GeneratedImage[]
  durationMs: number
}

/** OpenAI-compatible `/images/generations` endpoint (avoids double /v1). */
export function imageEndpoint(baseUrl: string): string {
  return openaiEndpoint(baseUrl, '/images/generations')
}

/** Build the OpenAI-compatible images request body. `n` is included only when
 *  the caller passes it (already clamped per its model/capabilities) — some
 *  models (e.g. Doubao Seedream) require `n` to be absent. */
export function buildOpenAIImageBody(
  model: string,
  req: { prompt: string; n?: number; size?: string; responseFormat?: 'url' | 'b64_json' },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    response_format: req.responseFormat ?? 'url',
  }
  if (req.n !== undefined) body.n = req.n
  if (req.size) body.size = req.size
  return body
}

/** Extract images from an OpenAI-compatible `{ data: [...] }` response. */
export function extractOpenAIImages(json: unknown): GeneratedImage[] {
  const data = (json as { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }> }).data
  if (!Array.isArray(data)) return []
  return data.map(d => ({
    ...(d.url ? { url: d.url } : {}),
    ...(d.b64_json ? { b64Json: d.b64_json } : {}),
    ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}),
  }))
}
