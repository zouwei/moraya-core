import { describe, it, expect } from 'vitest'
import { renderChatMarkdown } from '../index'

describe('renderChatMarkdown — basic rendering', () => {
  it('returns empty string for empty input', () => {
    expect(renderChatMarkdown('')).toBe('')
  })

  it('renders plain paragraph', () => {
    expect(renderChatMarkdown('hello world')).toBe('<p>hello world</p>\n')
  })

  it('renders bold and italic', () => {
    const out = renderChatMarkdown('**bold** _italic_')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>italic</em>')
  })

  it('renders headings h1-h4', () => {
    const out = renderChatMarkdown('# H1\n## H2\n### H3\n#### H4')
    expect(out).toContain('<h1>H1</h1>')
    expect(out).toContain('<h2>H2</h2>')
    expect(out).toContain('<h3>H3</h3>')
    expect(out).toContain('<h4>H4</h4>')
  })

  it('renders unordered and ordered lists', () => {
    const out = renderChatMarkdown('- a\n- b\n\n1. one\n2. two')
    expect(out).toContain('<ul>')
    expect(out).toContain('<li>a</li>')
    expect(out).toContain('<ol>')
    expect(out).toContain('<li>one</li>')
  })

  it('renders inline code', () => {
    expect(renderChatMarkdown('use `npm i`')).toContain('<code>npm i</code>')
  })

  it('renders blockquotes', () => {
    expect(renderChatMarkdown('> quoted')).toContain('<blockquote>')
  })

  it('renders fenced code blocks without a highlighter', () => {
    const out = renderChatMarkdown('```python\nprint("hi")\n```')
    expect(out).toContain('<pre>')
    expect(out).toContain('<code')
    // Quotes inside the code body are HTML-escaped to &quot; for safety.
    expect(out).toContain('print(&quot;hi&quot;)')
  })

  it('renders single newlines as <br> (chat-style breaks)', () => {
    expect(renderChatMarkdown('line1\nline2')).toBe('<p>line1<br>\nline2</p>\n')
  })

  it('linkifies bare URLs', () => {
    const out = renderChatMarkdown('See https://moraya.app for more')
    expect(out).toContain('href="https://moraya.app"')
    expect(out).toContain('target="_blank"')
  })

  it('renders explicit link syntax', () => {
    const out = renderChatMarkdown('[click](https://example.com)')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('>click</a>')
  })

  it('renders strikethrough', () => {
    expect(renderChatMarkdown('~~gone~~')).toContain('<s>gone</s>')
  })
})

