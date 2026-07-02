// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Pure message helpers — flatten / interpolate / merge / lookup. No side
 * effects, no I/O, no global state. Used by `index.ts` to back the active
 * locale and by `ai-utils.ts` for cross-locale lookups.
 */

import type { FlatMessages, MessageBundle } from './types.js'

/**
 * Recursively flatten a nested bundle into a flat `'a.b.c' → string` map.
 * Non-string leaves (numbers, booleans) are coerced to `String(v)`; non-leaf
 * non-objects (e.g. arrays) are dropped silently — i18n payloads should be
 * pure nested string maps.
 */
export function flattenMessages(obj: unknown, prefix = ''): FlatMessages {
  if (typeof obj !== 'object' || obj === null) return {}
  const out: FlatMessages = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      out[key] = v
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = String(v)
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenMessages(v, key))
    }
    // arrays / null / undefined: dropped
  }
  return out
}

/**
 * Interpolate `{name}` placeholders in a message template.
 *
 * - Unknown placeholders pass through unchanged: `{notInVars}` stays literal.
 *   This mirrors the existing moraya & moraya-web behaviour so callers that
 *   embed literal `{x}` in copy don't break.
 */
export function interpolate(template: string, vars?: Record<string, string>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k]
    return v === undefined ? m : v
  })
}

/**
 * Look up `key` in `messages` with a fallback table. Returns:
 *   1. `messages[key]` if present
 *   2. `fallback[key]` if present
 *   3. the literal key itself (debug-friendly — missing keys are visible)
 *
 * `key` is the dot-joined path produced by `flattenMessages`.
 */
export function lookup(
  key: string,
  messages: FlatMessages,
  fallback?: FlatMessages,
): string {
  const direct = messages[key]
  if (direct !== undefined) return direct
  if (fallback) {
    const fb = fallback[key]
    if (fb !== undefined) return fb
  }
  return key
}

/**
 * Deep merge two nested bundles. Right side wins on leaf conflict. Used when
 * a host wants to overlay app-specific strings on top of the shipped bundle
 * without forking the JSON. NOT used by the dynamic locale loader (which
 * just replaces the active bundle wholesale).
 */
export function mergeBundles(base: MessageBundle, overlay: MessageBundle): MessageBundle {
  const out: MessageBundle = { ...base }
  for (const [k, v] of Object.entries(overlay)) {
    const existing = out[k]
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      existing && typeof existing === 'object' && !Array.isArray(existing)
    ) {
      out[k] = mergeBundles(existing as MessageBundle, v as MessageBundle)
    } else {
      out[k] = v
    }
  }
  return out
}
