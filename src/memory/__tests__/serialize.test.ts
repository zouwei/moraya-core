// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import type { MemoryDoc } from '../types'
import {
  MEMORY_DIR,
  memoryDocPath,
  isMemoryDocPath,
  memoryIdFromPath,
  serializeMemoryDoc,
  parseMemoryDoc,
} from '../index'

function makeDoc(overrides: Partial<MemoryDoc> = {}): MemoryDoc {
  return {
    id: 'mem-1',
    kind: 'preference',
    content: 'I prefer concise answers',
    weight: 1,
    sensitivity: 'low',
    status: 'active',
    createdAt: '2026-07-05T12:00:00.000Z',
    lastUsedAt: '2026-07-05T12:30:00.000Z',
    sources: ['explicit:/memorize'],
    preference: { domain: 'communication-style' },
    ...overrides,
  }
}

// ── Path helpers ─────────────────────────────────────────────────────────────

describe('path helpers', () => {
  it('builds the dot-directory path', () => {
    expect(memoryDocPath('abc')).toBe('.moraya/memories/abc.md')
    expect(MEMORY_DIR).toBe('.moraya/memories')
  })

  it('recognizes memory doc paths', () => {
    expect(isMemoryDocPath('.moraya/memories/abc.md')).toBe(true)
    expect(isMemoryDocPath('.moraya/memories/nested/x.md')).toBe(true)
  })

  it('rejects non-memory paths', () => {
    expect(isMemoryDocPath('notes/abc.md')).toBe(false)
    expect(isMemoryDocPath('.claude/CLAUDE.md')).toBe(false) // different namespace
    expect(isMemoryDocPath('.moraya/memories/abc.txt')).toBe(false)
    expect(isMemoryDocPath('.moraya/MEMORY.md')).toBe(false)
  })

  it('extracts the id from a path', () => {
    expect(memoryIdFromPath('.moraya/memories/abc.md')).toBe('abc')
    expect(memoryIdFromPath('notes/abc.md')).toBeNull()
  })
})

// ── Round-trip stability ─────────────────────────────────────────────────────

describe('serialize / parse round-trip', () => {
  it('round-trips a preference memory', () => {
    const doc = makeDoc()
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips a project memory', () => {
    const doc = makeDoc({
      kind: 'project',
      preference: undefined,
      project: { projectName: 'Moraya', activeUntil: '2026-12-31T00:00:00.000Z' },
    })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips a fact memory', () => {
    const doc = makeDoc({
      kind: 'fact',
      preference: undefined,
      fact: { factType: 'role' },
    })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips fixedWeight and multiple sources', () => {
    const doc = makeDoc({ fixedWeight: true, sources: ['explicit:/memorize', 'chat:abc', 'key:stack'] })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('omits fixedWeight when false', () => {
    const doc = makeDoc({ fixedWeight: false })
    const md = serializeMemoryDoc(doc)
    expect(md).not.toContain('fixedWeight')
    // parsed doc has no fixedWeight key
    const parsed = parseMemoryDoc(md)
    expect(parsed).not.toHaveProperty('fixedWeight')
  })

  it('round-trips content with special characters', () => {
    const doc = makeDoc({ content: 'Use "smart quotes": and colons; and\nmultiple\nlines' })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips content that itself contains a frontmatter fence', () => {
    const doc = makeDoc({ content: 'before\n---\nafter' })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips empty content', () => {
    const doc = makeDoc({ content: '' })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips content with leading newline', () => {
    const doc = makeDoc({ content: '\nindented body' })
    expect(parseMemoryDoc(serializeMemoryDoc(doc))).toEqual(doc)
  })

  it('round-trips an id needing quoting', () => {
    const doc = makeDoc({ id: 'weird: id with spaces ' })
    const parsed = parseMemoryDoc(serializeMemoryDoc(doc))
    expect(parsed?.id).toBe('weird: id with spaces ')
  })
})

// ── Tolerant parsing ─────────────────────────────────────────────────────────

describe('parseMemoryDoc tolerance', () => {
  it('fills defaults for missing fields', () => {
    const md = ['---', 'id: x', '---', 'body text'].join('\n')
    const doc = parseMemoryDoc(md)
    expect(doc).toMatchObject({
      id: 'x',
      kind: 'preference',
      content: 'body text',
      weight: 1,
      sensitivity: 'low',
      status: 'active',
      sources: [],
    })
  })

  it('is order-independent in frontmatter', () => {
    const md = ['---', 'kind: fact', 'status: active', 'id: y', 'weight: 0.5', '---', 'z'].join('\n')
    const doc = parseMemoryDoc(md)
    expect(doc?.id).toBe('y')
    expect(doc?.kind).toBe('fact')
    expect(doc?.weight).toBe(0.5)
  })

  it('coerces invalid enum values to safe defaults', () => {
    const md = ['---', 'id: x', 'kind: bogus', 'status: nope', 'sensitivity: extreme', '---', 'b'].join('\n')
    const doc = parseMemoryDoc(md)
    expect(doc?.kind).toBe('preference')
    expect(doc?.status).toBe('active')
    expect(doc?.sensitivity).toBe('low')
  })

  it('treats a file with no frontmatter as content when given a fallback id', () => {
    const doc = parseMemoryDoc('just some hand-written text', 'fallback-1')
    expect(doc).toMatchObject({ id: 'fallback-1', content: 'just some hand-written text' })
  })

  it('returns null when there is no id to anchor to', () => {
    expect(parseMemoryDoc('no frontmatter, no id')).toBeNull()
    expect(parseMemoryDoc(['---', 'kind: fact', '---', 'body'].join('\n'))).toBeNull()
  })

  it('uses fallback id when frontmatter lacks one', () => {
    const md = ['---', 'kind: fact', '---', 'body'].join('\n')
    expect(parseMemoryDoc(md, 'fb')?.id).toBe('fb')
  })

  it('ignores malformed sources / nested objects', () => {
    const md = ['---', 'id: x', 'sources: not-json', 'preference: also-not-json', '---', 'b'].join('\n')
    const doc = parseMemoryDoc(md)
    expect(doc?.sources).toEqual([])
    expect(doc?.preference).toBeUndefined()
  })

  it('coerces an invalid factType to other', () => {
    const md = ['---', 'id: x', 'kind: fact', 'fact: {"factType":"bogus"}', '---', 'b'].join('\n')
    expect(parseMemoryDoc(md)?.fact?.factType).toBe('other')
  })
})
