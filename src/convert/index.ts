// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/convert — Markdown ⇄ Typst source conversion.
 *
 * Consumed by PC / Web / Mobile behind a single UI action per platform. See
 * ./types for why the two directions take different routes.
 */

import type { Schema } from 'prosemirror-model'

import { parseMarkdown } from '../markdown'
import { docToTypst } from './md-to-typst'
import { htmlToMarkdown } from './html-to-md'
import { typstSourceToMarkdown } from './typst-to-md'
import type {
  ConversionResult,
  MarkdownToTypstOptions,
  TypstToMarkdownDeps,
} from './types'

export { escapeTypst, docToTypst, type MarkdownToTypstOutput } from './md-to-typst'
export { htmlToMarkdown, type HtmlToMarkdownOutput } from './html-to-md'
export { typstSourceToMarkdown, type TypstSourceToMarkdownOutput } from './typst-to-md'
export type {
  ConversionResult,
  ConversionFailure,
  MarkdownToTypstOptions,
  TypstToMarkdownDeps,
} from './types'

/**
 * Convert markdown source to Typst source.
 *
 * Never throws: a malformed document comes back as `{ ok: false }` so the
 * caller can surface it next to the editor instead of unwinding.
 *
 * The result is intended to be written to a NEW `.typ` document — conversion is
 * lossy (raw HTML, and any layout the markdown implied), and `warnings` lists
 * what could not be carried over.
 */
export function convertMarkdownToTypst(
  markdown: string,
  schema: Schema,
  options: MarkdownToTypstOptions = {},
): ConversionResult {
  try {
    const doc = parseMarkdown(markdown, schema)
    const { typst, warnings } = docToTypst(doc, options)
    // Deduplicate: a warning fires per offending node, not per document.
    return { ok: true, content: typst, warnings: [...new Set(warnings)] }
  } catch (err) {
    return {
      ok: false,
      reason: 'source-error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Convert Typst source to markdown.
 *
 * Two routes, in order of fidelity:
 *
 *  1. **Evaluate.** Typst is a programming language — `#let`, functions,
 *     `#import` and show rules only resolve by running the document. When an
 *     HTML-capable compiler is supplied it *is* that evaluator: compile to
 *     HTML, convert the HTML. This is the desktop path (native `typst` binary).
 *  2. **Read the markup.** typst.ts's WASM build compiles to `vector` and `pdf`
 *     only, so a browser has no evaluator, and scraping rendered SVG back would
 *     lose every bit of structure. There, the markup subset is converted from
 *     source instead — enough for prose and for a Markdown → Typst → Markdown
 *     round trip, with anything scripted reported in `warnings`.
 *
 * Conversion is lossy either way: layout, shapes and generated content
 * (`#outline`, counters, `context`) have no markdown equivalent.
 *
 * Never throws — a failed compile falls back to route 2 rather than erroring,
 * since a partial document beats none.
 */
export async function convertTypstToMarkdown(
  typstSource: string,
  deps: TypstToMarkdownDeps = {},
): Promise<ConversionResult> {
  if (!typstSource.trim()) {
    return { ok: false, reason: 'unsupported', message: 'The document is empty.' }
  }

  if (deps.compiler) {
    try {
      const artifact = await deps.compiler.compile(typstSource, 'html')
      // The compiler returns HTML either as a page string or written to a file;
      // only the in-memory form is usable here.
      const html = artifact.pages[0] ?? ''
      if (html.trim()) {
        const { markdown, warnings } = htmlToMarkdown(html)
        if (markdown.trim()) return { ok: true, content: markdown, warnings }
      }
    } catch {
      // Fall through: no HTML writer, or the document failed to compile.
    }
  }

  const { markdown, warnings } = typstSourceToMarkdown(typstSource)
  if (!markdown.trim()) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'Nothing in this document could be converted to Markdown.',
    }
  }
  return { ok: true, content: markdown, warnings }
}
