// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Dynamic locale-bundle loader with module-scoped cache.
 *
 * Each `loadBundle(loc)` call returns the same flat-messages map on repeat
 * calls (memoized). The underlying `import('./locales/<loc>.json')` is what
 * tsup / vite turn into a code-split chunk — only locales the user actually
 * picks reach the consumer's bundle.
 *
 * Test injection: `__setLoader(fn)` lets unit tests swap the dynamic-import
 * function with a synchronous fixture-returning stub.
 */

import type { FlatMessages, SupportedLocale, MessageBundle } from './types.js'
import { flattenMessages } from './messages.js'

type LoaderFn = (loc: SupportedLocale) => Promise<MessageBundle>

/**
 * Default loader uses `import()` against the colocated `./locales/<loc>.json`
 * files. The `with { type: 'json' }` assertion is omitted intentionally —
 * tsup/vite both handle bare JSON imports, and adding the assertion would
 * break Vite < 5.
 */
const defaultLoader: LoaderFn = async (loc) => {
  // The switch keeps each branch a static literal so bundlers can analyze
  // and code-split per locale. A computed `import('./locales/' + loc + '.json')`
  // would either bundle them all eagerly or fail to resolve.
  switch (loc) {
    case 'en':      return (await import('./locales/en.json')).default as unknown as MessageBundle
    case 'zh-CN':   return (await import('./locales/zh-CN.json')).default as unknown as MessageBundle
    case 'zh-Hant': return (await import('./locales/zh-Hant.json')).default as unknown as MessageBundle
    case 'ar':      return (await import('./locales/ar.json')).default as unknown as MessageBundle
    case 'de':      return (await import('./locales/de.json')).default as unknown as MessageBundle
    case 'es':      return (await import('./locales/es.json')).default as unknown as MessageBundle
    case 'fr':      return (await import('./locales/fr.json')).default as unknown as MessageBundle
    case 'hi':      return (await import('./locales/hi.json')).default as unknown as MessageBundle
    case 'ja':      return (await import('./locales/ja.json')).default as unknown as MessageBundle
    case 'ko':      return (await import('./locales/ko.json')).default as unknown as MessageBundle
    case 'pt':      return (await import('./locales/pt.json')).default as unknown as MessageBundle
    case 'ru':      return (await import('./locales/ru.json')).default as unknown as MessageBundle
  }
}

let activeLoader: LoaderFn = defaultLoader
const flatCache = new Map<SupportedLocale, FlatMessages>()
const nestedCache = new Map<SupportedLocale, MessageBundle>()

/**
 * Resolve and cache a locale's flat-messages bundle. Subsequent calls return
 * the cached map without re-importing.
 */
export async function loadBundle(loc: SupportedLocale): Promise<FlatMessages> {
  const cached = flatCache.get(loc)
  if (cached) return cached
  const nested = await activeLoader(loc)
  const flat = flattenMessages(nested)
  flatCache.set(loc, flat)
  nestedCache.set(loc, nested)
  return flat
}

/** Synchronous cache read — returns `undefined` if the locale isn't loaded yet. */
export function peekBundle(loc: SupportedLocale): FlatMessages | undefined {
  return flatCache.get(loc)
}

/** Synchronous cache read of the nested form (for AI utilities). */
export function peekNested(loc: SupportedLocale): MessageBundle | undefined {
  return nestedCache.get(loc)
}

/** Preload several locales in parallel. Returns once all are cached. */
export async function preloadBundles(locales: readonly SupportedLocale[]): Promise<void> {
  await Promise.all(locales.map((l) => loadBundle(l)))
}

/* ─────────────────────────────────────────────────────────────────────────
 * Test injection. Not part of the public API. Resets caches as a side effect
 * to keep tests deterministic.
 * ────────────────────────────────────────────────────────────────────── */

/** @internal — for unit tests only. */
export function __setLoader(fn: LoaderFn | null): void {
  activeLoader = fn ?? defaultLoader
  flatCache.clear()
  nestedCache.clear()
}

/** @internal — for unit tests only. */
export function __resetCache(): void {
  flatCache.clear()
  nestedCache.clear()
}
