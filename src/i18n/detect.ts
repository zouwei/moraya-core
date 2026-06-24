/**
 * Locale detection helpers. Pure / framework-agnostic — uses only standard
 * browser APIs (`navigator.language`) with defensive guards for SSR / Node /
 * environments where `navigator` is absent.
 */

import type { SupportedLocale } from './types.js'
import { RTL_LOCALES } from './types.js'

const PREFIX_MAP: ReadonlyArray<readonly [string, SupportedLocale]> = [
  ['ja', 'ja'],
  ['ko', 'ko'],
  ['ar', 'ar'],
  ['hi', 'hi'],
  ['ru', 'ru'],
  ['de', 'de'],
  ['fr', 'fr'],
  ['es', 'es'],
  ['pt', 'pt'],
]

/**
 * Best-effort guess of the user's preferred locale from the browser /
 * navigator. Returns `'en'` if no match (also when `navigator` is unavailable
 * — SSR, Node, Worker). Chinese is split into `zh-CN` (Simplified) vs
 * `zh-Hant` (Traditional, including TW/HK/MO).
 */
export function detectSystemLocale(): SupportedLocale {
  try {
    const nav = (globalThis as { navigator?: { language?: string; languages?: readonly string[] } }).navigator
    if (!nav) return 'en'
    const lang = nav.language ?? nav.languages?.[0] ?? 'en'

    if (lang.startsWith('zh')) {
      if (/zh-(TW|HK|MO|Hant)/i.test(lang)) return 'zh-Hant'
      return 'zh-CN'
    }
    for (const [prefix, locale] of PREFIX_MAP) {
      if (lang.startsWith(prefix)) return locale
    }
  } catch {
    // navigator unavailable — fall through to 'en'
  }
  return 'en'
}

/** Whether a locale renders right-to-left. */
export function isRTL(loc: SupportedLocale): boolean {
  return RTL_LOCALES.includes(loc)
}

/**
 * Apply the locale's writing direction to `document.documentElement.dir`.
 * No-op if `document` is unavailable (SSR / Worker / Node).
 */
export function applyDocumentDirection(loc: SupportedLocale): void {
  try {
    const doc = (globalThis as { document?: { documentElement: { dir: string } } }).document
    if (doc) doc.documentElement.dir = isRTL(loc) ? 'rtl' : 'ltr'
  } catch {
    // document unavailable — no-op
  }
}
