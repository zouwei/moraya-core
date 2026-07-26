// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Which view mode a document opens in, per flavor.
 *
 * The rule is small but it has to be identical on desktop, web and mobile, or
 * the same document opens differently depending on where you touch it. Keeping
 * it here means there is one definition of "what does Typst open as" rather
 * than three that drift.
 *
 * The behaviour: each flavor remembers the mode the user last chose *for that
 * flavor*. Markdown and Typst are independent — reading a `.typ` in source mode
 * must not turn every markdown note into source mode as well. Until the user
 * chooses, each flavor uses its own default.
 */

import type { DocumentFlavor } from './types'

/** Editor view modes, shared with each platform's own store type. */
export type DocumentViewMode = 'visual' | 'source' | 'split'

/**
 * Opening defaults.
 *
 * Markdown is WYSIWYG — its source is a detail. Typst is a *compiler* flavor:
 * the document is written as source and only exists as pages after a compile,
 * so side-by-side is the only mode that shows what is actually being produced.
 */
export const DEFAULT_VIEW_MODES: Readonly<Record<DocumentFlavor, DocumentViewMode>> = {
  markdown: 'visual',
  typst: 'split',
}

/** What each flavor is currently remembered as; absent = still on its default. */
export type ViewModeMemory = Partial<Record<DocumentFlavor, DocumentViewMode>>

/** The mode to apply when a document of `flavor` becomes active. */
export function viewModeForFlavor(
  memory: ViewModeMemory | undefined,
  flavor: DocumentFlavor,
): DocumentViewMode {
  return memory?.[flavor] ?? DEFAULT_VIEW_MODES[flavor]
}

/**
 * Record a mode the user chose while a document of `flavor` was on screen.
 *
 * Returns a new memory rather than mutating, so a caller can hold it in
 * reactive state and let the change propagate.
 */
export function rememberViewMode(
  memory: ViewModeMemory | undefined,
  flavor: DocumentFlavor,
  mode: DocumentViewMode,
): ViewModeMemory {
  return { ...memory, [flavor]: mode }
}
