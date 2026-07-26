// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Typst source → Markdown, without a compiler.
 *
 * The high-fidelity route for this direction is to *evaluate* the document (see
 * `convertTypstToMarkdown`), because Typst is a programming language. That
 * requires an HTML-capable compiler, which the desktop's native binary has and
 * the browser's WASM build does not: typst.ts 0.7 compiles to `vector` and
 * `pdf` only. Rendering to SVG and scraping glyphs back would lose every bit of
 * structure, so the browser needs a source-level route instead.
 *
 * This reads the *markup* subset of Typst — headings, lists, emphasis, raw
 * blocks, tables, links, images, quotes, math — which covers hand-written prose
 * and, exactly, the output of `docToTypst`, so a Markdown → Typst → Markdown
 * round trip returns. Scripting (`#let`, `#show`, `#for`, `#import`, arbitrary
 * function calls) cannot be resolved without evaluation: those lines are
 * dropped and reported in `warnings` rather than leaked as literal text.
 */

/** Conversion result plus anything that could not be represented. */
export interface TypstSourceToMarkdownOutput {
  markdown: string
  warnings: string[]
}

interface Ctx {
  warnings: string[]
}

const SCRIPTING = 'Typst code (#let / #show / #import and function calls) was skipped — converting it needs the document to be run.'

/** Characters `escapeTypst` adds; a backslash before any of them is ours. */
const TYPST_ESCAPED = new Set(['\\', '#', '*', '_', '`', '$', '<', '>', '@', '[', ']'])

export function typstSourceToMarkdown(source: string): TypstSourceToMarkdownOutput {
  const ctx: Ctx = { warnings: [] }
  const md = blocks(source.split('\n'), ctx)
  return {
    markdown: md.replace(/\n{3,}/g, '\n\n').trim() ? `${md.replace(/\n{3,}/g, '\n\n').trim()}\n` : '',
    warnings: [...new Set(ctx.warnings)],
  }
}

/* ------------------------------------------------------------------ blocks */

function blocks(lines: string[], ctx: Ctx): string {
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i] ?? ''
    const line = raw.trim()

    if (!line) { i++; continue }

    // Raw block — copied through untouched, including its fence.
    if (line.startsWith('```')) {
      const fence: string[] = [line]
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        fence.push(lines[i] ?? '')
        i++
      }
      if (i < lines.length) { fence.push('```'); i++ }
      out.push(fence.join('\n'))
      continue
    }

    // Display math: `$ … $` on its own, possibly spanning lines.
    if (line.startsWith('$') && line !== '$') {
      const buf: string[] = [line]
      while (!closesMath(buf.join('\n')) && i + 1 < lines.length) {
        i++
        buf.push(lines[i] ?? '')
      }
      i++
      const body = buf.join('\n').replace(/^\$/, '').replace(/\$$/, '').trim()
      out.push(`$$${body}$$`)
      continue
    }

    const heading = /^(=+)\s+(.*)$/.exec(line)
    if (heading) {
      out.push(`${'#'.repeat(heading[1]!.length)} ${inline(heading[2]!, ctx)}`)
      i++
      continue
    }

    if (/^[-+]\s/.test(line)) {
      const { text, next } = takeList(lines, i, ctx)
      out.push(text)
      i = next
      continue
    }

    if (line.startsWith('#')) {
      const { text, next } = call(lines, i, ctx)
      if (text) out.push(text)
      i = next
      continue
    }

    // Paragraph: consecutive plain lines, joined the way Typst lays them out.
    const para: string[] = []
    while (i < lines.length) {
      const l = (lines[i] ?? '').trim()
      if (!l || l.startsWith('#') || l.startsWith('```') || /^(=+)\s/.test(l) || /^[-+]\s/.test(l)) break
      para.push(l)
      i++
    }
    if (para.length) out.push(inline(para.join('\n'), ctx))
  }

  return out.join('\n\n')
}

