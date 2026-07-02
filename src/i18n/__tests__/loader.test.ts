// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadBundle,
  peekBundle,
  preloadBundles,
  __setLoader,
  __resetCache,
} from '../loader.js'
import type { SupportedLocale, MessageBundle } from '../types.js'

describe('loadBundle', () => {
  beforeEach(() => {
    __resetCache()
    __setLoader(null) // back to default — test below replaces it
  })

  it('flattens the bundle returned by the loader', async () => {
    __setLoader(async (loc) => ({
      hello: 'Hello from ' + loc,
      nested: { deep: { leaf: 'L' } },
    }))
    const flat = await loadBundle('en')
    expect(flat).toEqual({
      hello: 'Hello from en',
      'nested.deep.leaf': 'L',
    })
  })

  it('memoizes — second call returns same map without re-invoking loader', async () => {
    let calls = 0
    __setLoader(async () => {
      calls++
      return { x: '1' }
    })
    const a = await loadBundle('en')
    const b = await loadBundle('en')
    expect(calls).toBe(1)
    expect(a).toBe(b) // same reference
  })

  it('loads different locales independently', async () => {
    __setLoader(async (loc) => ({ tag: loc as string }))
    const en = await loadBundle('en')
    const zh = await loadBundle('zh-CN')
    expect(en.tag).toBe('en')
    expect(zh.tag).toBe('zh-CN')
  })
})

describe('peekBundle', () => {
  beforeEach(() => {
    __resetCache()
    __setLoader(async () => ({ a: 'A' }))
  })

  it('returns undefined when locale has not been loaded', () => {
    expect(peekBundle('fr')).toBeUndefined()
  })

  it('returns the cached flat bundle after load', async () => {
    await loadBundle('fr')
    expect(peekBundle('fr')).toEqual({ a: 'A' })
  })
})

describe('preloadBundles', () => {
  beforeEach(() => {
    __resetCache()
  })

  it('loads multiple locales in parallel', async () => {
    const seen: SupportedLocale[] = []
    __setLoader(async (loc): Promise<MessageBundle> => {
      seen.push(loc)
      return { only: loc as string }
    })
    await preloadBundles(['en', 'zh-CN', 'fr'])
    expect(seen.sort()).toEqual(['en', 'fr', 'zh-CN'])
    expect(peekBundle('en')).toEqual({ only: 'en' })
    expect(peekBundle('zh-CN')).toEqual({ only: 'zh-CN' })
    expect(peekBundle('fr')).toEqual({ only: 'fr' })
  })

  it('is idempotent — preloading the same locale twice loads once', async () => {
    let calls = 0
    __setLoader(async () => { calls++; return {} })
    await preloadBundles(['en'])
    await preloadBundles(['en'])
    expect(calls).toBe(1)
  })
})
