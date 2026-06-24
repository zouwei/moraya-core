import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectSystemLocale, isRTL, applyDocumentDirection } from '../detect.js'

type NavStub = { language?: string; languages?: readonly string[] } | undefined

function stubNav(stub: NavStub) {
  ;(globalThis as { navigator?: NavStub }).navigator = stub
}

describe('detectSystemLocale', () => {
  let original: NavStub

  beforeEach(() => {
    original = (globalThis as { navigator?: NavStub }).navigator
  })
  afterEach(() => {
    ;(globalThis as { navigator?: NavStub }).navigator = original
  })

  it('returns en when navigator is unavailable', () => {
    stubNav(undefined)
    expect(detectSystemLocale()).toBe('en')
  })

  it('returns en for English language code', () => {
    stubNav({ language: 'en-US' })
    expect(detectSystemLocale()).toBe('en')
  })

  it('returns zh-CN for Simplified Chinese variants', () => {
    stubNav({ language: 'zh-CN' })
    expect(detectSystemLocale()).toBe('zh-CN')
    stubNav({ language: 'zh' })
    expect(detectSystemLocale()).toBe('zh-CN')
  })

  it('returns zh-Hant for TW / HK / MO / Hant variants', () => {
    stubNav({ language: 'zh-TW' })
    expect(detectSystemLocale()).toBe('zh-Hant')
    stubNav({ language: 'zh-HK' })
    expect(detectSystemLocale()).toBe('zh-Hant')
    stubNav({ language: 'zh-Hant' })
    expect(detectSystemLocale()).toBe('zh-Hant')
  })

  it('matches Japanese / Korean / Arabic / Hindi / Russian by prefix', () => {
    stubNav({ language: 'ja-JP' });    expect(detectSystemLocale()).toBe('ja')
    stubNav({ language: 'ko-KR' });    expect(detectSystemLocale()).toBe('ko')
    stubNav({ language: 'ar-SA' });    expect(detectSystemLocale()).toBe('ar')
    stubNav({ language: 'hi-IN' });    expect(detectSystemLocale()).toBe('hi')
    stubNav({ language: 'ru-RU' });    expect(detectSystemLocale()).toBe('ru')
  })

  it('matches European languages by prefix', () => {
    stubNav({ language: 'de-DE' });    expect(detectSystemLocale()).toBe('de')
    stubNav({ language: 'fr-CA' });    expect(detectSystemLocale()).toBe('fr')
    stubNav({ language: 'es-MX' });    expect(detectSystemLocale()).toBe('es')
    stubNav({ language: 'pt-BR' });    expect(detectSystemLocale()).toBe('pt')
  })

  it('falls back to en for unknown locales', () => {
    stubNav({ language: 'xx-YY' })
    expect(detectSystemLocale()).toBe('en')
  })

  it('uses languages[0] when language is absent', () => {
    stubNav({ languages: ['ja-JP'] })
    expect(detectSystemLocale()).toBe('ja')
  })
})

describe('isRTL', () => {
  it('returns true only for ar', () => {
    expect(isRTL('ar')).toBe(true)
    expect(isRTL('en')).toBe(false)
    expect(isRTL('zh-CN')).toBe(false)
    expect(isRTL('hi')).toBe(false)
  })
})

describe('applyDocumentDirection', () => {
  it('no-ops when document is unavailable', () => {
    const original = (globalThis as { document?: unknown }).document
    ;(globalThis as { document?: unknown }).document = undefined
    expect(() => applyDocumentDirection('ar')).not.toThrow()
    ;(globalThis as { document?: unknown }).document = original
  })

  it('sets dir=rtl for ar and dir=ltr otherwise', () => {
    const fakeDoc = { documentElement: { dir: '' } }
    const original = (globalThis as { document?: unknown }).document
    ;(globalThis as { document?: unknown }).document = fakeDoc
    applyDocumentDirection('ar')
    expect(fakeDoc.documentElement.dir).toBe('rtl')
    applyDocumentDirection('en')
    expect(fakeDoc.documentElement.dir).toBe('ltr')
    ;(globalThis as { document?: unknown }).document = original
  })
})