/** A display-math block is closed once its `$` count is even. */
function closesMath(text: string): boolean {
  const unescaped = text.replace(/\\\$/g, '')
  return (unescaped.match(/\$/g)?.length ?? 0) >= 2
}

/**
 * Read one list, including nested levels.
 *
 * Typst marks bullets with `-` and enumerations with `+`; nesting is by
 * indentation, the same rule markdown uses, so the indent carries over as-is.
 */
function takeList(lines: string[], start: number, ctx: Ctx): { text: string; next: number } {
  const rows: string[] = []
  let i = start
  // Per indent level, how many items have been emitted — enumerations need a
  // running number, and a deeper level restarts.
  const counters = new Map<number, number>()

  while (i < lines.length) {
    const raw = lines[i] ?? ''
    const m = /^(\s*)([-+])\s+(.*)$/.exec(raw)
    if (!m) {
      if (!raw.trim()) break
      // A continuation line of the previous item.
      if (rows.length && /^\s+\S/.test(raw)) { rows[rows.length - 1] += ` ${inline(raw.trim(), ctx)}`; i++; continue }
      break
    }
    const depth = m[1]!.length
    for (const level of [...counters.keys()]) if (level > depth) counters.delete(level)
    const marker = m[2] === '+' ? `${(counters.get(depth) ?? 0) + 1}. ` : '- '
    counters.set(depth, (counters.get(depth) ?? 0) + 1)
    rows.push(`${' '.repeat(depth)}${marker}${inline(m[3]!, ctx)}`)
    i++
  }

  return { text: rows.join('\n'), next: i }
}

/**
 * Handle a `#…` construct at the start of a block.
 *
 * Only the document-structure functions have a markdown equivalent; anything
 * else is code, which cannot be resolved without running the document.
 */
