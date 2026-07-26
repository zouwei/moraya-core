// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { htmlToMarkdown } from '../html-to-md'
import { convertTypstToMarkdown } from '../index'
import type { TypstCompiler } from '../../typst/types'

/** Convert and return just the markdown, for readable assertions. */
function md(html: string): string {
  return htmlToMarkdown(html).markdown.trim()
}

describe('htmlToMarkdown — blocks', () => {
  it('maps heading levels', () => {
    expect(md('<h1>One</h1><h3>Three</h3>')).toBe('# One\n\n### Three')
  })

  it('lifts a document that starts at h2 — what Typst emits for `=`', () => {
    // Typst reserves <h1> for the document title, so `= Title` compiles to
    // <h2>. Emitting that verbatim demotes every heading on each conversion.
    expect(md('<h2>Title</h2><h3>Sub</h3>')).toBe('# Title\n\n## Sub')
  })

  it('converts paragraphs and collapses inline whitespace', () => {
    // HTML rendering collapses runs of whitespace; keeping them would produce
    // ragged markdown.
    expect(md('<p>a\n  b</p>')).toBe('a b')
  })

  it('converts lists', () => {
    expect(md('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b')
    expect(md('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b')
  })

  it('indents nested lists under their item', () => {
    const out = md('<ul><li>a<ul><li>b</li></ul></li></ul>')
    expect(out).toContain('- a')
    expect(out).toContain('  - b')
  })

  it('converts code blocks with the language Typst records', () => {
    // Typst's HTML writer emits <pre><code data-lang="…">.
    const out = md('<pre><code data-lang="rust">fn main() {}</code></pre>')
    expect(out).toBe('```rust\nfn main() {}\n```')
  })

  it('converts blockquotes', () => {
    expect(md('<blockquote><p>quoted</p></blockquote>')).toBe('> quoted')
  })

  it('converts tables with a header separator', () => {
    const out = md('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(out).toContain('| a | b |')
    expect(out).toContain('| --- | --- |')
    expect(out).toContain('| 1 | 2 |')
  })

  it('escapes a pipe inside a table cell', () => {
    // An unescaped pipe would split the cell and corrupt the table.
    expect(md('<table><tr><td>a|b</td></tr></table>')).toContain('a\\|b')
  })

  it('converts a figure to an image with its caption as alt text', () => {
    const out = md('<figure><img src="x.png"/><figcaption>Cap</figcaption></figure>')
    expect(out).toBe('![Cap](x.png)')
  })

  it('converts horizontal rules', () => {
    expect(md('<hr/>')).toBe('---')
  })
})

describe('htmlToMarkdown — inline', () => {
  it('maps emphasis, strong, strike, code and links', () => {
    expect(md('<p><strong>b</strong></p>')).toBe('**b**')
    expect(md('<p><em>i</em></p>')).toBe('*i*')
    expect(md('<p><del>d</del></p>')).toBe('~~d~~')
    expect(md('<p><code>c</code></p>')).toBe('`c`')
    expect(md('<p><a href="https://e.com">t</a></p>')).toBe('[t](https://e.com)')
  })

  it('keeps code content unescaped', () => {
    // Escaping inside code would corrupt the payload.
    expect(md('<p><code>a*b*</code></p>')).toBe('`a*b*`')
  })

  it('escapes markdown syntax appearing in prose', () => {
    expect(md('<p>a * b _ c</p>')).toContain('\\*')
  })
})

describe('htmlToMarkdown — math', () => {
  it('rebuilds LaTeX structure from presentation MathML', () => {
    // Verified against the real `typst compile --format html` output.
    const out = md('<p><math><msup><mi>\u{1D465}</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math></p>')
    expect(out).toBe('$x^2 + 1$')
  })

  it('maps fractions and roots', () => {
    expect(md('<p><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></p>')).toBe('$\\frac{a}{b}$')
    expect(md('<p><math><msqrt><mi>x</mi></msqrt></math></p>')).toBe('$\\sqrt{x}$')
  })

  it('prefers the TeX annotation when the writer provides one', () => {
    const out = md('<p><math><annotation>x^2</annotation><mi>x</mi></math></p>')
    expect(out).toContain('$x^2$')
  })

  it('warns that equations came from MathML', () => {
    // MathML carries presentation, not LaTeX — the caller must be able to say so.
    const r = htmlToMarkdown('<p><math><mi>x</mi></math></p>')
    expect(r.warnings.join(' ')).toMatch(/MathML/i)
  })
})

describe('htmlToMarkdown — contract', () => {
  it('returns an empty result for empty input rather than throwing', () => {
    expect(htmlToMarkdown('').markdown).toBe('')
  })

  it('keeps the content of unknown elements', () => {
    // Typst lowers shapes/layout to divs with classes; dropping them silently
    // would lose the text inside.
    expect(md('<div class="rect"><p>kept</p></div>')).toBe('kept')
  })
})

describe('convertTypstToMarkdown', () => {
  const compiler = (impl: Partial<TypstCompiler>): TypstCompiler => ({
    compile: async () => ({ pages: [] }),
    ...impl,
  })

  it('compiles to HTML and converts the result', async () => {
    const r = await convertTypstToMarkdown('= H', {
      compiler: compiler({ compile: async () => ({ pages: ['<h1>H</h1>'] }) }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.trim()).toBe('# H')
  })

  it('asks the compiler for HTML specifically', async () => {
    let asked = ''
    await convertTypstToMarkdown('= H', {
      compiler: compiler({
        compile: async (_s, format) => { asked = format; return { pages: ['<p>x</p>'] } },
      }),
    })
    expect(asked).toBe('html')
  })

  it('falls back to the source route when the compiler returns no HTML', async () => {
    const r = await convertTypstToMarkdown('= H', { compiler: compiler({}) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.trim()).toBe('# H')
  })

  it('never throws — a compile failure degrades instead of erroring', async () => {
    // A missing @preview package is the common real-world case in a browser.
    const r = await convertTypstToMarkdown('#import "@preview/x:1.0": *\n\n= H', {
      compiler: compiler({
        compile: async () => { throw new Error('package not found') },
      }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.content.trim()).toBe('# H')
  })
})
