/**
 * Shared i18n type surface.
 *
 * This module MUST stay free of any framework dependency (no svelte, no react,
 * no prosemirror, no markdown-it). It is the contract that consumers — moraya
 * desktop, moraya-web, future @moraya/i18n extraction — all agree on.
 */

export type SupportedLocale =
  | 'en' | 'zh-CN' | 'zh-Hant'
  | 'ar' | 'de' | 'es' | 'fr' | 'hi' | 'ja' | 'ko' | 'pt' | 'ru'

/** Selection a user can make in UI; `'system'` means follow OS / browser locale. */
export type LocaleSelection = SupportedLocale | 'system'

export interface LocaleOption {
  code: LocaleSelection
  /** Native-script label, shown unchanged regardless of active UI locale. */
  label: string
}

/** All 12 locales we support today, in label-alphabetical order. */
export const SUPPORTED_LOCALES: LocaleOption[] = [
  { code: 'system',  label: 'System' },
  { code: 'ar',      label: 'العربية' },
  { code: 'de',      label: 'Deutsch' },
  { code: 'en',      label: 'English' },
  { code: 'es',      label: 'Español' },
  { code: 'fr',      label: 'Français' },
  { code: 'hi',      label: 'हिन्दी' },
  { code: 'ja',      label: '日本語' },
  { code: 'ko',      label: '한국어' },
  { code: 'pt',      label: 'Português' },
  { code: 'ru',      label: 'Русский' },
  { code: 'zh-CN',   label: '简体中文' },
  { code: 'zh-Hant', label: '繁體中文' },
]

/** Locales that render right-to-left. */
export const RTL_LOCALES: readonly SupportedLocale[] = ['ar'] as const

/** A nested locale message bundle as authored in `locales/<loc>.json`. */
export type MessageBundle = { [k: string]: string | MessageBundle }

/** Flat key → string form, produced by `flattenMessages`. */
export type FlatMessages = Record<string, string>

/**
 * Persistence callbacks for `initLocale`. Each consumer wires these to its
 * host environment — Tauri plugin-store for desktop, localStorage for web.
 * Pass `undefined` to skip persistence (locale resets to detected on each load).
 */
export interface PersistenceAdapter {
  get(): LocaleSelection | null | Promise<LocaleSelection | null>
  set(selection: LocaleSelection): void | Promise<void>
}
