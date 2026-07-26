// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { tokenizeTypst, typstTokenClass, type TypstTokenType } from '../highlight'

/** Collect the [type, text] pairs a source produces, for readable assertions. */
function spans(src: string): Array<[TypstTokenType, string]> {
  return tokenizeTypst(src).map((t) => [t.type, src.slice(t.start, t.end)])
}

/** True when some token of `type` covers exactly `text`. */
function has(src: string, type: TypstTokenType, text: string): boolean {
  return spans(src).some(([t, s]) => t === type && s === text)
}

describe('tokenizeTypst — comments', () => {
  it('tokenizes line comments to end of line', () => {
    expect(has('// note\n= H', 'comment', '// note')).toBe(true)
  })

  it('tokenizes block comments, including nested ones', () => {
    // Typst block comments nest; stopping at the first `*/` would leak.
    expect(has('/* a /* b */ c */ x', 'comment', '/* a /* b */ c */')).toBe(true)
  })
})

describe('tokenizeTypst — markup', () => {
  it('tokenizes headings by level', () => {
    expect(has('= Title', 'heading', '= Title')).toBe(true)
    expect(has('== Sub', 'heading', '== Sub')).toBe(true)
  })

  it('does not treat a mid-line = as a heading', () => {
    expect(spans('a = b').some(([t]) => t === 'heading')).toBe(false)
  })

  it('tokenizes list markers', () => {
    expect(has('- item', 'listMarker', '-')).toBe(true)
    expect(has('+ item', 'listMarker', '+')).toBe(true)
    expect(has('1. item', 'listMarker', '1.')).toBe(true)
  })

  it('keeps list markers recognizable when indented', () => {
    expect(has('  - nested', 'listMarker', '-')).toBe(true)
  })

  it('tokenizes strong and emphasis', () => {
    expect(has('*bold*', 'strong', '*bold*')).toBe(true)
    expect(has('_em_', 'emph', '_em_')).toBe(true)
  })

  it('does not span emphasis across lines', () => {
    // An unclosed `*` must not swallow the rest of the document.
    expect(spans('*unclosed\nnext line').some(([t]) => t === 'strong')).toBe(false)
  })
})

describe('tokenizeTypst — raw and math', () => {
  it('tokenizes inline raw', () => {
    expect(has('`code`', 'raw', '`code`')).toBe(true)
  })

  it('matches a fence of the same length', () => {
    const src = '```rust\nlet a = 1;\n```'
    expect(has(src, 'raw', src)).toBe(true)
  })

  it('tokenizes math spans', () => {
    expect(has('$x^2$', 'math', '$x^2$')).toBe(true)
  })

  it('does not end math on an escaped dollar', () => {
    expect(has('$a \\$ b$', 'math', '$a \\$ b$')).toBe(true)
  })
})

describe('tokenizeTypst — code mode', () => {
  it('marks #keyword as a keyword and #name as a function', () => {
    expect(has('#let x = 1', 'keyword', '#let')).toBe(true)
    expect(has('#image("a.png")', 'function', '#image')).toBe(true)
  })

  it('tokenizes strings and numbers', () => {
    expect(has('#link("https://e.com")', 'string', '"https://e.com"')).toBe(true)
    expect(has('#line(length: 100%)', 'number', '100%')).toBe(true)
    expect(has('#v(2cm)', 'number', '2cm')).toBe(true)
  })

  it('does not terminate a string on an escaped quote', () => {
    expect(has('#x("a\\"b")', 'string', '"a\\"b"')).toBe(true)
  })
})

describe('tokenizeTypst — labels, refs, escapes', () => {
  it('tokenizes labels and references', () => {
    expect(has('<intro>', 'label', '<intro>')).toBe(true)
    expect(has('see @intro', 'ref', '@intro')).toBe(true)
  })

  it('tokenizes escape sequences', () => {
    expect(has('a \\# b', 'escape', '\\#')).toBe(true)
  })
})

describe('tokenizeTypst — contract', () => {
  it('returns tokens in source order and never overlapping', () => {
    const toks = tokenizeTypst('// c\n= H\n*b* `r` $m$ #let')
    for (let i = 1; i < toks.length; i++) {
      expect(toks[i]!.start).toBeGreaterThanOrEqual(toks[i - 1]!.end)
    }
  })

  it('never produces out-of-range offsets, even on truncated input', () => {
    // Unterminated constructs must clamp rather than run past the end.
    for (const src of ['`unclosed', '$unclosed', '"unclosed', '/* unclosed', '\\']) {
      for (const t of tokenizeTypst(src)) {
        expect(t.start).toBeGreaterThanOrEqual(0)
        expect(t.end).toBeLessThanOrEqual(src.length)
        expect(t.end).toBeGreaterThan(t.start)
      }
    }
  })

  it('handles an empty document', () => {
    expect(tokenizeTypst('')).toEqual([])
  })
})

describe('typstTokenClass', () => {
  it('uses Typst\'s own typ-* convention', () => {
    expect(typstTokenClass('comment')).toBe('typ-comment')
    expect(typstTokenClass('function')).toBe('typ-function')
  })

  it('emits no class for plain text', () => {
    expect(typstTokenClass('text')).toBe('')
  })
})
