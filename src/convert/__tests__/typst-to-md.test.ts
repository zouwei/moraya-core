// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { typstSourceToMarkdown } from '../typst-to-md'
import { convertMarkdownToTypst, convertTypstToMarkdown } from '../index'
import { createSchema } from '../../schema'

/** Convert and return just the markdown, for readable assertions. */
function md(typst: string): string {
  return typstSourceToMarkdown(typst).markdown.trim()
}

describe('typstSourceToMarkdown — blocks', () => {
  it('maps heading levels', () => {
    expect(md('= One')).toBe('# One')
    expect(md('=== Three')).toBe('### Three')
  })

  it('keeps paragraphs separate', () => {
    expect(md('first\n\nsecond')).toBe('first\n\nsecond')
  })

  it('converts bullet and numbered lists', () => {
    expect(md('- a\n- b')).toBe('- a\n- b')
    expect(md('+ a\n+ b')).toBe('1. a\n2. b')
  })

  it('keeps nesting depth', () => {
    const out = md('- a\n  - b')
    expect(out).toBe('- a\n  - b')
  })

  it('restarts numbering for a nested enumeration', () => {
    // A flat counter would emit "3." for the first item of the inner list.
    const out = md('+ a\n  + x\n  + y\n+ b')
    expect(out).toBe('1. a\n  1. x\n  2. y\n2. b')
  })

  it('copies raw blocks through untouched', () => {
    // The fence content is code — rewriting anything inside would corrupt it.
    expect(md('```rust\nlet x = *p;\n```')).toBe('```rust\nlet x = *p;\n```')
  })

  it('converts a block quote', () => {
    expect(md('#quote(block: true)[\n  quoted\n]')).toBe('> quoted')
  })

  it('converts a horizontal rule', () => {
    expect(md('#line(length: 100%)')).toBe('---')
  })

  it('converts display math', () => {
    expect(md('$ x^2 $')).toBe('$$x^2$$')
  })

  it('converts a figure to an image with its caption', () => {
    expect(md('#figure(#image("x.png"), caption: [Cap])')).toBe('![Cap](x.png)')
  })

  it('converts a bare image', () => {
    expect(md('#image("x.png")')).toBe('![](x.png)')
  })
})

