// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Provider catalog — default models, base URLs, labels, id aliases.
 * Baselined on the desktop app. Pure data; no host imports.
 */
import type { AIProvider } from './types'

export const DEFAULT_MODELS: Record<AIProvider, string[]> = {
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5', 'gpt-5-mini', 'o4-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-pro-exp'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3.3', 'llama3.2', 'qwen2.5', 'qwen2.5-coder', 'phi4', 'gemma3', 'deepseek-r1', 'mistral', 'codellama'],
  grok: ['grok-4', 'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-code-fast-1', 'grok-3'],
  mistral: ['mistral-large-latest', 'mistral-small-latest', 'magistral-medium-latest', 'magistral-small-latest', 'codestral-latest', 'devstral-latest'],
  glm: ['glm-5', 'glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-z1-flash', 'glm-z1-air'],
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-Text-01'],
  doubao: [],
  custom: [],
  'local-mlx': ['Qwen2.5-1.5B-Instruct-4bit'],
  'local-llama': ['qwen2.5-1.5b-instruct-q4'],
}

export const PROVIDER_BASE_URLS: Record<AIProvider, string> = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  deepseek: 'https://api.deepseek.com',
  ollama: 'http://localhost:11434',
  grok: 'https://api.x.ai',
  mistral: 'https://api.mistral.ai',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.io/v1',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  custom: '',
  'local-mlx': '',
  'local-llama': '',
}

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  grok: 'Grok',
  mistral: 'Mistral',
  glm: 'GLM',
  minimax: 'MiniMax',
  doubao: 'Doubao',
  custom: 'Custom (OpenAI-compatible)',
  'local-mlx': 'On-device (iOS)',
  'local-llama': 'On-device (Android)',
}

/** Legacy/foreign provider ids → canonical `AIProvider`. */
export const PROVIDER_ALIASES: Record<string, AIProvider> = {
  anthropic: 'claude',
}

/** Normalize an incoming provider id (applies aliases). */
export function normalizeProvider(id: string): AIProvider {
  return (PROVIDER_ALIASES[id] ?? id) as AIProvider
}

/** Per-provider capability metadata. Cloud providers carry no flags. */
export interface ProviderMeta {
  /** On-device runtime (no network); available only on its matching platform. */
  onDevice?: boolean
  /** For on-device providers: the mobile platform that ships this runtime. */
  platform?: 'ios' | 'android'
}

export const PROVIDER_META: Record<AIProvider, ProviderMeta> = {
  claude: {},
  openai: {},
  gemini: {},
  deepseek: {},
  ollama: {},
  grok: {},
  mistral: {},
  glm: {},
  minimax: {},
  doubao: {},
  custom: {},
  'local-mlx': { onDevice: true, platform: 'ios' },
  'local-llama': { onDevice: true, platform: 'android' },
}

/** The consuming platform for {@link resolveCatalog}. */
export type CatalogPlatform = 'desktop' | 'web' | 'ios' | 'android'

export interface CatalogView {
  /** Consuming platform. On-device providers appear only on their matching mobile platform. */
  platform: CatalogPlatform
  /** Client-supplied model options for on-device providers (overrides the seed defaults). */
  localModels?: Partial<Record<AIProvider, string[]>>
}

export interface ResolvedProvider {
  id: AIProvider
  label: string
  baseUrl: string
  models: string[]
  onDevice: boolean
}

/**
 * Resolve the effective provider catalog for one platform — the single source of
 * truth all Moraya clients consume instead of forking their own catalog.
 *
 * Capability filtering only (no user-preference / entitlement layer here):
 * - On-device providers are included solely on their matching mobile platform,
 *   so desktop/web naturally omit them.
 * - Cloud providers are always included with core's authoritative model lists.
 * - On-device model lists may be overridden per-platform via `view.localModels`
 *   (e.g. iOS MLX vs Android GGUF bundles); absent an override, the seed default
 *   in {@link DEFAULT_MODELS} is used.
 */
export function resolveCatalog(view: CatalogView): ResolvedProvider[] {
  const out: ResolvedProvider[] = []
  for (const id of Object.keys(PROVIDER_LABELS) as AIProvider[]) {
    const meta = PROVIDER_META[id]
    const onDevice = meta.onDevice === true
    if (onDevice && meta.platform !== view.platform) continue
    const models = onDevice ? view.localModels?.[id] ?? DEFAULT_MODELS[id] : DEFAULT_MODELS[id]
    out.push({ id, label: PROVIDER_LABELS[id], baseUrl: PROVIDER_BASE_URLS[id], models, onDevice })
  }
  return out
}
