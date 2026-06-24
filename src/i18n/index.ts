/**
 * Public API for the Moraya unified i18n module.
 *
 * Imported as `@moraya/core/i18n` once `package.json` / `tsup.config.ts` are
 * wired (Phase 1c). Designed to be lifted into a standalone `@moraya/i18n`
 * package with a path-only rename — see plan v0.96.0.
 *
 * Framework coupling: NONE in this module. The `locale` export is a custom
 * `Readable<T>` whose `subscribe` signature is compatible with Svelte's
 * `Readable<T>`, so a Svelte consumer can pass it straight into `derived()`
 * without wrapping. See `consumer-svelte-shim` example in the iteration doc.
 */

import type { FlatMessages, PersistenceAdapter, SupportedLocale, LocaleSelection } from './types.js'
import { interpolate, lookup } from './messages.js'
import { applyDocumentDirection, detectSystemLocale } from './detect.js'
import { loadBundle, peekBundle } from './loader.js'
import { createWritable, asReadable, type Readable } from './store.js'

/* ─────────────────────────────────────────────────────────────────────────
 * Internal state — single-process / per-bundle singleton. Consumers expect
 * one active locale at a time per host. (PC: Tauri webview; Web: each tab.)
 * ────────────────────────────────────────────────────────────────────── */

const localeStore = createWritable<SupportedLocale>('en')
let activeMessages: FlatMessages = {}
let englishFallback: FlatMessages = {}

/** Read-only view of the active locale. Compatible with Svelte's `Readable`. */
export const locale: Readable<SupportedLocale> = asReadable(localeStore)

/* ─────────────────────────────────────────────────────────────────────────
 * Translation lookup.
 *
 * Plain function (not a derived store) — this keeps the package framework-
 * agnostic. Svelte consumers that want auto re-render on locale change wrap
 * `t` in a `derived` store inside their thin shim (see iteration doc). Non-
 * Svelte consumers just call `t('foo.bar')` synchronously.
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Translate a flat dot-joined key. Falls back to English, then to the literal
 * key (so missing translations are visible in dev).
 */
export function t(key: string, vars?: Record<string, string>): string {
  return interpolate(lookup(key, activeMessages, englishFallback), vars)
}

/* ─────────────────────────────────────────────────────────────────────────
 * Locale switching + initialization.
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Switch the active locale. Loads the bundle on demand (memoized), updates
 * the active-messages map, applies document direction (for RTL), and notifies
 * subscribers of the `locale` store.
 *
 * If the bundle fails to load (e.g. network error in a future remote-locale
 * mode), the active locale is updated anyway so the UI doesn't get stuck —
 * but translations will fall through to English / key.
 */
export async function setLocale(loc: SupportedLocale): Promise<void> {
  try {
    const messages = await loadBundle(loc)
    activeMessages = messages
  } catch {
    // Bundle load failed — keep prior messages but still flip the locale so
    // RTL direction + subscribers stay accurate.
  }
  // Always keep English in the fallback slot, loaded lazily.
  if (loc !== 'en' && Object.keys(englishFallback).length === 0) {
    try {
      englishFallback = await loadBundle('en')
    } catch { /* fallback unavailable — accept */ }
  } else if (loc === 'en') {
    englishFallback = activeMessages
  }
  localeStore.setIfChanged(loc)
  applyDocumentDirection(loc)
}

/**
 * Options for `initLocale`. All fields are optional:
 *   - `preferred`: explicit user choice. Wins over persisted + detected.
 *   - `persistence`: read/write hooks for remembering the user's choice.
 *     Pass localStorage-backed callbacks on web, Tauri plugin-store on PC.
 */
export interface InitLocaleOptions {
  preferred?: LocaleSelection | null
  persistence?: PersistenceAdapter
}

/**
 * Bootstrap the i18n module: resolve which locale to use, load its bundle,
 * set it active. Resolution order:
 *
 *   1. `opts.preferred` if it names a concrete locale (not `'system'`)
 *   2. `opts.persistence.get()` if it returns a concrete locale
 *   3. `detectSystemLocale()` (navigator-based fallback)
 *
 * The chosen locale is `await setLocale(...)` so the active messages are
 * loaded before this Promise resolves. Safe to call multiple times — each
 * call simply re-runs the resolution.
 */
export async function initLocale(opts: InitLocaleOptions = {}): Promise<void> {
  const persisted = opts.persistence ? await opts.persistence.get() : null

  const chosen: SupportedLocale =
    (opts.preferred && opts.preferred !== 'system' ? opts.preferred : null)
    ?? (persisted && persisted !== 'system' ? persisted : null)
    ?? detectSystemLocale()

  await setLocale(chosen)

  if (opts.persistence && opts.preferred && opts.preferred !== 'system') {
    // Caller asserted a preference at init — write it through.
    await opts.persistence.set(opts.preferred)
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Re-exports for the public surface.
 * ────────────────────────────────────────────────────────────────────── */

export {
  detectSystemLocale,
  isRTL,
  applyDocumentDirection,
} from './detect.js'

export {
  resolveForLocale,
  resolveForLocaleAsync,
  resolveAllLocales,
  resolveAllLocalesAsync,
  preloadAllLocales,
  getNestedBundle,
} from './ai-utils.js'

export {
  flattenMessages,
  interpolate,
  lookup,
  mergeBundles,
} from './messages.js'

export {
  loadBundle,
  peekBundle,
  preloadBundles,
} from './loader.js'

export {
  type Readable,
  type Subscriber,
  type Unsubscriber,
} from './store.js'

export {
  type SupportedLocale,
  type LocaleSelection,
  type LocaleOption,
  type MessageBundle,
  type FlatMessages,
  type PersistenceAdapter,
  SUPPORTED_LOCALES,
  RTL_LOCALES,
} from './types.js'

/* ─────────────────────────────────────────────────────────────────────────
 * Test-only injection points. Intentionally not part of the public type
 * surface (they're stripped from .d.ts via the @internal marker). Used by
 * unit tests in `__tests__/` to install fixture loaders.
 * ────────────────────────────────────────────────────────────────────── */

/** @internal */
export { __setLoader, __resetCache } from './loader.js'

/** @internal — reset the active-locale state. Tests only. */
export function __resetState(): void {
  activeMessages = {}
  englishFallback = {}
  localeStore.setIfChanged('en')
}
