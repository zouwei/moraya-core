// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Link text plugin — Typora-style inline link editing:
 *
 * 1. **Decoration**: Scans text nodes for `[...](...)` literal patterns and
 *    applies a muted CSS class so users can distinguish link syntax from text.
 *
 * 2. **Collapse**: When cursor leaves a `[text](url)` pattern (both non-empty),
 *    auto-convert to a ProseMirror link mark (rendered as clickable link).
 *
 * 3. **Expand**: When cursor enters a rendered link mark, replace the mark
 *    with literal text `[text](url)` so the user can edit both text and URL
 *    directly inline.
 *
 * Schema-agnostic: uses `state.schema.marks.link` rather than an imported
 * singleton, so the plugin works against any consumer-injected schema.
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const pluginKey = new PluginKey('moraya-link-text')

/** Matches [text](url) for decoration — allows empty text or url. */
const LINK_PATTERN_DECO = /\[([^\]]*)\]\(([^)]*)\)/g

/** Matches [text](url) for conversion — requires non-empty text AND url. */
const LINK_PATTERN_CONVERT = /\[([^\]]+)\]\(([^)]+)\)/g

interface LinkMatch {
  from: number
  to: number
  text: string
  url: string
}

interface LinkMarkInfo {
  from: number
  to: number
  text: string
  href: string
}

/**
 * Find all [text](url) literal text patterns NOT inside a link mark.
 */
function findLinkPatterns(state: EditorState, regex: RegExp): LinkMatch[] {
  const matches: LinkMatch[] = []
  const linkType = state.schema.marks.link

  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    if (linkType && linkType.isInSet(node.marks)) return

    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(node.text)) !== null) {
      matches.push({
        from: pos + m.index,
        to: pos + m.index + m[0].length,
        text: m[1] ?? '',
        url: m[2] ?? '',
      })
    }
  })

  return matches
}

/**
 * Find [text](url) patterns only within the textblock containing `pos`.
 * Much cheaper than full-doc scan for appendTransaction checks.
 */
function findLinkPatternsInBlock(state: EditorState, pos: number, regex: RegExp): LinkMatch[] {
  const matches: LinkMatch[] = []
  const linkType = state.schema.marks.link
  let resolved
  try { resolved = state.doc.resolve(pos) } catch { return matches }
  const parent = resolved.parent
  if (!parent.isTextblock) return matches

  const base = resolved.start()
  let nodePos = base
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    if (child.isText && child.text && !(linkType && linkType.isInSet(child.marks))) {
      regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(child.text)) !== null) {
        matches.push({
          from: nodePos + m.index,
          to: nodePos + m.index + m[0].length,
          text: m[1] ?? '',
          url: m[2] ?? '',
        })
      }
    }
    nodePos += child.nodeSize
  }
  return matches
}

function buildDecorations(state: EditorState): DecorationSet {
  const matches = findLinkPatterns(state, LINK_PATTERN_DECO)
  if (matches.length === 0) return DecorationSet.empty

  const decorations = matches.map((m) =>
    Decoration.inline(m.from, m.to, { class: 'link-text-syntax' }),
  )
  return DecorationSet.create(state.doc, decorations)
}

function cursorInsidePattern(pos: number, matches: LinkMatch[]): boolean {
  return matches.some((m) => pos >= m.from && pos <= m.to)
}

/**
 * Find link mark range containing `pos`. Returns mark info or null.
 */
function findLinkMarkAtPos(state: EditorState, pos: number): LinkMarkInfo | null {
  const linkType = state.schema.marks.link
  if (!linkType) return null

  let resolved
  try { resolved = state.doc.resolve(pos) } catch { return null }
  const parent = resolved.parent
  if (!parent.isTextblock) return null

  const base = resolved.start()
  let runFrom = -1
  let runTo = -1
  let href = ''
  const textParts: string[] = []
  let nodePos = base

  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    const childEnd = nodePos + child.nodeSize
    const lm = linkType.isInSet(child.marks)

    if (lm) {
      if (runFrom === -1) {
        runFrom = nodePos
        href = (lm.attrs.href as string) || ''
        textParts.length = 0
      }
      textParts.push(child.text || '')
      runTo = childEnd
    } else {
      if (runFrom !== -1 && pos >= runFrom && pos <= runTo) {
        return { from: runFrom, to: runTo, text: textParts.join(''), href }
      }
      runFrom = -1
      runTo = -1
      href = ''
      textParts.length = 0
    }
    nodePos = childEnd
  }

  if (runFrom !== -1 && pos >= runFrom && pos <= runTo) {
    return { from: runFrom, to: runTo, text: textParts.join(''), href }
  }
  return null
}

