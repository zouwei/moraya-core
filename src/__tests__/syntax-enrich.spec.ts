// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import hljs from 'highlight.js'
import {
  enrichUnscoped,
  enrichHighlightedHtml,
  shouldEnrich,
} from '../plugins/syntax-enrich'

const classesFor = (text: string, token: string) =>
  enrichUnscoped(text).find((s) => s.text === token)?.classes ?? []

describe('enrichUnscoped', () => {
  it('marks a call site', () => {
    expect(classesFor('random.choice(x)', 'choice')).toEqual([
      'hljs-title',
      'function_',
      'invoke__',
    ])
  })

  it('marks member access', () => {
    expect(classesFor('string.ascii_lowercase', 'ascii_lowercase')).toEqual(['hljs-property'])
  })

  it('prefers call over member when a name is both', () => {
    expect(classesFor('a.b(c)', 'b')).toContain('function_')
  })

  it('marks SCREAMING_CASE as a constant', () => {
    expect(classesFor('total = MAX_RETRIES + 1', 'MAX_RETRIES')).toEqual([
      'hljs-variable',
      'constant_',
    ])
  })

  it('marks operators', () => {
    for (const op of ['=', '+=', '->', '==', '*', '-']) {
      expect(classesFor(`a ${op} b`, op), op).toEqual(['hljs-operator'])
    }
  })

  it('marks an assignment target as a variable', () => {
    // The one bare identifier that is not a guess: a name being assigned to is
    // a variable binding.
    for (const t of ['password', 'lowercase'])
      expect(classesFor(`${t} = 1`, t), t).toEqual(['hljs-variable'])
    expect(classesFor('total += 1', 'total')).toEqual(['hljs-variable'])
  })

  it('leaves other bare identifiers alone', () => {
    // Telling a variable from anything else needs type information, and
    // tinting every identifier turns a file into noise.
    expect(classesFor('foo(bar, baz)', 'baz')).toEqual([])
    expect(classesFor('if a == b', 'a')).toEqual([])
  })

  it('does not mistake a comparison for an assignment', () => {
    expect(classesFor('a == b', 'a')).toEqual([])
    expect(classesFor('a <= b', 'a')).toEqual([])
  })

  it('only treats a line-leading name as a target', () => {
    // Mid-expression `=` is far likelier to be a keyword argument.
    expect(classesFor('foo(x, frozen=True)', 'frozen')).toEqual([])
  })

  it('does not read a decimal point as member access', () => {
    expect(classesFor('rate = 1.5e3', 'e3')).toEqual([])
  })

  it('preserves the text exactly', () => {
    for (const src of ['a.b(c) + 1', '  x  ', 'MAX = -1', '', 'no-tokens-here…']) {
      expect(enrichUnscoped(src).map((s) => s.text).join('')).toBe(src)
    }
  })

  it('never returns an empty segment list', () => {
    expect(enrichUnscoped('').length).toBeGreaterThan(0)
  })
})

describe('shouldEnrich', () => {
  it('skips prose and patch formats', () => {
    // `-`, `+` and `.` are literal content there, and hljs already scopes the
    // parts that carry meaning.
    for (const l of ['markdown', 'md', 'diff', 'plaintext', 'text'])
      expect(shouldEnrich(l), l).toBe(false)
  })

  it('runs for programming languages', () => {
    for (const l of ['python', 'rust', 'go', 'yaml']) expect(shouldEnrich(l), l).toBe(true)
  })

  it('skips when the language is unknown', () => {
    expect(shouldEnrich(undefined)).toBe(false)
  })
})

describe('enrichHighlightedHtml', () => {
  const py = (src: string) =>
    enrichHighlightedHtml(hljs.highlight(src, { language: 'python' }).value)

  it('never touches text hljs already scoped', () => {
    // The safety property this whole pass rests on: strings and comments are
    // claimed by the grammar, so no heuristic can reach inside them.
    const out = py('x = "a.b(c) = 1"  # d.e(f) = 2')
    expect(out).toContain('<span class="hljs-string">&quot;a.b(c) = 1&quot;</span>')
    expect(out).toContain('# d.e(f) = 2')
    // The only enrichment is the real assignment outside the string.
    expect(out.match(/hljs-operator/g)).toHaveLength(1)
  })

  it('enriches what the grammar left plain', () => {
    const out = py('password += [random.choice(all_chars)]')
    expect(out).toContain('<span class="hljs-operator">+=</span>')
    expect(out).toContain('function_ invoke__">choice</span>')
  })

  it('leaves the rendered text identical', () => {
    const src = 'a = b.c(d) + MAX\n# note\ns = "t"'
    const strip = (h: string) => h.replace(/<[^>]+>/g, '')
    expect(strip(py(src))).toBe(strip(hljs.highlight(src, { language: 'python' }).value))
  })

  it('does not double-escape entities', () => {
    const out = py('if a < b and c > d: pass')
    expect(out).not.toContain('&amp;lt;')
    expect(out).toContain('&lt;')
  })

  it('survives malformed input without throwing', () => {
    expect(() => enrichHighlightedHtml('<span class="hljs-x">unclosed')).not.toThrow()
  })
})

describe('coverage on the reported document', () => {
  it('lifts a real Python sample well past what the grammar alone gives', () => {
    const CODE = [
      '# 定义字符集',
      'lowercase = string.ascii_lowercase',
      'password += [random.choice(all_characters) for _ in range(length - 4)]',
      'return "".join(password)',
    ].join('\n')

    const raw = hljs.highlight(CODE, { language: 'python' }).value
    const scopedChars = (html: string) => {
      let depth = 0, scoped = 0, total = 0
      for (let i = 0; i < html.length; ) {
        if (html[i] === '<') {
          const e = html.indexOf('>', i)
          depth += html.slice(i, e).startsWith('</') ? -1 : 1
          i = e + 1
        } else {
          let j = i
          while (j < html.length && html[j] !== '<') j++
          const n = html.slice(i, j).replace(/&\w+;/g, 'x').trim().length
          total += n
          if (depth > 0) scoped += n
          i = j
        }
      }
      return total === 0 ? 0 : scoped / total
    }

    const before = scopedChars(raw)
    const after = scopedChars(enrichHighlightedHtml(raw))
    expect(before).toBeLessThan(0.35)
    expect(after).toBeGreaterThan(0.55)
  })
})
