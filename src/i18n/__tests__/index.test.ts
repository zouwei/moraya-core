import { describe, it, expect, beforeEach } from 'vitest'
import {
  t,
  locale,
  setLocale,
  initLocale,
  __setLoader,
  __resetCache,
  __resetState,
  type PersistenceAdapter,
  type LocaleSelection,
} from '../index.js'
import type { MessageBundle, SupportedLocale } from '../types.js'

const FIXTURE: Record<SupportedLocale, MessageBundle> = {
  en: {
    app: { name: 'Moraya' },
    greeting: 'Hello {name}',
    only_en: 'EN-only',
  },
  'zh-CN': {
    app: { name: 'Moraya' },
    greeting: '你好 {name}',
  },
  'zh-Hant': { greeting: '你好（繁）{name}' },
  ar: { greeting: 'مرحبا' },
  de: { greeting: 'Hallo' },
  es: { greeting: 'Hola' },
  fr: { greeting: 'Bonjour' },
  hi: { greeting: 'नमस्ते' },
  ja: { greeting: 'こんにちは' },
  ko: { greeting: '안녕' },
  pt: { greeting: 'Olá' },
  ru: { greeting: 'Привет' },
}

beforeEach(() => {
  __resetCache()
  __resetState()
  __setLoader(async (loc) => FIXTURE[loc])
})

describe('t() before any setLocale', () => {
  it('returns the key (no bundle loaded yet)', () => {
    expect(t('greeting')).toBe('greeting')
  })
})

describe('t() after setLocale', () => {
  it('returns the active-locale translation', async () => {
    await setLocale('zh-CN')
    expect(t('greeting', { name: '小明' })).toBe('你好 小明')
  })

  it('falls back to English for keys missing in active locale', async () => {
    await setLocale('zh-CN')
    expect(t('only_en')).toBe('EN-only')
  })

  it('returns the literal key when both active and English miss', async () => {
    await setLocale('en')
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('handles nested keys via dot-notation', async () => {
    await setLocale('en')
    expect(t('app.name')).toBe('Moraya')
  })
})

describe('setLocale', () => {
  it('updates the locale store', async () => {
    let observed: SupportedLocale | undefined
    const unsub = locale.subscribe((v) => { observed = v })
    await setLocale('fr')
    expect(observed).toBe('fr')
    unsub()
  })

  it('switching locales swaps the active messages', async () => {
    await setLocale('zh-CN')
    expect(t('greeting', { name: 'A' })).toBe('你好 A')
    await setLocale('ja')
    // ja fixture has 'greeting' without {name}; interpolate leaves it bare
    expect(t('greeting')).toBe('こんにちは')
  })
})

describe('initLocale', () => {
  it('uses explicit preferred when provided', async () => {
    await initLocale({ preferred: 'de' })
    expect(t('greeting')).toBe('Hallo')
  })

  it('uses persistence.get() when no preferred', async () => {
    const persistence: PersistenceAdapter = {
      get: () => 'ko' as LocaleSelection,
      set: () => { /* noop */ },
    }
    await initLocale({ persistence })
    expect(t('greeting')).toBe('안녕')
  })

  it('writes through to persistence when preferred is set', async () => {
    let written: LocaleSelection | null = null
    const persistence: PersistenceAdapter = {
      get: () => null,
      set: (v) => { written = v },
    }
    await initLocale({ preferred: 'fr', persistence })
    expect(written).toBe('fr')
  })

  it('falls through to detectSystemLocale when no preferred / persisted', async () => {
    // Stub navigator → en
    const original = (globalThis as { navigator?: unknown }).navigator
    ;(globalThis as { navigator?: unknown }).navigator = { language: 'en-US' }
    await initLocale()
    expect(t('greeting')).toBe('Hello {name}')
    ;(globalThis as { navigator?: unknown }).navigator = original
  })

  it("treats persisted 'system' as no-preference", async () => {
    const persistence: PersistenceAdapter = {
      get: () => 'system',
      set: () => { /* noop */ },
    }
    const original = (globalThis as { navigator?: unknown }).navigator
    ;(globalThis as { navigator?: unknown }).navigator = { language: 'es-ES' }
    await initLocale({ persistence })
    expect(t('greeting')).toBe('Hola')
    ;(globalThis as { navigator?: unknown }).navigator = original
  })

  it('supports async persistence.get()', async () => {
    const persistence: PersistenceAdapter = {
      get: async () => 'pt' as LocaleSelection,
      set: () => { /* noop */ },
    }
    await initLocale({ persistence })
    expect(t('greeting')).toBe('Olá')
  })
})
