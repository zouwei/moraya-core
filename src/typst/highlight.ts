// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Typst source tokenizer for editor syntax highlighting.
 *
 * Neither highlight.js nor Prism ships a Typst grammar, and the only JS
 * Typst parser (`codemirror-lang-typst`) wraps a WASM build of a personal fork
 * of `typst-syntax` — too heavy and too unmaintained for a source-pane
 * highlight layer. This is a deliberately small, allocation-light scanner: it
 * classifies spans well enough to colorize, and never tries to parse.
 *
 * Token categories follow the official `Tag` enum in `typst-syntax/src/
 * highlight.rs`, and the emitted class names follow Typst's own `typ-*`
 * convention, so a consumer's stylesheet can be swapped for the upstream one.
 *
 * NOT a validator: unknown or malformed input degrades to `text` rather than
 * erroring. Highlighting must never be able to break the editor.
 */

/**
 * Token categories, mirroring the subset of Typst's official `Tag` enum that a
 * lexical (non-parsing) scanner can distinguish.
 */
export type TypstTokenType =
  | 'text'
  | 'comment'
  | 'heading'
  | 'strong'
  | 'emph'
  | 'raw'
  | 'math'
  | 'link'
  | 'label'
  | 'ref'
  | 'listMarker'
  | 'escape'
  | 'keyword'
  | 'function'
  | 'string'
  | 'number'
  | 'operator'
  | 'punctuation'

export interface TypstToken {
  type: TypstTokenType
  /** Start offset in the source, inclusive. */
  start: number
  /** End offset, exclusive. */
  end: number
}

/** CSS class for a token, matching Typst's own `typ-*` naming. */
export function typstTokenClass(type: TypstTokenType): string {
  return type === 'text' ? '' : `typ-${type.toLowerCase()}`
}

/** Keywords Typst treats specially in code mode. */
const KEYWORDS = new Set([
  'let', 'set', 'show', 'import', 'include', 'if', 'else', 'for', 'while',
  'break', 'continue', 'return', 'in', 'not', 'and', 'or', 'none', 'auto',
  'true', 'false', 'context',
])

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_-]/

/**
 * Scan Typst source into non-overlapping tokens, in source order.
 *
 * Only non-`text` spans are emitted — the consumer renders the gaps verbatim,
 * which keeps the output small for prose-heavy documents.
 */
