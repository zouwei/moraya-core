import { PROVIDER_BASE_URLS } from '../catalog'
import type { AIProviderConfig } from '../types'

export function resolveBaseUrl(config: AIProviderConfig, fallback: string): string {
  return config.baseUrl || PROVIDER_BASE_URLS[config.provider] || fallback
}

/** Build an OpenAI-compatible endpoint, avoiding a double version prefix. */
export function openaiEndpoint(baseUrl: string, path: string): string {
  const clean = baseUrl.replace(/\/+$/, '')
  if (/\/v\d+$/.test(clean)) return `${clean}${path}`
  return `${clean}/v1${path}`
}

export const NOOP_FOLD = {
  pushEnvelope() { return undefined },
  finish() { return { stopReason: 'end_turn' } },
}
