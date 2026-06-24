import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveForLocale,
  resolveForLocaleAsync,
  resolveAllLocales,
  resolveAllLocalesAsync,
  preloadAllLocales,
  getNestedBundle,
} from '../ai-utils.js'
import { __setLoader, __resetCache } from '../loader.js'
import type { SupportedLocale, MessageBundle } from '../types.js'

const FIXTURE: Record<SupportedLocale, MessageBundle> = {
  en: { greeting: 'Hello {name}', only_en: 'EN-only' },
  'zh-CN': { greeting: '你好 {name}' },
  'zh-Hant': { greeting: '你好 {name}（繁）' },
  ar: { greeting: 'مرحبا {name}' },
  de: { greeting: 'Hallo {name}' },
  es: { greeting: 'Hola {name}' },
  fr: { greeting: 'Bonjour {name}' },
  hi: { greeting: 'नमस्ते {name}' },
  ja: { greeting: 'こんにちは {name}' },
  ko: { greeting: '안녕 {name}' },
  pt: { greeting: 'Olá {name}' },
  ru: { greeting: 'Привет {name}' },
}

beforeEach(() => {
  __resetCache()
  __setLoader(async (loc) => FIXTURE[loc])
})

describe('resolveForLocale (sync)', () => {
  it('returns the literal key when the bundle has not been loaded', () => {
    expect(resolveForLocale('greeting', 'ja')).toBe('greeting')
  })

  it('resolves after the bundle is loaded', async () => {
    await preloadAllLocales()
    expect(resolveForLocale('greeting', 'ja', { name: '太郎' })).toBe('こんにちは 太郎')
  })

  it('falls back to English when key missing in target locale', async () => {
    await preloadAllLocales()
    expect(resolveForLocale('only_en', 'ja')).toBe('EN-only')
  })

  it('returns the key when missing in both target and English', async () => {
    await preloadAllLocales()
    expect(resolveForLocale('does.not.exist', 'ja')).toBe('does.not.exist')
  })
})

describe('resolveForLocaleAsync', () => {
  it('loads the bundle then resolves', async () => {
    expect(peekIsLoaded('de')).toBe(false)
    const out = await resolveForLocaleAsync('greeting', 'de', { name: 'Anna' })
    expect(out).toBe('Hallo Anna')
    expect(peekIsLoaded('de')).toBe(true)
  })
})

describe('resolveAllLocales', () => {
  it('returns 12 entries in declared order', async () => {
    await preloadAllLocales()
    const out = resolveAllLocales('greeting', { name: 'Ada' })
    expect(out).toHaveLength(12)
    // First entry is English (declared order), last entry is Russian
    expect(out[0]).toBe('Hello Ada')
    expect(out[out.length - 1]).toBe('Привет Ada')
  })

  it('uses English fallback for locales missing the key', async () => {
    await preloadAllLocales()
    const out = resolveAllLocales('only_en')
    // Every entry resolves to EN-only via fallback
    expect(out.every((s) => s === 'EN-only')).toBe(true)
  })
})

describe('resolveAllLocalesAsync', () => {
  it('preloads all locales before resolving', async () => {
    const out = await resolveAllLocalesAsync('greeting', { name: 'Z' })
    expect(out).toHaveLength(12)
    expect(out).toContain('Hello Z')
    expect(out).toContain('你好 Z')
  })
})

describe('getNestedBundle', () => {
  it('returns undefined before load', () => {
    expect(getNestedBundle('fr')).toBeUndefined()
  })

  it('returns the nested form after load', async () => {
    await preloadAllLocales()
    expect(getNestedBundle('fr')).toEqual(FIXTURE.fr)
  })
})

/* Local helper: check loader cache hit without importing internal peek. */
import { peekBundle } from '../loader.js'
function peekIsLoaded(loc: SupportedLocale): boolean {
  return peekBundle(loc) !== undefined
}
