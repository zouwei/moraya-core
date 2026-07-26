// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { extractTypstOutline } from '../outline'

/** Levels and texts, the shape an outline panel actually renders. */
function outline(source: string) {
  return extractTypstOutline(source).map((h) => `${h.level}:${h.text}`)
}

describe('extractTypstOutline — what counts as a heading', () => {
  // Every case in this block was checked against `typst query heading` on the
  // real binary; the compiler's answer is the specification.
  const SOURCE = [
    '= Top level',
    'Some text.',
    '',
    '  == Indented two spaces',
    '',
    '=== With label <lbl>',
    '',
    '=Not a heading (no space)',
    '',
    'Text with = in the middle',
    '',
    '```',
    '= Inside raw block',
    '```',
    '',
    '`= inline raw`',
    '',
    '// = In a line comment',
    '',
    '/* == In a block comment */',
    '',
    '#heading[Function form]',
    '',
    '#heading(level: 3)[Function with level]',
  ].join('\n')

  it('matches the compiler exactly', () => {
    expect(outline(SOURCE)).toEqual([
      '1:Top level',
      '2:Indented two spaces',
      '3:With label',
      '1:Function form',
      '3:Function with level',
    ])
  })

  it('reads an indented heading — Typst does not require column 0', () => {
    expect(outline('   === Deep')).toEqual(['3:Deep'])
  })

  it('requires the space after the equals signs', () => {
    expect(outline('=Nope')).toEqual([])
    expect(outline('=')).toEqual([])
  })

  it('stops at six levels', () => {
    expect(outline('====== Six')).toEqual(['6:Six'])
    expect(outline('======= Seven')).toEqual([])
  })

  it('ignores an equals sign inside math or code', () => {
    expect(outline('$ a = b $')).toEqual([])
    expect(outline('#let x = 1')).toEqual([])
  })

  it('closes a raw block so later headings still count', () => {
    expect(outline('```\n= hidden\n```\n\n= visible')).toEqual(['1:visible'])
  })

  it('handles a multi-line block comment', () => {
    expect(outline('/*\n= hidden\n*/\n= visible')).toEqual(['1:visible'])
  })
})

describe('extractTypstOutline — heading text', () => {
  it('strips the trailing label', () => {
    expect(outline('= Basics <basics>')).toEqual(['1:Basics'])
  })

  it('keeps a less-than sign that is not a label', () => {
    expect(outline('= a < b')).toEqual(['1:a < b'])
  })

  it('unwraps inline markup', () => {
    expect(outline('= *Bold* and _italic_')).toEqual(['1:Bold and italic'])
  })

  it('keeps link text, drops the url', () => {
    expect(outline('= See #link("https://e.com")[the docs]')).toEqual(['1:See the docs'])
  })

  it('does not read the // in a URL as a comment', () => {
    // A heading linking anywhere would otherwise lose everything after `https:`.
    expect(outline('= A #link("https://e.com")[b] and more')).toEqual(['1:A b and more'])
  })

  it('keeps an inline raw span in the text', () => {
    // Blanking it is only a detection device; the reader should still see it.
    expect(outline('== A `= not a heading` B')).toEqual(['2:A `= not a heading` B'])
  })

  it('leaves math as written', () => {
    // `$x^2$` reads better in a narrow panel than any flattening of it.
    expect(outline('= Proof of $x^2$')).toEqual(['1:Proof of $x^2$'])
  })

  it('undoes escapes', () => {
    expect(outline('= 100\\# of them')).toEqual(['1:100# of them'])
  })

  it('skips a heading with no text left', () => {
    expect(outline('= <only-a-label>')).toEqual([])
  })
})

describe('extractTypstOutline — positions', () => {
  it('records the source line of each heading', () => {
    const heads = extractTypstOutline('intro\n\n= One\ntext\n\n== Two')
    expect(heads.map((h) => h.line)).toEqual([2, 5])
  })

  it('records the character offset of the line start', () => {
    const source = 'ab\n= One'
    const heads = extractTypstOutline(source)
    expect(heads[0]?.offset).toBe(3)
    expect(source.slice(heads[0]!.offset)).toBe('= One')
  })

  it('gives every heading a distinct id', () => {
    const heads = extractTypstOutline('= A\n= A\n= A')
    expect(new Set(heads.map((h) => h.id)).size).toBe(3)
  })
})

describe('extractTypstOutline — numbering', () => {
  // The expected strings below are the real binary's output for the same
  // document, captured via `numbering(it.numbering, ..counter(heading)…)`.
  const DOC = '= A\n== A1\n=== A11\n== A2\n= B'
  const numbers = (pattern: string) =>
    extractTypstOutline(`#set heading(numbering: "${pattern}")\n${DOC}`).map((h) => h.number)

  it('formats "1." the way Typst does', () => {
    expect(numbers('1.')).toEqual(['1.', '1.1.', '1.1.1.', '1.2.', '2.'])
  })

  it('formats "1.1" the way Typst does', () => {
    // Note the absent trailing separator — this pattern has no suffix.
    expect(numbers('1.1')).toEqual(['1', '1.1', '1.1.1', '1.2', '2'])
  })

  it('formats "I.a)" the way Typst does', () => {
    expect(numbers('I.a)')).toEqual(['I)', 'I.a)', 'I.a.a)', 'I.b)', 'II)'])
  })

  it('formats "A-1" the way Typst does', () => {
    expect(numbers('A-1')).toEqual(['A', 'A-1', 'A-1-1', 'A-2', 'B'])
  })

  it('uses the suffix as separator when the last piece has no prefix', () => {
    // "1)" → 1)1) but "§1." → §1§1. — the asymmetry is Typst's, not a bug.
    expect(numbers('1)')).toEqual(['1)', '1)1)', '1)1)1)', '1)2)', '2)'])
    expect(numbers('§1.')).toEqual(['§1.', '§1§1.', '§1§1§1.', '§1§2.', '§2.'])
  })

  it('leaves an unnumbered document unnumbered', () => {
    // Growing numbers the pages do not have would misrepresent the document.
    expect(extractTypstOutline(DOC).every((h) => h.number === undefined)).toBe(true)
  })

  it('restarts a deeper counter under each parent', () => {
    const heads = extractTypstOutline('#set heading(numbering: "1.1")\n= A\n== A1\n= B\n== B1')
    expect(heads.map((h) => h.number)).toEqual(['1', '1.1', '2', '2.1'])
  })

  it('skips levels without crashing', () => {
    const heads = extractTypstOutline('#set heading(numbering: "1.1")\n=== Deep first')
    expect(heads[0]?.number).toBe('0.0.1')
  })
})

describe('extractTypstOutline — contract', () => {
  it('returns nothing for an empty document', () => {
    expect(extractTypstOutline('')).toEqual([])
  })

  it('handles a document with no headings', () => {
    expect(extractTypstOutline('just some prose\n\nand more')).toEqual([])
  })
})