export function createLinkTextPlugin(): Plugin {
  return new Plugin({
    key: pluginKey,

    state: {
      init(_, state) { return buildDecorations(state) },
      apply(tr, old, _, newState) {
        // Decorations depend only on document content, not cursor position.
        // Selection-only changes can reuse existing decorations via mapping.
        if (!tr.docChanged) return old
        // Full-delete: new doc is tiny, rebuild directly (skip mapping old decos)
        if (tr.getMeta('full-delete')) return DecorationSet.empty
        return buildDecorations(newState)
      },
    },

    props: {
      decorations(state) { return this.getState(state) },
    },

    appendTransaction(transactions, oldState, newState) {
      // Skip if this plugin already produced a transaction in this batch
      if (transactions.some((tr) => tr.getMeta(pluginKey))) return null

      // Skip for full-delete transactions (entire document replaced)
      if (transactions.some((tr) => tr.getMeta('full-delete'))) return null

      const selChanged = transactions.some((tr) => tr.selectionSet)
      const docChanged = transactions.some((tr) => tr.docChanged)
      if (!selChanged && !docChanged) return null

      const linkType = newState.schema.marks.link
      if (!linkType) return null
      if (!newState.selection.empty) return null

      const newPos = newState.selection.from
      const oldPos = oldState.selection.from

      // ── EXPAND: cursor just entered a link mark ──
      const linkInfo = findLinkMarkAtPos(newState, newPos)
      if (linkInfo) {
        // Only expand if cursor was NOT in a link mark in old state
        const oldLinkInfo = findLinkMarkAtPos(oldState, oldPos)
        if (!oldLinkInfo) {
          const { from, to, text, href } = linkInfo
          const literal = `[${text}](${href})`
          const textNode = newState.schema.text(literal)
          const tr = newState.tr.replaceWith(from, to, textNode)
          tr.setMeta(pluginKey, 'expand')
          tr.setMeta('addToHistory', false)

          // Place cursor at same relative offset within text portion
          const relPos = Math.max(0, Math.min(newPos - from, text.length))
          const cursorPos = from + 1 + relPos // +1 for the `[`
          try {
            tr.setSelection(TextSelection.create(tr.doc, cursorPos))
          } catch { /* ignore */ }
          return tr
        }
        return null
      }

      // ── COLLAPSE: cursor left a [text](url) pattern ──
      // Use block-local scan instead of full-doc scan for performance.
      const oldBlockMatches = findLinkPatternsInBlock(oldState, oldPos, LINK_PATTERN_CONVERT)
      if (oldBlockMatches.length === 0) return null

      const wasIn = oldBlockMatches.find((m) => oldPos >= m.from && oldPos <= m.to)
      if (!wasIn) return null

      // Find the pattern in the new state (scan only the affected block)
      let target: LinkMatch | undefined
      if (docChanged) {
        let mappedFrom = wasIn.from
        for (const t of transactions) {
          mappedFrom = t.mapping.map(mappedFrom)
        }
        // After large deletes, the mapped position may be invalid — bail out
        if (mappedFrom < 0 || mappedFrom > newState.doc.content.size) return null
        const newBlockMatches = findLinkPatternsInBlock(newState, mappedFrom, LINK_PATTERN_CONVERT)
        if (cursorInsidePattern(newPos, newBlockMatches)) return null
        target = newBlockMatches.find((m) => Math.abs(m.from - mappedFrom) < 3)
      } else {
        const newBlockMatches = findLinkPatternsInBlock(newState, wasIn.from, LINK_PATTERN_CONVERT)
        if (cursorInsidePattern(newPos, newBlockMatches)) return null
        target = newBlockMatches.find((m) => m.from === wasIn.from && m.to === wasIn.to)
      }

      if (!target || !target.text || !target.url) return null

      const mark = linkType.create({ href: target.url })
      const linkNode = newState.schema.text(target.text, [mark])
      const tr = newState.tr.replaceWith(target.from, target.to, linkNode)
      tr.setMeta(pluginKey, 'collapse')
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}
