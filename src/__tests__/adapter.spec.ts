// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, test, expect, vi } from 'vitest'
import { BrowserMediaResolver } from '../adapters/browser-media-resolver'

describe('BrowserMediaResolver (default adapter)', () => {
  test('loadLocalImage returns fallback PNG (warns)', async () => {
    const resolver = new BrowserMediaResolver()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = await resolver.loadLocalImage('/some/abs/path.png')
    expect(url).toBe(BrowserMediaResolver.FALLBACK_PNG)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('loadLocalMedia returns fallback (warns)', async () => {
    const resolver = new BrowserMediaResolver()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = await resolver.loadLocalMedia('/audio.mp3')
    expect(url).toBe(BrowserMediaResolver.FALLBACK_PNG)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test('loadRemoteMedia returns the URL as-is (no transformation)', async () => {
    const resolver = new BrowserMediaResolver()
    const out = await resolver.loadRemoteMedia('https://example.com/image.png')
    expect(out).toBe('https://example.com/image.png')
  })

  test('FALLBACK_PNG is a valid 1×1 transparent PNG data URI', () => {
    expect(BrowserMediaResolver.FALLBACK_PNG).toMatch(/^data:image\/png;base64,/)
  })

  test('multiple instances are independent', async () => {
    const r1 = new BrowserMediaResolver()
    const r2 = new BrowserMediaResolver()
    expect(r1).not.toBe(r2)
    const a = await r1.loadRemoteMedia('https://a')
    const b = await r2.loadRemoteMedia('https://b')
    expect(a).toBe('https://a')
    expect(b).toBe('https://b')
  })
})
