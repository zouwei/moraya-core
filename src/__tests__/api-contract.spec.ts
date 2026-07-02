// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Public API contract & error handling (v0.60.0-pre §3.2 + §4.5).
 */
import { describe, test, expect } from 'vitest'
import {
  createSchema,
  parseMarkdown,
  parseMarkdownAsync,
  serializeMarkdown,
  createDocCache,
  djb2Hash,
  toggleBold,
  toggleItalic,
  setHeading,
  insertHorizontalRule,
} from '../index'
import { BrowserMediaResolver } from '../adapters/browser-media-resolver'
import {
  NULL_MEDIA_RESOLVER_SENTINEL,
  isNullMediaResolver,
  type NullMediaResolver,
} from '../types'
import { EditorState } from 'prosemirror-state'

describe('createSchema()', () => {
  test('returns a Schema with a real MediaResolver', () => {
    const schema = createSchema({ mediaResolver: new BrowserMediaResolver() })
    expect(schema).toBeDefined()
    expect(schema.nodes.paragraph).toBeDefined()
    expect(schema.marks.strong).toBeDefined()
  })

  test('throws TypeError when mediaResolver is missing', () => {
    expect(() =>
      // @ts-expect-error testing runtime guard
      createSchema({})
    ).toThrow(TypeError)
    expect(() =>
      // @ts-expect-error testing runtime guard
      createSchema(null)
    ).toThrow(TypeError)
  })

  test('throws TypeError when mediaResolver is the internal nullMediaResolver sentinel', () => {
    const evil: NullMediaResolver = {
      [NULL_MEDIA_RESOLVER_SENTINEL]: true,
      async loadLocalImage() {
        return ''
      },
      async loadLocalMedia() {
        return ''
      },
      async loadRemoteMedia(u) {
        return u
      },
    }
    expect(() => createSchema({ mediaResolver: evil })).toThrow(/nullMediaResolver/)
  })

  test('caches schema instances per MediaResolver (WeakMap)', () => {
    const resolver = new BrowserMediaResolver()
    const a = createSchema({ mediaResolver: resolver })
    const b = createSchema({ mediaResolver: resolver })
    expect(a).toBe(b)
  })
})

describe('isNullMediaResolver sentinel detection', () => {
  test('returns true for sentinel-tagged resolver', () => {
    const evil: NullMediaResolver = {
      [NULL_MEDIA_RESOLVER_SENTINEL]: true,
      async loadLocalImage() {
        return ''
      },
      async loadLocalMedia() {
        return ''
      },
      async loadRemoteMedia(u) {
        return u
      },
    }
    expect(isNullMediaResolver(evil)).toBe(true)
  })

  test('returns false for real MediaResolver', () => {
    expect(isNullMediaResolver(new BrowserMediaResolver())).toBe(false)
  })
})

describe('parseMarkdown / serializeMarkdown', () => {
  test('parseMarkdown returns a Doc for valid input', () => {
    const doc = parseMarkdown('# Hello\n')
    expect(doc.type.name).toBe('doc')
    expect(doc.firstChild?.type.name).toBe('heading')
  })

  test('parseMarkdown does NOT throw on malformed input (§4.5)', () => {
    // Garbled / partially-truncated markdown should still produce a doc.
    expect(() => parseMarkdown('### \n[broken')).not.toThrow()
    expect(() => parseMarkdown('')).not.toThrow()
  })

  test('serializeMarkdown does NOT throw on a valid doc', () => {
    const doc = parseMarkdown('# Hello\n')
    expect(() => serializeMarkdown(doc)).not.toThrow()
  })

  test('parseMarkdownAsync resolves (does not reject) for malformed input (§4.5)', async () => {
    await expect(parseMarkdownAsync('### \n[broken')).resolves.toBeDefined()
  })

  test('parseMarkdownAsync handles large input by yielding to event loop', async () => {
    // Construct a 60KB doc (above 50KB threshold).
    const large = '# Title\n\n' + 'paragraph text. '.repeat(4000)
    expect(large.length).toBeGreaterThan(50 * 1024)
    const doc = await parseMarkdownAsync(large)
    expect(doc.type.name).toBe('doc')
  })
})

