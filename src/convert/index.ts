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
import type { ConversionResult, MarkdownToTypstOptions } from './types'

export { escapeTypst, docToTypst, type MarkdownToTypstOutput } from './md-to-typst'
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
