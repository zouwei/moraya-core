// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Typst document outline — headings extracted from source.
 *
 * A `.typ` document is edited as source, so the outline is built by reading the
 * source rather than by walking a rendered tree (which is how the markdown
 * outline works, over the ProseMirror doc). That also gives each entry a line
 * number, which is what the source pane needs in order to scroll to it.
 *
 * Reading source instead of asking the compiler is a deliberate trade. The
 * compiler would be exact — `typst query heading` resolves `#let`, show rules
 * and includes — but it costs a compile per edit, returns page positions rather
 * than source lines, and has no browser equivalent (typst.ts exposes no query
 * API). Source parsing is instant, works identically on every platform, and
 * covers the markup that people actually write. What it cannot see is listed in
 * `extractTypstOutline`'s doc comment.
 *
 * Every rule below was verified against the real `typst` binary via
 * `query(heading)` — including which constructs are NOT headings, which is the
 * part that is easy to get wrong.
 */

export interface TypstHeading {
  /** Stable within one parse; derived from the source line. */
  id: string
  /** 1-based, as written (`=` → 1, `==` → 2). */
  level: number
  /** Display text: markup stripped, label removed. */
  text: string
  /** 0-based source line. */
  line: number
  /** Character offset of the line start, for callers that map by offset. */
  offset: number
  /**
   * Rendered heading number, when the document sets `heading(numbering: …)`.
   * Absent otherwise — an unnumbered document must not grow numbers in the
   * outline that its pages do not have.
   */
  number?: string
}

/**
 * Extract the outline from Typst source.
 *
 * Recognized (all confirmed against `typst query heading`):
 *   - `= Title` … `====== Title`, at any indentation
 *   - `#heading[Title]` and `#heading(level: N)[Title]`
 *   - a trailing label — `= Basics <basics>` — which is metadata, not text
 *   - `#set heading(numbering: "1.")`, applied with Typst's own pattern rules
 *
 * Correctly ignored:
 *   - `=Title` (Typst requires the space)
 *   - anything inside ``` raw blocks, `inline raw`, line comments, block comments
 *   - `=` appearing mid-line, in math, or in code
 *
 * Not visible to a source reader — a document using these gets an outline that
 * is incomplete rather than wrong:
 *   - headings produced by user functions, `#let`-bound content, or show rules
 *   - `#include`d files
 *   - `#set heading(offset: N)`, which shifts every level
 */
