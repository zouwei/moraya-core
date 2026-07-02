// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  flattenMessages,
  interpolate,
  lookup,
  mergeBundles,
} from '../messages.js'

describe('flattenMessages', () => {
  it('flattens a one-level nested object', () => {
    expect(flattenMessages({ a: 'A', b: 'B' })).toEqual({ a: 'A', b: 'B' })
  })

  it('joins nested keys with dots', () => {
    expect(flattenMessages({ a: { b: { c: 'leaf' } } })).toEqual({ 'a.b.c': 'leaf' })
  })

  it('handles multiple sibling subtrees', () => {
    const out = flattenMessages({
      settings: { title: 'Settings', ai: { title: 'AI' } },
      tabs: { close: 'Close' },
    })
    expect(out).toEqual({
      'settings.title': 'Settings',
      'settings.ai.title': 'AI',
      'tabs.close': 'Close',
    })
  })

  it('coerces numbers and booleans to strings', () => {
    expect(flattenMessages({ n: 42, b: true })).toEqual({ n: '42', b: 'true' })
  })

  it('drops arrays / null / undefined values silently', () => {
    expect(
      flattenMessages({ ok: 'yes', arr: [1, 2], n: null, u: undefined }),
    ).toEqual({ ok: 'yes' })
  })

  it('returns empty for non-object inputs', () => {
    expect(flattenMessages(null)).toEqual({})
    expect(flattenMessages('string')).toEqual({})
    expect(flattenMessages(42)).toEqual({})
    expect(flattenMessages(undefined)).toEqual({})
  })

  it('does not mutate input', () => {
    const input = { a: { b: 'x' } }
    const clone = JSON.parse(JSON.stringify(input))
    flattenMessages(input)
    expect(input).toEqual(clone)
  })
})

describe('interpolate', () => {
  it('replaces a single placeholder', () => {
    expect(interpolate('Hello {name}', { name: 'Ada' })).toBe('Hello Ada')
  })

  it('replaces multiple placeholders', () => {
    expect(interpolate('{a} + {b} = {c}', { a: '1', b: '2', c: '3' })).toBe('1 + 2 = 3')
  })

  it('leaves unknown placeholders unchanged', () => {
    expect(interpolate('Hi {name}', {})).toBe('Hi {name}')
  })

  it('returns template unchanged when vars is undefined', () => {
    expect(interpolate('{x}')).toBe('{x}')
  })

  it('handles empty string values', () => {
    expect(interpolate('a{x}b', { x: '' })).toBe('ab')
  })

  it('handles repeated placeholders', () => {
    expect(interpolate('{x}/{x}/{x}', { x: 'a' })).toBe('a/a/a')
  })

  it('ignores non-word characters inside braces', () => {
    // Regex is \w+ — punctuation does not form a placeholder
    expect(interpolate('Price: {$amount}')).toBe('Price: {$amount}')
  })
})

describe('lookup', () => {
  const messages = { 'a.b': 'AB', 'a.c': 'AC' }
  const fallback = { 'a.b': 'fallback-AB', 'a.d': 'fallback-AD' }

  it('returns direct match when present', () => {
    expect(lookup('a.b', messages)).toBe('AB')
  })

  it('falls back when primary missing', () => {
    expect(lookup('a.d', messages, fallback)).toBe('fallback-AD')
  })

  it('returns key when neither has it', () => {
    expect(lookup('nope', messages, fallback)).toBe('nope')
  })

  it('works without fallback table', () => {
    expect(lookup('missing', messages)).toBe('missing')
  })

  it('prefers primary even when fallback has the key', () => {
    expect(lookup('a.b', messages, fallback)).toBe('AB')
  })
})

describe('mergeBundles', () => {
  it('shallow-merges flat objects', () => {
    expect(mergeBundles({ a: 'A' }, { b: 'B' })).toEqual({ a: 'A', b: 'B' })
  })

  it('deep-merges nested objects', () => {
    expect(
      mergeBundles({ s: { a: 'A', b: 'B' } }, { s: { b: 'B2', c: 'C' } }),
    ).toEqual({ s: { a: 'A', b: 'B2', c: 'C' } })
  })

  it('overlay wins on leaf conflict', () => {
    expect(mergeBundles({ a: 'base' }, { a: 'overlay' })).toEqual({ a: 'overlay' })
  })

  it('replaces leaf with subtree when overlay has subtree', () => {
    expect(mergeBundles({ a: 'leaf' }, { a: { x: '1' } })).toEqual({ a: { x: '1' } })
  })

  it('does not mutate inputs', () => {
    const base = { s: { a: 'A' } }
    const overlay = { s: { b: 'B' } }
    const out = mergeBundles(base, overlay)
    expect(base).toEqual({ s: { a: 'A' } })
    expect(overlay).toEqual({ s: { b: 'B' } })
    expect(out).toEqual({ s: { a: 'A', b: 'B' } })
  })
})
