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

// ── Image provider catalog (single source of truth) ─────────────────────────
// Provider base URLs + default model lists, so image-provider origins never
// drift across desktop/web. Superset of what any one app surfaces (desktop shows
// all; web shows the openai/doubao subset under its own `-image` ids and remaps).
// Endpoint paths are still built by `imageEndpoint()` (dedups the version).

export type ImageProvider = 'openai' | 'grok' | 'gemini' | 'qwen' | 'doubao' | 'custom'

export const IMAGE_DEFAULT_MODELS: Record<ImageProvider, string[]> = {
  openai: ['dall-e-3', 'dall-e-2', 'gpt-image-1'],
  grok: ['aurora'],
  gemini: ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-001'],
  qwen: ['wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wan2.6-t2i', 'flux-schnell', 'flux-dev', 'wanx-v1'],
  doubao: ['doubao-seedream-5-0-260128', 'doubao-seedream-3-0-t2i-250415'],
  custom: [],
}

export const IMAGE_BASE_URLS: Record<ImageProvider, string> = {
  openai: 'https://api.openai.com/v1',
  grok: 'https://api.x.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  qwen: 'https://dashscope.aliyuncs.com',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  custom: '',
}

export type ImageAspectRatio = '16:9' | '4:3' | '3:2' | '1:1' | '2:3' | '3:4' | '9:16'
export type ImageSizeLevel = 'large' | 'medium' | 'small'

/** Resolution map: ratio → sizeLevel → "WxH" (standard providers). */
export const IMAGE_SIZE_MAP: Record<ImageAspectRatio, Record<ImageSizeLevel, string>> = {
  '16:9': { large: '1920x1080', medium: '1280x720', small: '960x540' },
  '4:3': { large: '1600x1200', medium: '1024x768', small: '800x600' },
  '3:2': { large: '1536x1024', medium: '1200x800', small: '768x512' },
  '1:1': { large: '1536x1536', medium: '1024x1024', small: '512x512' },
  '2:3': { large: '1024x1536', medium: '800x1200', small: '512x768' },
  '3:4': { large: '1200x1600', medium: '768x1024', small: '600x800' },
  '9:16': { large: '1080x1920', medium: '720x1280', small: '540x960' },
}

/**
 * Doubao (VolcEngine SeeDream) requires ≥3,686,400 px (1920×1920). All sizes
 * here satisfy that; on some ratios small=medium because the minimum valid size
 * already equals the medium tier.
 */
export const DOUBAO_SIZE_MAP: Record<ImageAspectRatio, Record<ImageSizeLevel, string>> = {
  '16:9': { large: '3840x2160', medium: '2560x1440', small: '2560x1440' },
  '4:3': { large: '3200x2400', medium: '2560x1920', small: '2240x1680' },
  '3:2': { large: '3000x2000', medium: '2400x1600', small: '2400x1600' },
  '1:1': { large: '2560x2560', medium: '2048x2048', small: '1920x1920' },
  '2:3': { large: '2000x3000', medium: '1600x2400', small: '1600x2400' },
  '3:4': { large: '2400x3200', medium: '1920x2560', small: '1680x2240' },
  '9:16': { large: '2160x3840', medium: '1440x2560', small: '1440x2560' },
}

export function resolveImageSize(ratio: ImageAspectRatio, level: ImageSizeLevel): string {
  return IMAGE_SIZE_MAP[ratio]?.[level] ?? '1024x1024'
}