function call(lines: string[], start: number, ctx: Ctx): { text: string; next: number } {
  const { text: chunk, next } = takeBalanced(lines, start)
  const name = /^#([a-zA-Z][\w.-]*)/.exec(chunk.trim())?.[1] ?? ''
  const args = parseArgs(chunk, chunk.indexOf(name) + name.length)

  switch (name) {
    case 'line':
    case 'pagebreak':
      return { text: '---', next }

    case 'quote': {
      const body = args.brackets[0] ?? ''
      const inner = blocks(dedent(body).split('\n'), ctx)
      return { text: inner.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n'), next }
    }

    case 'table':
      return { text: table(args.paren ?? '', ctx), next }

    case 'figure': {
      const src = firstImageSrc(args.paren ?? '')
      const caption = /caption:\s*\[/.exec(args.paren ?? '')
        ? bracketAt(args.paren ?? '', (args.paren ?? '').indexOf('[', /caption:\s*\[/.exec(args.paren ?? '')!.index))
        : ''
      if (src !== null) return { text: `![${inline(caption, ctx)}](${src})`, next }
      break
    }

    case 'image': {
      const src = firstString(args.paren ?? '')
      if (src !== null) return { text: `![](${src})`, next }
      break
    }

    case 'mitex': {
      const tex = firstString(args.paren ?? '')
      if (tex !== null) return { text: `$$${tex}$$`, next }
      break
    }

    case 'import':
      // The mitex import `docToTypst` emits is an implementation detail of the
      // forward conversion, not document content — drop it silently.
      if (/@preview\/mitex/.test(chunk)) return { text: '', next }
      break

    default:
      break
  }

  // A `#strong[…]` / `#mi("…")` wrapper standing alone on its line is still
  // inline content — it only *looks* like a block because of where it sits.
  if (!isScripting(name) && (args.brackets.length > 0 || INLINE_FNS.has(name))) {
    return { text: inline(chunk.trim(), ctx), next }
  }

  ctx.warnings.push(SCRIPTING)
  return { text: '', next }
}

/** Functions that carry inline content rather than document structure. */
const INLINE_FNS = new Set(['link', 'strike', 'strong', 'emph', 'mi', 'text', 'box'])

function isScripting(name: string): boolean {
  return ['let', 'show', 'set', 'import', 'include', 'for', 'while', 'if', 'context'].includes(name)
}

/**
 * Convert `#table(columns: n, [a], [b], …)` back to a GFM table.
 *
 * Typst tables are a flat cell list plus a column count — the row structure has
 * to be rebuilt from it. The first row becomes the header, because that is the
 * only shape markdown can express.
 */
function table(argsSrc: string, ctx: Ctx): string {
  const columns = Number(/columns:\s*(\d+)/.exec(argsSrc)?.[1] ?? 0)
  const cells: string[] = []
  for (let i = 0; i < argsSrc.length; i++) {
    if (argsSrc[i] !== '[') continue
    const body = bracketAt(argsSrc, i)
    cells.push(inline(body, ctx).replace(/\|/g, '\\|'))
    i += body.length + 1
  }
  if (columns <= 0 || cells.length === 0) {
    ctx.warnings.push('A table could not be converted and was dropped.')
    return ''
  }

  const rows: string[][] = []
  for (let i = 0; i < cells.length; i += columns) {
    const row = cells.slice(i, i + columns)
    while (row.length < columns) row.push('')
    rows.push(row)
  }
  const [head = [], ...body] = rows
  return [
    `| ${head.join(' | ')} |`,
    `| ${Array(columns).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n')
}

/* ------------------------------------------------------------------ inline */

/**
 * Convert inline Typst markup.
 *
 * Scans character by character rather than chaining regexes: `#link("u")[*a*]`
 * nests, and a regex pass would either miss the nesting or rewrite text inside
 * raw spans and math, where the source must survive untouched.
 */
function inline(src: string, ctx: Ctx): string {
  let out = ''
  let i = 0

  while (i < src.length) {
    const ch = src[i]!

    // `\#` etc. are escapes this converter's counterpart added — undo them.
    if (ch === '\\') {
      const nxt = src[i + 1]
      if (nxt && TYPST_ESCAPED.has(nxt)) { out += nxt; i += 2; continue }
      // A trailing backslash is Typst's hard line break.
      if (nxt === undefined || nxt === '\n') { out += '  \n'; i += 2; continue }
      out += ch
      i++
      continue
    }

    // Raw spans and math carry their own syntax — copy verbatim.
    if (ch === '`') {
      const fence = src.startsWith('``', i) ? '``' : '`'
      const end = src.indexOf(fence, i + fence.length)
      if (end === -1) { out += ch; i++; continue }
      out += src.slice(i, end + fence.length)
      i = end + fence.length
      continue
    }
    if (ch === '$') {
      const end = src.indexOf('$', i + 1)
      if (end === -1) { out += ch; i++; continue }
      out += src.slice(i, end + 1)
      i = end + 1
      continue
    }

    if (ch === '#') {
      const m = /^#([a-zA-Z][\w.-]*)/.exec(src.slice(i))
      if (m) {
        const args = parseArgs(src, i + m[0].length)
        out += fn(m[1]!, args, ctx)
        i = args.end
        continue
      }
    }

    if (ch === '*' || ch === '_') {
      const end = findClose(src, i, ch)
      if (end > i) {
        const inner = inline(src.slice(i + 1, end), ctx)
        out += ch === '*' ? `**${inner}**` : `*${inner}*`
        i = end + 1
        continue
      }
    }

    out += ch
    i++
  }

  return out
}

function fn(name: string, args: Args, ctx: Ctx): string {
  const body = args.brackets[0] ?? ''
  switch (name) {
    case 'link': {
      const href = firstString(args.paren ?? '') ?? ''
      const text = body ? inline(body, ctx) : href
      return `[${text}](${href})`
    }
    case 'strike':
      return `~~${inline(body, ctx)}~~`
    case 'strong':
      return `**${inline(body, ctx)}**`
    case 'emph':
      return `*${inline(body, ctx)}*`
    case 'image':
      return `![](${firstString(args.paren ?? '') ?? ''})`
    case 'mi':
    case 'mitex': {
      const tex = firstString(args.paren ?? '')
      return tex === null ? '' : `$${tex}$`
    }
    case 'text':
    case 'box':
    case 'block':
      // Styling wrappers: the style is lost, the content is not.
      return inline(body, ctx)
    default:
      ctx.warnings.push(SCRIPTING)
      return body ? inline(body, ctx) : ''
  }
}

/**
 * Find the closing `*` / `_` of an emphasis run.
 *
 * Returns -1 when the delimiter is not emphasis at all (a bare `*` in prose, or
 * a `_` inside `snake_case`), which the caller emits as a literal.
 */
function findClose(src: string, open: number, delim: string): number {
  if (src[open + 1] === undefined || /\s/.test(src[open + 1]!)) return -1
  if (delim === '_' && open > 0 && /\w/.test(src[open - 1]!)) return -1
  for (let i = open + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === delim && !/\s/.test(src[i - 1] ?? ' ')) return i
  }
  return -1
}

/* ----------------------------------------------------------------- parsing */

interface Args {
  /** Contents of `( … )`, if present. */
  paren: string | null
  /** Contents of each `[ … ]` group that follows. */
  brackets: string[]
  /** Index just past the whole call. */
  end: number
}

/** Read the `( … )` and `[ … ]` groups that follow a `#name`. */
function parseArgs(src: string, from: number): Args {
  let i = from
  let paren: string | null = null
  const brackets: string[] = []

  if (src[i] === '(') {
    paren = groupAt(src, i, '(', ')')
    i += paren.length + 2
  }
  while (src[i] === '[') {
    const body = groupAt(src, i, '[', ']')
    brackets.push(body)
    i += body.length + 2
  }
  return { paren, brackets, end: i }
}

/**
 * Return the contents of the group opening at `open`.
 *
 * Counts nesting and skips string literals, so `#link("a)b")[x]` and
 * `#table([a], [[b]])` both come apart correctly.
 */
function groupAt(src: string, open: number, o: string, c: string): string {
  let depth = 0
  let inStr = false
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === o) depth++
    else if (ch === c) {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return src.slice(open + 1)
}

const bracketAt = (src: string, open: number) => groupAt(src, open, '[', ']')

/** First string literal in an argument list, unescaped. */
function firstString(argsSrc: string): string | null {
  const m = /"((?:[^"\\]|\\.)*)"/.exec(argsSrc)
  return m ? m[1]!.replace(/\\(.)/g, '$1') : null
}

function firstImageSrc(argsSrc: string): string | null {
  // Inside `#figure(…)` the arguments are already code, so the correct call is
  // bare — `image("…")`. Documents written before that fix (and by other tools)
  // may carry the invalid `#image("…")` form, which the Typst compiler rejects
  // but which we still read back so no content is lost on conversion.
  const m = /#?image\s*\(/.exec(argsSrc)
  if (!m) return null
  const parenAt = m.index + m[0].length - 1
  return firstString(groupAt(argsSrc, parenAt, '(', ')'))
}

/**
 * Join the lines of one bracketed construct.
 *
 * A `#quote(block: true)[…]` or `#table(…)` spans lines, so the block reader
 * has to consume until the delimiters balance rather than stopping at `\n`.
 */
function takeBalanced(lines: string[], start: number): { text: string; next: number } {
  let depth = 0
  let inStr = false
  const buf: string[] = []

  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? ''
    buf.push(line)
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!
      if (inStr) {
        if (ch === '\\') { j++; continue }
        if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
    }
    if (depth <= 0) return { text: buf.join('\n'), next: i + 1 }
  }
  return { text: buf.join('\n'), next: lines.length }
}

/** Remove the common leading indentation a nested block was written with. */
function dedent(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim())
  const min = Math.min(...lines.map((l) => /^\s*/.exec(l)![0].length), Infinity)
  if (!Number.isFinite(min) || min === 0) return text
  return text.split('\n').map((l) => l.slice(min)).join('\n')
}
