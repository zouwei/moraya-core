// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { PROVIDER_BASE_URLS } from '../catalog'
import type { AIProviderConfig } from '../types'

export function resolveBaseUrl(config: AIProviderConfig, fallback: string): string {
  return config.baseUrl || PROVIDER_BASE_URLS[config.provider] || fallback
}

/** Build an OpenAI-compatible endpoint, avoiding a double version prefix.
 *  Preserves an explicit version the caller already set (e.g. `/v2`). */
export function openaiEndpoint(baseUrl: string, path: string): string {
  const clean = baseUrl.replace(/\/+$/, '')
  if (/\/v\d+$/.test(clean)) return `${clean}${path}`
  return `${clean}/v1${path}`
}

/**
 * Strip a trailing API-version segment (`/v1`, `/v3`, `/v1beta`, …) from a base
 * URL so a driver with a FIXED version path (Claude → `/v1`, Gemini → `/v1beta`)
 * can append its own without double-prefixing. This makes core robust to both
 * base-URL conventions: origin-only (desktop) and version-suffixed (web).
 */
export function stripVersionSuffix(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v\d+(?:[a-z]+\d*)?$/i, '')
}

export const NOOP_FOLD = {
  pushEnvelope() { return undefined },
  finish() { return { stopReason: 'end_turn' } },
}