export function tokenizeTypst(source: string): TypstToken[] {
  const tokens: TypstToken[] = []
  const len = source.length
  let i = 0
  let atLineStart = true

  const push = (type: TypstTokenType, start: number, end: number) => {
    if (end > start) tokens.push({ type, start, end })
  }

  while (i < len) {
    const c = source[i]!

    // ── Comments ────────────────────────────────────────────────────────
    if (c === '/' && source[i + 1] === '/') {
      const start = i
      while (i < len && source[i] !== '\n') i++
      push('comment', start, i)
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i
      i += 2
      let depth = 1
      while (i < len && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') { depth++; i += 2; continue }
        if (source[i] === '*' && source[i + 1] === '/') { depth--; i += 2; continue }
        i++
      }
      push('comment', start, i)
      continue
    }

    // ── Escapes ─────────────────────────────────────────────────────────
    if (c === '\\' && i + 1 < len) {
      push('escape', i, i + 2)
      i += 2
      atLineStart = false
      continue
    }

    // ── Raw text / code blocks ──────────────────────────────────────────
    if (c === '`') {
      const start = i
      let ticks = 0
      while (i < len && source[i] === '`') { ticks++; i++ }
      // Find the matching run of the same length.
      const closer = '`'.repeat(ticks)
      const idx = source.indexOf(closer, i)
      i = idx === -1 ? len : idx + ticks
      push('raw', start, i)
      atLineStart = false
      continue
    }

    // ── Math ────────────────────────────────────────────────────────────
    if (c === '$') {
      const start = i
      i++
      while (i < len && source[i] !== '$') {
        // A backslash escapes the next char, including a `$`.
        if (source[i] === '\\') i++
        i++
      }
      i = Math.min(i + 1, len)
      push('math', start, i)
      atLineStart = false
      continue
    }

    // ── Line-start markup: headings and list markers ───────────────────
    if (atLineStart) {
      // Leading whitespace keeps line-start status (indented lists).
      if (c === ' ' || c === '\t') { i++; continue }

      if (c === '=') {
        const start = i
        while (i < len && source[i] === '=') i++
        if (source[i] === ' ') {
          // Heading runs to end of line.
          while (i < len && source[i] !== '\n') i++
          push('heading', start, i)
          atLineStart = false
          continue
        }
        // Not a heading (e.g. `==` in code) — fall through as operator.
        push('operator', start, i)
        atLineStart = false
        continue
      }

      if ((c === '-' || c === '+') && source[i + 1] === ' ') {
        push('listMarker', i, i + 1)
        i++
        atLineStart = false
        continue
      }
      // `/ term:` — term list marker.
      if (c === '/' && source[i + 1] === ' ') {
        push('listMarker', i, i + 1)
        i++
        atLineStart = false
        continue
      }
      // Numbered list: `1.`
      if (/[0-9]/.test(c)) {
        let j = i
        while (j < len && /[0-9]/.test(source[j]!)) j++
        if (source[j] === '.' && source[j + 1] === ' ') {
          push('listMarker', i, j + 1)
          i = j + 1
          atLineStart = false
          continue
        }
      }
    }

    // ── Markup emphasis ─────────────────────────────────────────────────
    if (c === '*' || c === '_') {
      const close = source.indexOf(c, i + 1)
      // Only treat as emphasis when it closes on the same line.
      const nl = source.indexOf('\n', i + 1)
      if (close !== -1 && (nl === -1 || close < nl)) {
        push(c === '*' ? 'strong' : 'emph', i, close + 1)
        i = close + 1
        atLineStart = false
        continue
      }
    }

    // ── Labels <name> and references @name ──────────────────────────────
    if (c === '<') {
      const close = source.indexOf('>', i + 1)
      const nl = source.indexOf('\n', i + 1)
      if (close !== -1 && (nl === -1 || close < nl)) {
        push('label', i, close + 1)
        i = close + 1
        atLineStart = false
        continue
      }
    }
    if (c === '@') {
      const start = i
      i++
      while (i < len && IDENT_PART.test(source[i]!)) i++
      push('ref', start, i)
      atLineStart = false
      continue
    }

    // ── Code mode: `#…` ─────────────────────────────────────────────────
    if (c === '#') {
      const start = i
      i++
      if (i < len && IDENT_START.test(source[i]!)) {
        while (i < len && IDENT_PART.test(source[i]!)) i++
        const word = source.slice(start + 1, i)
        // A `#` immediately followed by `(` makes it a call, else a keyword or
        // a plain interpolation.
        push(KEYWORDS.has(word) ? 'keyword' : 'function', start, i)
      } else {
        push('punctuation', start, i)
      }
      atLineStart = false
      continue
    }

    // ── Strings ─────────────────────────────────────────────────────────
    if (c === '"') {
      const start = i
      i++
      while (i < len && source[i] !== '"') {
        if (source[i] === '\\') i++
        i++
      }
      i = Math.min(i + 1, len)
      push('string', start, i)
      atLineStart = false
      continue
    }

    // ── Numbers (incl. Typst length/percent literals) ───────────────────
    if (/[0-9]/.test(c)) {
      const start = i
      while (i < len && /[0-9.]/.test(source[i]!)) i++
      // Unit suffix: pt, mm, cm, in, em, %, deg, fr
      while (i < len && /[a-z%]/.test(source[i]!)) i++
      push('number', start, i)
      atLineStart = false
      continue
    }

    // ── Bare identifiers that are keywords (inside code blocks) ─────────
    if (IDENT_START.test(c)) {
      const start = i
      while (i < len && IDENT_PART.test(source[i]!)) i++
      const word = source.slice(start, i)
      if (KEYWORDS.has(word)) push('keyword', start, i)
      atLineStart = false
      continue
    }

    if (c === '\n') {
      atLineStart = true
      i++
      continue
    }

    atLineStart = false
    i++
  }

  return tokens
}