describe('createDocCache()', () => {
  test('LRU semantics: evicts oldest after exceeding maxEntries', () => {
    const cache = createDocCache(2)
    const d1 = parseMarkdown('A\n')
    const d2 = parseMarkdown('B\n')
    const d3 = parseMarkdown('C\n')
    cache.set(1, d1)
    cache.set(2, d2)
    expect(cache.size).toBe(2)
    cache.set(3, d3)
    expect(cache.size).toBe(2)
    expect(cache.get(1)).toBeUndefined()
    expect(cache.get(2)).toBeDefined()
    expect(cache.get(3)).toBeDefined()
  })

  test('get() touches LRU order (recently-accessed survives eviction)', () => {
    const cache = createDocCache(2)
    cache.set(1, parseMarkdown('A\n'))
    cache.set(2, parseMarkdown('B\n'))
    // Touch 1 → it becomes most-recently-used
    cache.get(1)
    cache.set(3, parseMarkdown('C\n'))
    // 2 should be evicted (oldest), 1 + 3 retained
    expect(cache.get(1)).toBeDefined()
    expect(cache.get(2)).toBeUndefined()
    expect(cache.get(3)).toBeDefined()
  })

  test('clear() empties the cache', () => {
    const cache = createDocCache(5)
    cache.set(1, parseMarkdown('A\n'))
    cache.set(2, parseMarkdown('B\n'))
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get(1)).toBeUndefined()
  })

  test('throws on invalid maxEntries', () => {
    expect(() => createDocCache(0)).toThrow(RangeError)
    expect(() => createDocCache(-1)).toThrow(RangeError)
  })

  test('default maxEntries = 10', () => {
    const cache = createDocCache()
    for (let i = 0; i < 15; i++) {
      cache.set(i, parseMarkdown(`# Doc ${i}\n`))
    }
    expect(cache.size).toBe(10)
  })
})

describe('djb2Hash()', () => {
  test('is deterministic', () => {
    expect(djb2Hash('hello')).toBe(djb2Hash('hello'))
  })

  test('different inputs produce different hashes (high probability)', () => {
    expect(djb2Hash('hello')).not.toBe(djb2Hash('world'))
  })

  test('returns unsigned 32-bit integer', () => {
    const h = djb2Hash('test string')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })

  test('handles empty string', () => {
    expect(djb2Hash('')).toBe(5381)
  })
})

describe('commands', () => {
  test('toggleBold and toggleItalic are functions returning boolean', () => {
    const schema = createSchema({ mediaResolver: new BrowserMediaResolver() })
    const state = EditorState.create({ schema, doc: parseMarkdown('hello\n') })
    // Empty selection → toggle should still be applicable per ProseMirror semantics
    expect(typeof toggleBold(state)).toBe('boolean')
    expect(typeof toggleItalic(state)).toBe('boolean')
  })

  test('setHeading returns a Command for a specific level', () => {
    const cmd = setHeading(2)
    expect(typeof cmd).toBe('function')
    const schema = createSchema({ mediaResolver: new BrowserMediaResolver() })
    const state = EditorState.create({ schema, doc: parseMarkdown('hello\n') })
    expect(typeof cmd(state)).toBe('boolean')
  })

  test('insertHorizontalRule applies a HR replacement', () => {
    const schema = createSchema({ mediaResolver: new BrowserMediaResolver() })
    const state = EditorState.create({ schema, doc: parseMarkdown('a\n') })
    let dispatched = false
    const ok = insertHorizontalRule(state, () => {
      dispatched = true
    })
    expect(ok).toBe(true)
    expect(dispatched).toBe(true)
  })
})
