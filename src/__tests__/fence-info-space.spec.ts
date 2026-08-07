// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '../markdown'
import { schema } from '../schema'

/** Markdown in, markdown back out — what the editor does on a mode switch. */
const roundTrip = (md: string) => serializeMarkdown(parseMarkdown(md, schema))

describe('fence info spacing', () => {
  it('keeps a fence written without a space', () => {
    expect(roundTrip('```python\nx = 1\n```')).toContain('```python')
  })

  it('keeps a fence written with a space', () => {
    // Both spellings are valid CommonMark, and the editor must return the one
    // it was given. This used to come back as ```python.
    expect(roundTrip('``` python\nx = 1\n```')).toContain('``` python')
  })

  it('collapses a run of spaces to one', () => {
    const out = roundTrip('```     python\nx = 1\n```')
    expect(out).toContain('``` python')
    expect(out).not.toContain('```  python')
  })

  it('is stable across repeated round-trips', () => {
    for (const src of ['```python\nx\n```', '``` python\nx\n```']) {
      const once = roundTrip(src)
      expect(roundTrip(once)).toBe(once)
    }
  })

  it('writes no stray space for a fence with no language', () => {
    const out = roundTrip('```\nx = 1\n```')
    expect(out).not.toMatch(/``` +\n/)
  })

  it('records the spacing on the node', () => {
    const withSpace = parseMarkdown('``` js\nx\n```', schema)
    const without = parseMarkdown('```js\nx\n```', schema)
    expect(withSpace.firstChild?.attrs.langSpace).toBe(true)
    expect(without.firstChild?.attrs.langSpace).toBe(false)
    expect(withSpace.firstChild?.attrs.language).toBe('js')
    expect(without.firstChild?.attrs.language).toBe('js')
  })

  it('leaves the code content untouched either way', () => {
    for (const src of ['```py\na = 1\nb = 2\n```', '``` py\na = 1\nb = 2\n```']) {
      expect(roundTrip(src)).toContain('a = 1\nb = 2')
    }
  })
})

describe('the ``` input rule', () => {
  // Same pattern the editor installs, exercised directly: driving real input
  // rules needs a live EditorView, and what matters here is which of the three
  // spellings the pattern accepts and what it captures.
  const RULE = /^```(?:(?<space>[ \t])?(?<language>[a-zA-Z][a-zA-Z0-9_+#.\-]*))?[\s\n]$/

  const capture = (typed: string) => {
    const m = RULE.exec(typed)
    return m && { lang: m.groups?.language ?? '', space: !!m.groups?.space }
  }

  it('accepts ```lang', () => {
    expect(capture('```python ')).toEqual({ lang: 'python', space: false })
  })

  it('accepts ``` lang', () => {
    expect(capture('``` python ')).toEqual({ lang: 'python', space: true })
  })

  it('still creates a plain fence from ``` alone', () => {
    // The space+language group cannot match here, so the trailing terminator
    // takes the space — the pre-existing behaviour, deliberately unchanged.
    expect(capture('``` ')).toEqual({ lang: '', space: false })
    expect(capture('```\n')).toEqual({ lang: '', space: false })
  })

  it('does not fire on a partially typed language', () => {
    expect(capture('``` py')).toBeNull()
    expect(capture('```py')).toBeNull()
  })
})
