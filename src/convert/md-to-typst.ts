// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Markdown → Typst source serializer.
 *
 * Walks the ProseMirror document core already produces from markdown
 * (`parseMarkdown`) rather than re-parsing text, so every construct the editor
 * understands — tables, task lists, math, definition lists, raw HTML — arrives
 * as structured nodes instead of being pattern-matched out of a string.
 *
 * Escaping is the part that matters most: Typst gives `#`, `*`, `_`, `@`, `$`,
 * `<`, `\`, `` ` `` syntactic meaning in markup, so prose containing them must
 * be escaped or the generated document fails to compile (or silently renders
 * something else). Code and raw contexts are exempt — escaping there would
 * corrupt the payload.
 */

import type { Node as PMNode, Mark } from 'prosemirror-model'

import type { MarkdownToTypstOptions } from './types'

/** Characters Typst treats as markup syntax when they appear in prose. */
const SPECIAL = /[\\#*_`$<>@\[\]]/g

/**
 * Escape prose so it renders literally in Typst markup.
 * NOT for code/raw blocks — see the module note.
 */
export function escapeTypst(text: string): string {
  return text.replace(SPECIAL, (c) => `\\${c}`)
}

/** Quote a string for a Typst string literal (`"…"`). */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

interface Ctx {
  math: NonNullable<MarkdownToTypstOptions['math']>
  /** Set when any math was emitted through mitex — drives the import header. */
  usedMitex: boolean
  warnings: string[]
}

/** Result of a markdown → Typst conversion. */
export interface MarkdownToTypstOutput {
  typst: string
  warnings: string[]
}

/**
 * Serialize a ProseMirror document (parsed from markdown) to Typst source.
 *
 * Kept separate from the `convertMarkdownToTypst` façade so it can be tested
 * against hand-built documents without going through the markdown parser.
 */
export function docToTypst(
  doc: PMNode,
  options: MarkdownToTypstOptions = {},
): MarkdownToTypstOutput {
  const ctx: Ctx = {
    math: options.math ?? 'mitex',
    usedMitex: false,
    warnings: [],
  }

  const body = serializeBlocks(doc, ctx, '')
  const header = ctx.usedMitex ? '#import "@preview/mitex:0.2.4": mi, mitex\n\n' : ''
  return { typst: (header + body).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', warnings: ctx.warnings }
}

/** Serialize every child of a container as block-level content. */
function serializeBlocks(parent: PMNode, ctx: Ctx, indent: string): string {
  const out: string[] = []
  parent.forEach((child) => {
    const block = serializeBlock(child, ctx, indent)
    if (block) out.push(block)
  })
  return out.join('\n\n')
}

function serializeBlock(node: PMNode, ctx: Ctx, indent: string): string {
  switch (node.type.name) {
    case 'paragraph':
      return indent + serializeInline(node, ctx)

    case 'heading': {
      const level = Number(node.attrs['level'] ?? 1)
      return `${indent}${'='.repeat(Math.min(Math.max(level, 1), 6))} ${serializeInline(node, ctx)}`
    }

    case 'blockquote':
      return `${indent}#quote(block: true)[\n${serializeBlocks(node, ctx, indent + '  ')}\n${indent}]`

    case 'code_block': {
      const lang = String(node.attrs['language'] ?? '')
      // Raw block: contents must NOT be escaped.
      const fence = pickFence(node.textContent)
      return `${indent}${fence}${lang}\n${node.textContent}\n${indent}${fence}`
    }

    case 'horizontal_rule':
      return `${indent}#line(length: 100%)`

    case 'bullet_list':
    case 'ordered_list':
      return serializeList(node, ctx, indent)

    case 'image':
      return indent + serializeImage(node)

    case 'math_block': {
      const formula = node.textContent || String(node.attrs['value'] ?? '')
      return indent + serializeMath(formula, true, ctx)
    }

    case 'table':
      return serializeTable(node, ctx, indent)

    case 'html_block':
      // Typst has no HTML concept — preserve the source as a comment so nothing
      // is silently lost, and tell the caller.
      ctx.warnings.push('HTML blocks were kept as comments — Typst has no HTML equivalent.')
      return node.textContent
        .split('\n')
        .map((l) => `${indent}// ${l}`)
        .join('\n')

    case 'defList':
      return serializeDefList(node, ctx, indent)

    default:
      // Unknown container: fall back to its children so content is never
      // dropped silently.
      if (node.isBlock && node.childCount > 0) return serializeBlocks(node, ctx, indent)
      if (node.isText || node.isInline) return indent + serializeInline(node, ctx)
      return ''
  }
}

/** Choose a fence longer than any backtick run inside the code. */
function pickFence(code: string): string {
  let longest = 0
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

function serializeList(node: PMNode, ctx: Ctx, indent: string): string {
  const ordered = node.type.name === 'ordered_list'
  const rows: string[] = []

  node.forEach((item) => {
    const marker = ordered ? '+' : '-'
    const checked = item.attrs['checked']
    // Task list items have no Typst markup equivalent — render the box.
    const box = checked === true ? '☑ ' : checked === false ? '☐ ' : ''

    // A list item holds blocks; the first joins the marker line, the rest are
    // indented under it.
    const parts: string[] = []
    item.forEach((child) => {
      parts.push(serializeBlock(child, ctx, indent + '  '))
    })
    const [first = '', ...rest] = parts
    rows.push(`${indent}${marker} ${box}${first.trimStart()}`)
    for (const r of rest) rows.push(r)
  })

  return rows.join('\n')
}

function serializeDefList(node: PMNode, ctx: Ctx, indent: string): string {
  const rows: string[] = []
  node.forEach((child) => {
    if (child.type.name === 'defListTerm') {
      rows.push(`${indent}/ ${serializeInline(child, ctx)}:`)
    } else if (child.type.name === 'defListDescription') {
      rows.push(`${indent}  ${serializeBlocks(child, ctx, indent + '  ').trimStart()}`)
    }
  })
  return rows.join('\n')
}

function serializeTable(node: PMNode, ctx: Ctx, indent: string): string {
  const rows: string[][] = []
  let columns = 0

  node.forEach((row) => {
    if (!row.type.name.endsWith('row')) return
    const cells: string[] = []
    row.forEach((cell) => {
      cells.push(serializeBlocks(cell, ctx, '').replace(/\n+/g, ' ').trim())
    })
    columns = Math.max(columns, cells.length)
    rows.push(cells)
  })

  if (rows.length === 0) return ''

  const body = rows
    .map((cells) => `${indent}  ${cells.map((c) => `[${c}]`).join(', ')},`)
    .join('\n')
  return `${indent}#table(\n${indent}  columns: ${columns},\n${body}\n${indent})`
}

function serializeImage(node: PMNode): string {
  const src = String(node.attrs['src'] ?? '')
  const alt = String(node.attrs['alt'] ?? '')
  const call = `image(${quote(src)})`
  // A caption is only meaningful inside a figure.
  //
  // `#` switches markup mode into code mode, so it belongs ONLY on the outermost
  // call. Nesting it (`#figure(#image(…))`) makes the Typst compiler reject the
  // document with "the character `#` is not valid in code".
  return alt ? `#figure(${call}, caption: [${escapeTypst(alt)}])` : `#${call}`
}

/**
 * Emit math. Markdown carries LaTeX, Typst's math syntax is different, so the
 * default routes it through the `mitex` package rather than producing a `.typ`
 * that fails to compile.
 */
function serializeMath(formula: string, block: boolean, ctx: Ctx): string {
  const trimmed = formula.trim()
  if (!trimmed) return ''

  switch (ctx.math) {
    case 'raw':
      return block ? `$ ${trimmed} $` : `$${trimmed}$`
    case 'code':
      return `\`${trimmed}\``
    case 'mitex':
    default:
      ctx.usedMitex = true
      // mitex renders LaTeX verbatim: the formula survives untranslated.
      return block ? `#mitex(${quote(trimmed)})` : `#mi(${quote(trimmed)})`
  }
}

/** Serialize inline content (text + marks) of a block node. */
function serializeInline(parent: PMNode, ctx: Ctx): string {
  let out = ''
  parent.forEach((child) => {
    out += serializeInlineNode(child, ctx)
  })
  return out
}

function serializeInlineNode(node: PMNode, ctx: Ctx): string {
  switch (node.type.name) {
    case 'text':
      return applyMarks(escapeTypst(node.text ?? ''), node.marks, ctx, node)
    case 'hardbreak':
      return ' \\\n'
    case 'image':
      return serializeImage(node)
    case 'math_inline': {
      const formula = node.textContent || String(node.attrs['value'] ?? '')
      return serializeMath(formula, false, ctx)
    }
    case 'html_inline':
      ctx.warnings.push('Inline HTML was dropped — Typst has no HTML equivalent.')
      return ''
    default:
      if (node.isText || node.childCount === 0) return escapeTypst(node.textContent)
      return serializeInline(node, ctx)
  }
}

/** Wrap text in Typst markup for each mark, innermost first. */
function applyMarks(text: string, marks: readonly Mark[], ctx: Ctx, node: PMNode): string {
  let out = text

  // `code` replaces the content wholesale (raw, unescaped) — handle it first
  // and skip the other emphasis wrappers, matching markdown semantics.
  if (marks.some((m) => m.type.name === 'code')) {
    const raw = node.text ?? ''
    const fence = raw.includes('`') ? '``' : '`'
    out = `${fence}${raw}${fence}`
  }

  for (const mark of marks) {
    switch (mark.type.name) {
      case 'strong':
        out = `*${out}*`
        break
      case 'em':
        out = `_${out}_`
        break
      case 'strike_through':
        out = `#strike[${out}]`
        break
      case 'link': {
        const href = String(mark.attrs['href'] ?? '')
        out = `#link(${quote(href)})[${out}]`
        break
      }
      case 'html_mark':
        ctx.warnings.push('Inline HTML formatting was dropped — Typst has no HTML equivalent.')
        break
      default:
        break
    }
  }
  return out
}
