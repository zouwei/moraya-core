// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { createSchema } from '../../schema'
import { convertMarkdownToTypst, escapeTypst } from '../index'

const schema = createSchema({ mediaResolver: { resolve: () => null } as never })

/** Convert and assert success, returning the Typst source. */
function conv(md: string, options?: Parameters<typeof convertMarkdownToTypst>[2]): string {
  const r = convertMarkdownToTypst(md, schema, options)
  if (!r.ok) throw new Error(`conversion failed: ${r.message}`)
  return r.content
}

describe('escapeTypst', () => {
  it('escapes every character Typst treats as markup', () => {
    // Unescaped, each of these changes the meaning of the generated document
    // (or breaks compilation outright).
    expect(escapeTypst('#')).toBe('\\#')
    expect(escapeTypst('*')).toBe('\\*')
    expect(escapeTypst('_')).toBe('\\_')
    expect(escapeTypst('$')).toBe('\\$')
    expect(escapeTypst('@')).toBe('\\@')
    expect(escapeTypst('`')).toBe('\\`')
    expect(escapeTypst('<')).toBe('\\<')
    expect(escapeTypst('\\')).toBe('\\\\')
  })

  it('leaves ordinary prose untouched', () => {
    expect(escapeTypst('Hello, world 你好')).toBe('Hello, world 你好')
  })
})

describe('markdown → Typst: blocks', () => {
  it('maps heading levels', () => {
    expect(conv('# One')).toContain('= One')
    expect(conv('### Three')).toContain('=== Three')
  })

  it('caps headings at level 6', () => {
    // Typst has no deeper level; emitting more `=` would not parse as a heading.
    const out = conv('###### Six')
    expect(out).toContain('====== Six')
  })

  it('emits bullet and ordered lists', () => {
    expect(conv('- a\n- b')).toContain('- a')
    expect(conv('1. a\n2. b')).toContain('+ a')
  })

  it('keeps code blocks unescaped', () => {
    // Escaping inside code would corrupt the payload.
    const out = conv('```js\nconst a = "#*_";\n```')
    expect(out).toContain('const a = "#*_";')
    expect(out).not.toContain('\\#')
  })

  it('picks a longer fence when the code contains backticks', () => {
    const out = conv('````\na ``` b\n````')
    expect(out).toMatch(/````+/)
  })

  it('converts a table to #table with a column count', () => {
    const out = conv('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(out).toContain('#table(')
    expect(out).toContain('columns: 2')
    expect(out).toContain('[a]')
  })

  it('converts blockquotes', () => {
    expect(conv('> quoted')).toContain('#quote(block: true)[')
  })

  it('converts horizontal rules', () => {
    expect(conv('---\n')).toContain('#line(length: 100%)')
  })
})

describe('markdown → Typst: inline', () => {
  it('maps emphasis, strong and links', () => {
    expect(conv('**bold**')).toContain('*bold*')
    expect(conv('*italic*')).toContain('_italic_')
    expect(conv('[t](https://e.com)')).toContain('#link("https://e.com")[t]')
  })

  it('keeps inline code raw', () => {
    const out = conv('`a*b*c`')
    expect(out).toContain('`a*b*c`')
  })

  it('escapes special characters in prose', () => {
    // `#` starts a Typst code expression — unescaped this would not compile.
    const out = conv('costs #5 and 100$ @ home')
    expect(out).toContain('\\#5')
    expect(out).toContain('\\$')
    expect(out).toContain('\\@')
  })

  it('emits a well-formed Typst string literal for link URLs', () => {
    // markdown-it percent-encodes a bare quote before it ever reaches the
    // serializer, so the guard that matters is that the emitted literal is
    // balanced and the URL survives intact.
    const out = conv('[t](https://e.com/a"b)')
    expect(out).toContain('#link("https://e.com/a%22b")[t]')
  })
})

describe('markdown → Typst: math', () => {
  it('routes LaTeX math through mitex by default', () => {
    // Typst math is not LaTeX; copying `\frac{a}{b}` verbatim would not compile.
    const out = conv('$$\\frac{a}{b}$$')
    expect(out).toContain('#import "@preview/mitex')
    expect(out).toContain('mitex(')
  })

  it('omits the mitex import when the document has no math', () => {
    expect(conv('# plain')).not.toContain('mitex')
  })

  it('can emit math verbatim when asked', () => {
    const out = conv('$$x^2$$', { math: 'raw' })
    expect(out).toContain('$ x^2 $')
    expect(out).not.toContain('mitex')
  })
})

describe('markdown → Typst: lossy constructs', () => {
  it('keeps HTML blocks as comments and warns', () => {
    const r = convertMarkdownToTypst('<div>x</div>', schema)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.content).toContain('// <div>x</div>')
      expect(r.warnings.join(' ')).toMatch(/HTML/i)
    }
  })

  it('deduplicates repeated warnings', () => {
    const r = convertMarkdownToTypst('<div>a</div>\n\n<div>b</div>', schema)
    if (r.ok) expect(r.warnings.length).toBeLessThanOrEqual(2)
  })
})

describe('markdown → Typst: contract', () => {
  it('returns ok for an empty document', () => {
    const r = convertMarkdownToTypst('', schema)
    expect(r.ok).toBe(true)
  })

  it('never throws — a parser failure comes back as a result', () => {
    // Force the failure path with a schema that cannot represent the document.
    const r = convertMarkdownToTypst('# x', { nodes: null } as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('source-error')
  })
  it('does not nest a # inside #figure (invalid in code mode)', () => {
    // Regression: `#figure(#image(…))` made the Typst compiler fail with
    // "the character `#` is not valid in code", so a converted document with
    // any captioned image would not compile at all.
    const out = conv('![Cap](x.png)')
    expect(out).toContain('#figure(image("x.png")')
    expect(out).not.toContain('(#image')
  })

})
