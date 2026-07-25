// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Document-flavor detection.
 *
 * A document's markup language is decided by its file extension, at every entry
 * point (open dialog, file tree, tab restore, save-as). Consumers previously
 * re-implemented this per platform — and per layer within a platform — which is
 * exactly how `.typ` ends up recognized by one code path and not another.
 */

import {
  MARKDOWN_EXTENSIONS,
  TYPST_EXTENSIONS,
  type DocumentFlavor,
} from './types'

/** Every extension Moraya opens as an editable document. */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  ...MARKDOWN_EXTENSIONS,
  ...TYPST_EXTENSIONS,
]

function endsWithExt(nameOrPath: string, ext: string): boolean {
  return nameOrPath.toLowerCase().endsWith(ext)
}

/** True when the name/path is a Typst document. */
export function isTypstFile(nameOrPath: string): boolean {
  return TYPST_EXTENSIONS.some((ext) => endsWithExt(nameOrPath, ext))
}

/** True when the name/path is a markdown document. */
export function isMarkdownFile(nameOrPath: string): boolean {
  return MARKDOWN_EXTENSIONS.some((ext) => endsWithExt(nameOrPath, ext))
}

/** True when the name/path is a document Moraya can open in an editor. */
export function isDocumentFile(nameOrPath: string): boolean {
  return DOCUMENT_EXTENSIONS.some((ext) => endsWithExt(nameOrPath, ext))
}

/**
 * The flavor a file should be opened with. Unknown extensions fall back to
 * markdown, matching the historical behavior of treating any opened text file
 * as markdown.
 */
export function flavorForFile(nameOrPath: string): DocumentFlavor {
  return isTypstFile(nameOrPath) ? 'typst' : 'markdown'
}

/**
 * The document extension of a name/path (`.md`, `.typ`, …) preserving its
 * original case, or `''` when it isn't a document — which also identifies
 * directories to callers that only deal with documents and folders.
 */
export function documentExtension(nameOrPath: string): string {
  const lower = nameOrPath.toLowerCase()
  for (const ext of DOCUMENT_EXTENSIONS) {
    if (lower.endsWith(ext)) return nameOrPath.slice(-ext.length)
  }
  return ''
}

/** The canonical extension for a flavor, used when saving a new document. */
export function extensionForFlavor(flavor: DocumentFlavor): string {
  return flavor === 'typst' ? TYPST_EXTENSIONS[0] : MARKDOWN_EXTENSIONS[0]
}

/**
 * Force `name` to carry the extension of `flavor`.
 *
 * A suggested file name is often derived from document content and arrives
 * carrying the *other* flavor's extension (or none). Save-as must not let a
 * Typst document be written as `.md`, or it would reopen as markdown.
 */
export function withFlavorExtension(name: string, flavor: DocumentFlavor): string {
  const want = extensionForFlavor(flavor)
  if (endsWithExt(name, want)) return name
  const existing = documentExtension(name)
  const base = existing ? name.slice(0, -existing.length) : name
  return `${base}${want}`
}
