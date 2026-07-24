// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  markdownToHtmlBody,
  markdownToHtml,
  sanitizeHtml,
  escapeHtml,
  markdownToLatex,
  inferDocumentTitle,
} from '../html'

describe('markdownToHtmlBody — fidelity gap closed (markdown-it)', () => {
  it('renders GFM tables (regex renderer could not)', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    const html = markdownToHtmlBody(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders ordered lists (regex renderer could not)', () => {
    const html = markdownToHtmlBody('1. one\n2. two\n3. three')
    expect(html).toContain('<ol>')
    expect(html).toMatch(/<li>one<\/li>/)
  })

  it('highlights fenced code via highlight.js', () => {
    const html = markdownToHtmlBody('```js\nconst x = 1\n```')
    expect(html).toContain('class="hljs language-js"')
    expect(html).toContain('hljs-keyword') // `const` tokenized
  })

  it('emits a mermaid-export placeholder for mermaid fences', () => {
    const html = markdownToHtmlBody('```mermaid\ngraph TD; A-->B\n```')
    expect(html).toContain('<div class="mermaid-export">')
    expect(html).toContain('class="language-mermaid"')
  })

  it('renders KaTeX block + inline math (mhchem \\ce available)', () => {
    const block = markdownToHtmlBody('$$\\ce{H2O}$$')
    expect(block).toContain('class="math-block"')
    expect(block).toContain('katex')
    const inline = markdownToHtmlBody('mass $E=mc^2$ here')
    expect(inline).toContain('katex')
  })

  it('preserves raw HTML (no forced conversion)', () => {
    const html = markdownToHtmlBody('a <br> b <sub>2</sub>')
    expect(html).toContain('<br>')
    expect(html).toContain('<sub>2</sub>')
  })

  it('renders definition lists', () => {
    const html = markdownToHtmlBody('Term\n:   Definition')
    expect(html).toContain('<dl>')
    expect(html).toContain('<dt>Term</dt>')
  })

  it('does not treat "$5 and $10" as math', () => {
    const html = markdownToHtmlBody('costs $5 and $10 total')
    expect(html).not.toContain('katex')
    expect(html).toContain('$5')
  })
})

describe('sanitizeHtml', () => {
  it('strips scripts, event handlers, and javascript: urls', () => {
    const dirty = '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>'
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toContain('<script>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('hi')
  })
})

describe('markdownToHtml', () => {
  it('wraps a full document with styles + KaTeX/hljs CDN links when includeStyles', async () => {
    const doc = await markdownToHtml('# Title', true)
    expect(doc).toContain('<!DOCTYPE html>')
    expect(doc).toContain('katex.min.css')
    expect(doc).toContain('highlight.js')
    expect(doc).toContain('<h1>Title</h1>')
  })

  it('omits styles for html-plain', async () => {
    const doc = await markdownToHtml('# Title', false)
    expect(doc).not.toContain('katex.min.css')
    expect(doc).toContain('<h1>Title</h1>')
  })

  it('fills mermaid via the injected renderer', async () => {
    const doc = await markdownToHtml('```mermaid\ngraph TD; A-->B\n```', false, async () => ({
      svg: '<svg id="m"></svg>',
    }))
    expect(doc).toContain('<svg id="m">')
    expect(doc).not.toContain('language-mermaid')
  })
})

describe('escapeHtml / markdownToLatex / inferDocumentTitle', () => {
  it('escapes html', () => {
    expect(escapeHtml('<a>&"\'')).toBe('&lt;a&gt;&amp;&quot;&#039;')
  })
  it('converts headings + emphasis to latex', () => {
    const tex = markdownToLatex('# H\n**b** *i* `c`')
    expect(tex).toContain('\\section{H}')
    expect(tex).toContain('\\textbf{b}')
    expect(tex).toContain('\\documentclass{article}')
  })
  it('infers title from the first H1, else first non-blank line', () => {
    expect(inferDocumentTitle('\n# My Doc\ntext')).toBe('My Doc')
    expect(inferDocumentTitle('just text\nmore')).toBe('just text')
    expect(inferDocumentTitle('')).toBe('Document')
  })
})
