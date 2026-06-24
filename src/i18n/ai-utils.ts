/**
 * AI-prompt helpers. Originally lived in `moraya/src/lib/i18n/i18n.ts` — used
 * when an AI conversation runs in a locale different from the active UI
 * locale, or when matching user-generated data that could be in any locale.
 *
 * Both helpers require the relevant locale bundles to already be loaded.
 * Callers should `await preloadAllLocales()` once at app boot before relying
 * on the sync read.
 */

import type { FlatMessages, SupportedLocale } from './types.js'
import { interpolate, lookup, flattenMessages } from './messages.js'
import { loadBundle, peekBundle, peekNested, preloadBundles } from './loader.js'

const ALL_LOCALES: readonly SupportedLocale[] = [
  'en', 'zh-CN', 'zh-Hant',
  'ar', 'de', 'es', 'fr', 'hi', 'ja', 'ko', 'pt', 'ru',
] as const

/**
 * Force every supported locale's bundle into the cache. Call once at boot if
 * the app expects to use `resolveForLocale` / `resolveAllLocales` sync.
 */
export async function preloadAllLocales(): Promise<void> {
  await preloadBundles(ALL_LOCALES)
}

/**
 * Sync lookup against a specific (non-active) locale's bundle. Returns the
 * key itself if the locale isn't loaded yet — call `preloadAllLocales()` (or
 * `loadBundle(loc)`) first if you need real translations.
 */
export function resolveForLocale(
  key: string,
  loc: SupportedLocale,
  vars?: Record<string, string>,
): string {
  const bundle = peekBundle(loc)
  const fallback = peekBundle('en')
  if (!bundle) {
    // Bundle not loaded — last-ditch: try English fallback then key
    if (fallback) return interpolate(lookup(key, fallback), vars)
    return key
  }
  return interpolate(lookup(key, bundle, fallback), vars)
}

/**
 * Async variant: ensures the requested locale is loaded before resolving.
 * Preferred when the caller is already in an async path (workflow steps,
 * AI prompt generation, etc.).
 */
export async function resolveForLocaleAsync(
  key: string,
  loc: SupportedLocale,
  vars?: Record<string, string>,
): Promise<string> {
  await loadBundle(loc)
  if (loc !== 'en') await loadBundle('en')
  return resolveForLocale(key, loc, vars)
}

/**
 * Sync: returns one translation per supported locale, in `ALL_LOCALES` order.
 * Locales whose bundle isn't loaded yet contribute the key itself — meaning a
 * pre-load is essential before relying on this for pattern matching.
 *
 * Use case: matching user-generated speaker names like "Passerby 1" /
 * "路人 1" / "通行人 1" across 12 locales — the caller takes the union of
 * all returned strings as a regex alternation source.
 */
export function resolveAllLocales(
  key: string,
  vars?: Record<string, string>,
): string[] {
  return ALL_LOCALES.map((loc) => resolveForLocale(key, loc, vars))
}

/** Async variant — loads every locale first, then resolves. */
export async function resolveAllLocalesAsync(
  key: string,
  vars?: Record<string, string>,
): Promise<string[]> {
  await preloadAllLocales()
  return resolveAllLocales(key, vars)
}

/**
 * Escape hatch for tests / advanced consumers: returns the cached nested
 * bundle for a locale (read-only). Returns `undefined` if not loaded.
 * Most callers should NOT need this — prefer `resolveForLocale`.
 */
export function getNestedBundle(loc: SupportedLocale) {
  return peekNested(loc)
}

/** Re-exported for callers that need to flatten an arbitrary bundle. */
export { flattenMessages }