describe('renderChatMarkdown — XSS hardening', () => {
  it('escapes raw <script> tags', () => {
    const out = renderChatMarkdown('hi <script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('escapes <img onerror=...> — no live tag emitted', () => {
    const out = renderChatMarkdown('<img src=x onerror="alert(1)">')
    // The literal `onerror` substring will appear in the ESCAPED text body,
    // which is harmless (browser sees text, not an attribute). The unsafe
    // shapes are a live <img> tag or `onerror=` adjacent to an attribute
    // boundary in actual HTML — those must NOT be present.
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('rejects javascript: URLs in links — no live href emitted', () => {
    const out = renderChatMarkdown('[click](javascript:alert(1))')
    // markdown-it falls back to plain text when validateLink rejects the URL,
    // so the literal text "javascript:" survives but no anchor is generated.
    expect(out).not.toContain('href="javascript:')
    expect(out).not.toMatch(/<a\b/)
  })

  it('rejects vbscript: URLs in links', () => {
    const out = renderChatMarkdown('[click](vbscript:msgbox)')
    expect(out).not.toContain('href="vbscript:')
  })

  it('rejects data:text/html URLs in links', () => {
    const out = renderChatMarkdown('[click](data:text/html,<script>alert(1)</script>)')
    expect(out).not.toContain('href="data:text/html')
  })

  it('strips embedded HTML attributes via markdown injection attempts', () => {
    const out = renderChatMarkdown('"><script>alert(1)</script><a href="')
    expect(out).not.toContain('<script>')
  })

  it('escapes inline HTML entities — no live tag emitted', () => {
    const out = renderChatMarkdown('<div onclick="evil()">x</div>')
    expect(out).not.toContain('<div')
    expect(out).toContain('&lt;div')
    // `onclick=` lives in the escaped body as literal text; harmless. The
    // live-attribute hazard is the unescaped `<div ... onclick=` — which is
    // covered by the not.toContain('<div') above.
  })

  it('escapes < > & " in code blocks', () => {
    const out = renderChatMarkdown('```\n<div class="x">&amp;</div>\n```')
    // The literal source `<` in the code body must be HTML-escaped to &lt;
    expect(out).toContain('&lt;div')
    expect(out).not.toContain('<div class="x">')
  })
})

describe('renderChatMarkdown — streaming safety (idempotent on partial input)', () => {
  it('does not throw on unclosed fenced code block', () => {
    expect(() => renderChatMarkdown('```python\ndef foo():')).not.toThrow()
  })

  it('does not throw on half-written link', () => {
    expect(() => renderChatMarkdown('see [click](https://')).not.toThrow()
    const out = renderChatMarkdown('see [click](https://')
    // Partial link falls back to plain text
    expect(out).toContain('see')
  })

  it('does not throw on unclosed emphasis', () => {
    expect(() => renderChatMarkdown('**bold but unclosed')).not.toThrow()
  })

  it('does not throw on unclosed inline code', () => {
    expect(() => renderChatMarkdown('use `npm i')).not.toThrow()
  })

  it('is idempotent — same input → same output', () => {
    const input = '**hello** [link](https://x.com)\n```js\nlet x = 1\n```'
    expect(renderChatMarkdown(input)).toBe(renderChatMarkdown(input))
  })

  it('does not throw on partial math when math callback is absent', () => {
    expect(() => renderChatMarkdown('$E = mc')).not.toThrow()
  })

  it('does not throw on partial math when math callback IS provided', () => {
    expect(() => renderChatMarkdown('$E = mc', {
      math: (latex) => `[MATH:${latex}]`,
    })).not.toThrow()
  })
})

describe('renderChatMarkdown — link attributes', () => {
  it('defaults to target=_blank rel=noopener noreferrer', () => {
    const out = renderChatMarkdown('[x](https://a.com)')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('respects custom linkAttrs.target', () => {
    const out = renderChatMarkdown('[x](https://a.com)', { linkAttrs: { target: '_self' } })
    expect(out).toContain('target="_self"')
    // rel still defaults
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('respects custom linkAttrs.rel', () => {
    const out = renderChatMarkdown('[x](https://a.com)', { linkAttrs: { rel: 'nofollow' } })
    expect(out).toContain('rel="nofollow"')
    expect(out).toContain('target="_blank"')
  })
})

describe('renderChatMarkdown — preprocess hook', () => {
  it('runs preprocess before parsing', () => {
    const out = renderChatMarkdown('@alice', {
      preprocess: (raw) => raw.replace(/@(\w+)/g, '**@$1**'),
    })
    expect(out).toContain('<strong>@alice</strong>')
  })

  it('does not run preprocess when not provided', () => {
    const out = renderChatMarkdown('@alice')
    expect(out).not.toContain('<strong>')
  })

  it('preprocess returning empty string yields empty output', () => {
    expect(renderChatMarkdown('anything', { preprocess: () => '' })).toBe('')
  })
})

describe('renderChatMarkdown — highlight callback', () => {
  it('calls highlight with code body and lang', () => {
    let captured: { code: string; lang: string } | null = null
    renderChatMarkdown('```python\nprint(1)\n```', {
      highlight: (code, lang) => {
        captured = { code, lang }
        return null
      },
    })
    expect(captured).toEqual({ code: 'print(1)\n', lang: 'python' })
  })

  it('injects highlighter output into the rendered code block', () => {
    const out = renderChatMarkdown('```js\nx\n```', {
      highlight: (_code, lang) => `<span class="hl-${lang}">FAKE</span>`,
    })
    expect(out).toContain('<span class="hl-js">FAKE</span>')
  })

  it('falls back to escaped default when highlighter returns null', () => {
    const out = renderChatMarkdown('```\nx\n```', {
      highlight: () => null,
    })
    expect(out).toContain('<code>')
    expect(out).toContain('x')
  })

  it('falls back to default when highlighter throws', () => {
    const out = renderChatMarkdown('```\nx\n```', {
      highlight: () => {
        throw new Error('boom')
      },
    })
    expect(out).toContain('<code>')
    expect(out).toContain('x')
  })
})

describe('renderChatMarkdown — math callback', () => {
  it('renders $inline$ math via callback', () => {
    const out = renderChatMarkdown('see $E = mc^2$ here', {
      math: (latex, display) => {
        expect(display).toBe(false)
        return `<span class="math">${latex}</span>`
      },
    })
    expect(out).toContain('<span class="math">E = mc^2</span>')
  })

  it('renders $$block$$ math via callback', () => {
    const out = renderChatMarkdown('$$E = mc^2$$', {
      math: (latex, display) => {
        expect(display).toBe(true)
        return `<div class="math-block">${latex}</div>`
      },
    })
    expect(out).toContain('<div class="math-block">E = mc^2</div>')
  })

  it('does not parse math when callback is absent ($ kept verbatim)', () => {
    const out = renderChatMarkdown('see $E = mc^2$ here')
    // markdown-it without math rules emits the $ as plain text
    expect(out).toContain('$E = mc^2$')
  })

  it('does not match dollar-amount usage like "$5"', () => {
    const out = renderChatMarkdown('costs $5 and $10', {
      math: () => '[MATH]',
    })
    expect(out).not.toContain('[MATH]')
  })

  it('falls back to <code>$...$</code> when math callback throws (inline)', () => {
    const out = renderChatMarkdown('$bad{$', {
      math: () => {
        throw new Error('katex error')
      },
    })
    // Pattern: <code>$...$</code>
    expect(out).toMatch(/<code>\$[^<]+\$<\/code>/)
  })

  it('falls back to <pre><code>$$...$$</code></pre> when math callback throws (block)', () => {
    const out = renderChatMarkdown('$$bad{$$', {
      math: () => {
        throw new Error('katex error')
      },
    })
    expect(out).toContain('<pre><code>$$bad{$$</code></pre>')
  })

  it('renders multi-line block math', () => {
    const out = renderChatMarkdown('$$\nE = mc^2\n$$', {
      math: (latex, display) => `[${display ? 'B' : 'I'}:${latex}]`,
    })
    expect(out).toContain('[B:E = mc^2]')
  })
})

describe('renderChatMarkdown — option-object caching', () => {
  it('reuses the same MarkdownIt instance for the same opts object reference', () => {
    const opts = { math: (l: string) => `[${l}]` }
    // Just verify the call works repeatedly without throw
    const a = renderChatMarkdown('$x$', opts)
    const b = renderChatMarkdown('$x$', opts)
    expect(a).toBe(b)
  })

  it('builds independent instances for different opts objects', () => {
    const a = renderChatMarkdown('[x](https://y.com)', { linkAttrs: { target: '_self' } })
    const b = renderChatMarkdown('[x](https://y.com)', { linkAttrs: { target: '_blank' } })
    expect(a).toContain('target="_self"')
    expect(b).toContain('target="_blank"')
  })
})