describe('typstSourceToMarkdown — tables', () => {
  it('rebuilds rows from the flat cell list', () => {
    const out = md('#table(\n  columns: 2,\n  [a], [b],\n  [1], [2],\n)')
    expect(out).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('pads a short final row', () => {
    // A missing cell would otherwise shift the whole row left.
    const out = md('#table(\n  columns: 2,\n  [a], [b],\n  [1],\n)')
    expect(out).toContain('| 1 |  |')
  })
})

describe('typstSourceToMarkdown — inline', () => {
  it('maps emphasis, strike, code and links', () => {
    expect(md('*bold*')).toBe('**bold**')
    expect(md('_italic_')).toBe('*italic*')
    expect(md('#strike[gone]')).toBe('~~gone~~')
    expect(md('`code`')).toBe('`code`')
    expect(md('#link("https://e.com")[text]')).toBe('[text](https://e.com)')
  })

  it('converts markup nested inside a link', () => {
    expect(md('#link("https://e.com")[*bold*]')).toBe('[**bold**](https://e.com)')
  })

  it('undoes the escapes the forward conversion added', () => {
    expect(md('a \\# b \\* c')).toBe('a # b * c')
  })

  it('leaves an underscore inside a word alone', () => {
    // `snake_case_name` is not emphasis; treating it as such mangles identifiers.
    expect(md('snake_case_name')).toBe('snake_case_name')
  })

  it('does not rewrite markup inside a raw span', () => {
    expect(md('`a *b* c`')).toBe('`a *b* c`')
  })

  it('keeps inline math as-is', () => {
    expect(md('value $x^2$ here')).toBe('value $x^2$ here')
  })

  it('unwraps a mitex formula back to LaTeX', () => {
    // The forward conversion wraps LaTeX in mitex; this is the exact inverse.
    expect(md('#mi("\\\\frac{a}{b}")')).toBe('$\\frac{a}{b}$')
  })

  it('handles a URL containing a bracket', () => {
    const out = md('#link("https://e.com/a(b)")[t]')
    expect(out).toBe('[t](https://e.com/a(b))')
  })
})

describe('typstSourceToMarkdown — code it cannot evaluate', () => {
  it('drops scripting rather than leaking it as text', () => {
    // `#let` only has meaning when the document is run; printing it verbatim
    // would put source code in the user's prose.
    const r = typstSourceToMarkdown('#let x = 1\n\ntext')
    expect(r.markdown.trim()).toBe('text')
    expect(r.warnings.join(' ')).toMatch(/skipped/i)
  })

  it('drops the mitex import silently', () => {
    // It is an artifact of the forward conversion, not document content.
    const r = typstSourceToMarkdown('#import "@preview/mitex:0.2.4": mi, mitex\n\ntext')
    expect(r.markdown.trim()).toBe('text')
    expect(r.warnings).toEqual([])
  })

  it('returns an empty result for empty input rather than throwing', () => {
    expect(typstSourceToMarkdown('').markdown).toBe('')
  })
})

describe('convertTypstToMarkdown — routing', () => {
  it('falls back to source conversion when no compiler is supplied', async () => {
    // The browser has no HTML-capable Typst compiler.
    const r = await convertTypstToMarkdown('= Title')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.trim()).toBe('# Title')
  })

  it('prefers the compiler when one can produce HTML', async () => {
    const r = await convertTypstToMarkdown('= Title', {
      compiler: { compile: async () => ({ pages: ['<h1>From HTML</h1>'] }) },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.trim()).toBe('# From HTML')
  })

  it('falls back instead of failing when the compiler cannot do HTML', async () => {
    const r = await convertTypstToMarkdown('= Title', {
      compiler: { compile: async () => { throw new Error('format "html" is not available') } },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.trim()).toBe('# Title')
  })

  it('reports an empty document instead of writing a blank file', async () => {
    const r = await convertTypstToMarkdown('   ')
    expect(r.ok).toBe(false)
  })
})

describe('markdown → typst → markdown round trip', () => {
  const schema = createSchema({
    mediaResolver: {
      loadLocalImage: async (p: string) => p,
      loadLocalMedia: async (p: string) => p,
      loadRemoteMedia: async (u: string) => u,
    },
  })

  /** The user-visible contract: converting out and back returns the document. */
  async function roundTrip(markdown: string): Promise<string> {
    const forward = convertMarkdownToTypst(markdown, schema)
    expect(forward.ok).toBe(true)
    if (!forward.ok) throw new Error(forward.message)
    const back = await convertTypstToMarkdown(forward.content)
    expect(back.ok).toBe(true)
    if (!back.ok) throw new Error(back.message)
    return back.content.trim()
  }

  it('returns headings and prose', async () => {
    expect(await roundTrip('# Title\n\nSome text.')).toBe('# Title\n\nSome text.')
  })

  it('returns inline formatting', async () => {
    expect(await roundTrip('**b** and *i* and `c`')).toBe('**b** and *i* and `c`')
  })

  it('returns a link', async () => {
    expect(await roundTrip('[text](https://e.com)')).toBe('[text](https://e.com)')
  })

  it('returns a list', async () => {
    expect(await roundTrip('- a\n- b')).toBe('- a\n- b')
  })

  it('returns a table', async () => {
    const out = await roundTrip('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(out).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('returns a fenced code block verbatim', async () => {
    expect(await roundTrip('```js\nconst a = 1\n```')).toBe('```js\nconst a = 1\n```')
  })

  it('returns a blockquote', async () => {
    expect(await roundTrip('> quoted')).toBe('> quoted')
  })

  it('returns an image', async () => {
    expect(await roundTrip('![alt](x.png)')).toBe('![alt](x.png)')
  })
})