export function extractTypstOutline(source: string): TypstHeading[] {
  const headings: TypstHeading[] = []
  const numbering = findNumbering(source)
  const counters: number[] = []

  let offset = 0
  let inRawBlock = false
  let inBlockComment = false

  for (const [line, raw] of source.split('\n').entries()) {
    const lineOffset = offset
    offset += raw.length + 1
    const trimmed = raw.trim()

    // Raw blocks swallow everything, including things that look like headings.
    if (trimmed.startsWith('```')) {
      // A single-line ``` … ``` opens and closes at once.
      const fences = (trimmed.match(/```/g) ?? []).length
      if (fences === 1) inRawBlock = !inRawBlock
      continue
    }
    if (inRawBlock) continue

    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      continue
    }
    const code = stripComments(raw)
    if (/\/\*/.test(raw) && !/\*\//.test(raw.slice(raw.indexOf('/*')))) inBlockComment = true

    const found = matchHeading(code)
    if (!found) continue

    // Slice the ORIGINAL line: a heading may legitimately contain an inline
    // raw span, which the blanked form no longer has.
    const text = plainText(stripLabel(raw.slice(found.from, found.to)))
    if (!text) continue

    const entry: TypstHeading = {
      id: `typ-${line}`,
      level: found.level,
      text,
      line,
      offset: lineOffset,
    }
    if (numbering) entry.number = applyNumbering(numbering, bump(counters, found.level))
    headings.push(entry)
  }

  return headings
}

/* ----------------------------------------------------------------- parsing */

interface Match {
  level: number
  /** Index range of the heading text, into the ORIGINAL line. */
  from: number
  to: number
}

/**
 * Detect a heading on one line.
 *
 * `line` is the comment- and raw-blanked form, so `//` inside a URL and a
 * `` `= x` `` inline raw cannot be mistaken for syntax. Only *indices* are
 * returned: `stripComments` preserves length, so the caller slices the same
 * range out of the original line and keeps whatever was blanked for display.
 */
function matchHeading(line: string): Match | null {
  // `= Title`. The space is required — `=Title` is not a heading, and neither
  // is a bare `=` on its own line.
  const markup = /^(\s*)(={1,6})\s+(?=\S)/.exec(line)
  if (markup && /\S/.test(line.slice(markup[0].length))) {
    return { level: markup[2]!.length, from: markup[0].length, to: line.length }
  }

  // `#heading[…]` / `#heading(level: 2)[…]`. Level defaults to 1.
  if (/^\s*#heading\b/.test(line)) {
    const args = /\(([^)]*)\)/.exec(line)?.[1] ?? ''
    const level = Number(/\blevel:\s*(\d+)/.exec(args)?.[1] ?? 1)
    const open = line.indexOf('[')
    const close = line.lastIndexOf(']')
    if (open !== -1 && close > open) {
      return { level: Math.min(Math.max(level, 1), 6), from: open + 1, to: close }
    }
  }

  return null
}

/**
 * Blank out comments and inline raw spans.
 *
 * Replaced with spaces rather than removed so character offsets stay aligned
 * with the original line.
 */
function stripComments(line: string): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    // String literals first: `#link("https://…")` is not a comment, and any
    // URL in a heading would otherwise lose everything from its `//` onward.
    if (line[i] === '"') {
      const end = findStringEnd(line, i)
      out += line.slice(i, end)
      i = end
      continue
    }
    const two = line.slice(i, i + 2)
    if (two === '//') return out + ' '.repeat(line.length - i)
    if (two === '/*') {
      const end = line.indexOf('*/', i + 2)
      const stop = end === -1 ? line.length : end + 2
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      const stop = end === -1 ? line.length : end + 1
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    out += line[i]
    i++
  }
  return out
}

/** Index just past the closing quote of the string opening at `start`. */
function findStringEnd(line: string, start: number): number {
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue }
    if (line[i] === '"') return i + 1
  }
  return line.length
}

/** `= Basics <basics>` — the label identifies the heading, it is not its text. */
function stripLabel(text: string): string {
  return text.replace(/\s*<[A-Za-z_][\w.:-]*>\s*$/, '')
}

/**
 * Reduce heading markup to readable text.
 *
 * Deliberately local rather than reusing `/convert`: that module targets
 * markdown and depends on markdown-it + ProseMirror, which `/typst` must not
 * pull in. Math is left as written — `$x^2$` is more recognizable in an outline
 * than any flattening of it.
 */
function plainText(text: string): string {
  let out = text
  // `#link("url")[label]`, `#strong[x]`, `#emph[x]` … keep the bracketed body.
  for (let i = 0; i < 3 && /#[a-zA-Z]/.test(out); i++) {
    out = out.replace(/#[a-zA-Z][\w.-]*(?:\([^()]*\))?\[([^\]]*)\]/g, '$1')
  }
  return out
    .replace(/#[a-zA-Z][\w.-]*(?:\([^()]*\))?/g, '') // bare function calls
    .replace(/\\([\\#*_`$<>@[\]])/g, '$1') // escapes
    .replace(/([*_])(\S(?:[^*_]*\S)?)\1/g, '$2') // emphasis
    .replace(/\s+/g, ' ')
    .trim()
}

/* --------------------------------------------------------------- numbering */

/** Advance the counter stack to `level` and return the active numbers. */
function bump(counters: number[], level: number): number[] {
  counters.length = Math.min(counters.length, level)
  while (counters.length < level) counters.push(0)
  counters[level - 1] = (counters[level - 1] ?? 0) + 1
  return counters.slice(0, level)
}

interface NumberingPattern {
  /** Text-before-symbol pairs, in order. */
  pieces: { prefix: string; kind: string }[]
  /** Text after the last symbol. */
  suffix: string
}

const COUNTING_SYMBOLS = new Set(['1', 'a', 'A', 'i', 'I', '一', '壹', 'あ', 'い', 'ア', 'ｱ', '가', 'א', 'ا'])

/** Read `#set heading(numbering: "…")`, if the document sets one. */
function findNumbering(source: string): NumberingPattern | null {
  const m = /#set\s+heading\s*\([^)]*\bnumbering:\s*"((?:[^"\\]|\\.)*)"/.exec(source)
  return m ? parsePattern(m[1]!.replace(/\\(.)/g, '$1')) : null
}

function parsePattern(pattern: string): NumberingPattern | null {
  const pieces: { prefix: string; kind: string }[] = []
  let prefix = ''
  for (const ch of pattern) {
    if (COUNTING_SYMBOLS.has(ch)) {
      pieces.push({ prefix, kind: ch })
      prefix = ''
    } else {
      prefix += ch
    }
  }
  return pieces.length > 0 ? { pieces, suffix: prefix } : null
}

/**
 * Format counter values with a Typst numbering pattern.
 *
 * Reproduces Typst's own rule for a document deeper than its pattern: the last
 * piece repeats, and when that piece has no prefix the *suffix* stands in as the
 * separator. That asymmetry is not guessable — it is why `"1."` yields `1.1.`
 * while `"§1."` yields `§1§1.`; both were checked against the real binary.
 */
export function applyNumbering(pattern: NumberingPattern, numbers: number[]): string {
  const { pieces, suffix } = pattern
  let out = ''
  numbers.forEach((n, i) => {
    if (i < pieces.length) {
      out += pieces[i]!.prefix + symbol(pieces[i]!.kind, n)
      return
    }
    const last = pieces[pieces.length - 1]!
    out += (last.prefix || suffix) + symbol(last.kind, n)
  })
  return out + suffix
}

const LATIN = 'abcdefghijklmnopqrstuvwxyz'
const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

function symbol(kind: string, n: number): string {
  switch (kind) {
    case '1':
      return String(n)
    case 'a':
      return latin(n)
    case 'A':
      return latin(n).toUpperCase()
    case 'i':
      return roman(n)
    case 'I':
      return roman(n).toUpperCase()
    default:
      // A symbol set this module does not render (CJK, Hebrew, Arabic …).
      // The number still has to appear, so fall back to digits.
      return String(n)
  }
}

/** Spreadsheet-column lettering: 1→a, 26→z, 27→aa. */
function latin(n: number): string {
  let out = ''
  let v = Math.max(1, n)
  while (v > 0) {
    const rem = (v - 1) % 26
    out = LATIN[rem] + out
    v = Math.floor((v - 1) / 26)
  }
  return out
}

function roman(n: number): string {
  if (n <= 0) return String(n)
  let v = n
  let out = ''
  for (const [value, numeral] of ROMAN) {
    while (v >= value) {
      out += numeral
      v -= value
    }
  }
  return out
}
