// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Inline mark convert plugin — three responsibilities:
 *
 * 1. **Backtick collapse**: Auto-converts `` `text` `` patterns to code marks
 *    when the cursor leaves the backtick pair. Handles the workflow where the
 *    user types two backticks first, moves the cursor between them, types
 *    content, then leaves.
 *
 * 2. **Cursor target**: Inserts a zero-width space (U+200B) after formatting
 *    marks (`code`, `strong`, `em`, `strike_through`) at the end of textblocks.
 *    WebKit can't position the caret after certain inline elements when there
 *    is no subsequent text node, so the ZWSP provides a DOM target for both
 *    keyboard navigation and mouse clicks.
 *
 * 3. **Stored marks at code–ZWSP boundary**: code is `inclusive: false` so
 *    `marks()` at the boundary excludes it. The plugin proactively sets stored
 *    marks so typing at the boundary still extends code. ArrowRight clears the
 *    stored marks (handled in `editor-props-plugin.ts` `'code-escape'` meta).
 *    `strong` / `em` / `strike_through` are `inclusive: true` so `marks()`
 *    already includes them at the boundary — no `storedMarks` manipulation
 *    needed for those.
 *
 * The U+200B is stripped during markdown serialization (see `serializeMarkdown`).
 */

import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'

const pluginKey = new PluginKey('moraya-inline-code-convert')

/** Zero-width space used as cursor anchor after trailing formatting marks. */
export const ZWSP = '​'

/**
 * Marks that get a ZWSP cursor target when they are the last content in a
 * textblock. Includes non-inclusive marks (code) and inclusive formatting
 * marks (strong, em, strike_through) — all need an escape position at end
 * of paragraph so ArrowRight doesn't jump straight to the next block.
 */
const ZWSP_MARK_NAMES = ['code', 'strong', 'em', 'strike_through'] as const

function hasZwspTargetMark(
  marks: readonly import('prosemirror-model').Mark[],
  state: EditorState,
): boolean {
  return ZWSP_MARK_NAMES.some(name => {
    const mt = state.schema.marks[name]
    return mt && mt.isInSet(marks)
  })
}

/** Matches `` `text` `` (backtick-delimited) for conversion — requires non-empty content. */
const CODE_PATTERN = /`([^`]+)`/g

interface CodeMatch {
  from: number
  to: number
  content: string
}

/**
 * Find `` `text` `` patterns in the textblock containing `pos`.
 * Only scans unmarked text nodes (skips text already marked as code).
 */
function findCodePatternsInBlock(state: EditorState, pos: number): CodeMatch[] {
  const matches: CodeMatch[] = []
  const codeType = state.schema.marks.code

  let resolved
  try { resolved = state.doc.resolve(pos) } catch { return matches }
  const parent = resolved.parent
  if (!parent.isTextblock) return matches

  // Skip code blocks — backticks are literal there
  if (parent.type.spec.code) return matches

  const base = resolved.start()
  let nodePos = base
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    if (child.isText && child.text && !(codeType && codeType.isInSet(child.marks))) {
      CODE_PATTERN.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CODE_PATTERN.exec(child.text)) !== null) {
        matches.push({
          from: nodePos + m.index,
          to: nodePos + m.index + m[0].length,
          content: m[1] ?? '',
        })
      }
    }
    nodePos += child.nodeSize
  }
  return matches
}

/**
 * Check if a textblock's last content is a formatting mark that needs a
 * trailing cursor target (U+200B). Returns the insert position, or -1.
 */
function needsCursorTarget(state: EditorState): number {
  const { $head } = state.selection
  if (!$head) return -1
  const parent = $head.parent
  if (!parent.isTextblock || parent.type.spec.code || parent.childCount === 0) return -1

  const lastChild = parent.lastChild
  if (!lastChild?.isText) return -1

  // Already has a trailing ZWSP — no action needed. Covers both forms: a
  // separate unmarked node (non-inclusive marks like `code`) AND a ZWSP
  // merged into the SAME text node as the marked run (inclusive marks —
  // strong/em/strike_through — pick up the mark at insertText time, per
  // ProseMirror's inclusive-mark boundary rule). Missing the merged form
  // here caused repeated no-op selection-set transactions (e.g. clicking
  // back into an already-targeted run) to insert a SECOND ZWSP each time.
  if (lastChild.text?.endsWith(ZWSP)) return -1

  // Walk backwards skipping existing ZWSP-only unmarked nodes.
  // If the last meaningful child has a target mark → insert ZWSP at end.
  for (let i = parent.childCount - 1; i >= 0; i--) {
    const child = parent.child(i)
    if (child.isText && !hasZwspTargetMark(child.marks, state) && child.text === ZWSP) continue
    if (child.isText && hasZwspTargetMark(child.marks, state)) {
      return $head.start() + parent.content.size // insert at end of textblock content
    }
    break // non-target-mark, non-ZWSP content found — no target needed
  }
  return -1
}

export function createInlineCodeConvertPlugin(): Plugin {
  return new Plugin({
    key: pluginKey,

    appendTransaction(transactions, oldState, newState) {
      // Skip if this plugin already produced a transaction
      if (transactions.some((tr) => tr.getMeta(pluginKey))) return null
      if (transactions.some((tr) => tr.getMeta('full-delete'))) return null

      const selChanged = transactions.some((tr) => tr.selectionSet)
      const docChanged = transactions.some((tr) => tr.docChanged)
      if (!selChanged && !docChanged) return null
      if (!newState.selection.empty) return null

      const newPos = newState.selection.from
      const oldPos = oldState.selection.from
      const codeType = newState.schema.marks.code

      // ── 1. Backtick pair collapse ──
      const oldMatches = findCodePatternsInBlock(oldState, oldPos)
      const wasIn = oldMatches.find((m) => oldPos > m.from && oldPos < m.to)
      if (wasIn && codeType) {
        let mappedFrom = wasIn.from
        if (docChanged) {
          for (const t of transactions) {
            mappedFrom = t.mapping.map(mappedFrom)
          }
          if (mappedFrom < 0 || mappedFrom > newState.doc.content.size) return null
        }

        const newMatches = findCodePatternsInBlock(newState, mappedFrom)
        const isStillIn = newMatches.find((m) => newPos > m.from && newPos < m.to)
        if (!isStillIn) {
          const target = newMatches.find(
            (m) => Math.abs(m.from - mappedFrom) < 3,
          )
          if (target?.content) {
            const codeNode = newState.schema.text(target.content, [codeType.create()])
            const tr = newState.tr.replaceWith(target.from, target.to, codeNode)
            tr.setMeta(pluginKey, 'collapse')
            tr.setMeta('addToHistory', false)
            return tr
          }
        }
      }

      // ── 2. Cursor target: ensure U+200B after trailing formatting marks ──
      const insertPos = needsCursorTarget(newState)
      if (insertPos >= 0) {
        const tr = newState.tr.insertText(ZWSP, insertPos)
        tr.setMeta(pluginKey, 'cursor-target')
        tr.setMeta('addToHistory', false)

        // For inclusive marks (strong/em/strike_through): if cursor is exactly at
        // the insertion point (the right boundary of the mark), clear those marks
        // from storedMarks so that typing immediately after the input rule produces
        // plain text (Typora-style: completing **bold** exits bold).
        //
        // EXCEPT when we're still inside an in-progress toggle session
        // (setup.ts's bare "**" InputRule sets storedMarks the moment bold is
        // turned on, before any marked characters exist) — stripping there
        // would kill the toggle after its very first typed character.
        // Checked two ways because storedMarks itself doesn't survive past a
        // single subsequent keystroke (ProseMirror resets it to null on any
        // docChanged transaction that doesn't explicitly re-set it): (a) it's
        // still explicitly active in storedMarks (catches the FIRST typed
        // character right after the toggle), or (b) the OLD cursor position
        // was already inside/adjacent to the mark before this transaction
        // (catches every character after that, once storedMarks has reset to
        // null and typing is riding the inclusive-mark boundary fallback
        // instead — same mechanism, just not visible in storedMarks anymore).
        if (newState.selection.from === insertPos) {
          const { $head: $h } = newState.selection
          if ($h?.nodeBefore) {
            const inclusiveNames = ZWSP_MARK_NAMES.filter((n) => n !== 'code')
            const hasInclusive = inclusiveNames.some((name) => {
              const mt = newState.schema.marks[name]
              return mt && $h.nodeBefore!.marks.some((m) => m.type === mt)
            })
            const wasAlreadyActive = inclusiveNames.some((name) => {
              const mt = oldState.schema.marks[name]
              if (!mt) return false
              const inStoredMarks = oldState.storedMarks?.some((m) => m.type === mt) ?? false
              const inPositionMarks = mt.isInSet(oldState.selection.$from.marks()) !== undefined
              return inStoredMarks || inPositionMarks
            })
            if (hasInclusive && !wasAlreadyActive) {
              const filtered = $h.marks().filter((m) =>
                !inclusiveNames.some((name) => {
                  const mt = newState.schema.marks[name]
                  return mt && m.type === mt
                }),
              )
              tr.setStoredMarks(filtered)
            }
          }
        }

        return tr
      }

      // ── 3. Stored marks at code–ZWSP boundary ──
      // With inclusive:false, marks() at the right boundary of code excludes
      // the code mark. But the user expects typing at the end of code text to
      // extend the code (they visually see the cursor inside the gray background).
      // Proactively set stored marks to include code at this position.
      // ArrowRight handler sets 'code-escape' meta to opt out.
      if (transactions.some((tr) => tr.getMeta('code-escape'))) return null

      const { $head } = newState.selection
      if ($head && newState.selection.empty && codeType) {
        const nodeBefore = $head.nodeBefore
        const nodeAfter = $head.nodeAfter

        if (
          nodeBefore?.marks.some((m) => m.type === codeType) &&
          nodeAfter?.isText &&
          !codeType.isInSet(nodeAfter.marks) &&
          nodeAfter.text?.startsWith(ZWSP)
        ) {
          // Already has code in stored marks — nothing to do
          const stored = newState.storedMarks
          if (stored && stored.some((m) => m.type === codeType)) return null

          const marks = [...$head.marks(), codeType.create()]
          const tr = newState.tr.setStoredMarks(marks)
          tr.setMeta(pluginKey, 'boundary-marks')
          tr.setMeta('addToHistory', false)
          return tr
        }

        // ── 3b. Clear inclusive marks at mark–ZWSP boundary ──
        // strong/em/strike_through are inclusive:true, so marks() at the right
        // boundary includes them. When cursor navigates here (via ← or click),
        // clear those marks from storedMarks so typing is plain text.
        const inclusiveMarkNames = ZWSP_MARK_NAMES.filter((n) => n !== 'code')
        const hasInclusiveBefore = nodeBefore != null && inclusiveMarkNames.some((name) => {
          const mt = newState.schema.marks[name]
          return mt && nodeBefore.marks.some((m) => m.type === mt)
        })
        if (hasInclusiveBefore && nodeAfter?.isText && nodeAfter.text?.startsWith(ZWSP)) {
          // If storedMarks is already null or already excludes inclusive marks, bail
          const stored = newState.storedMarks
          const storedHasInclusive = stored?.some((m) =>
            inclusiveMarkNames.some((name) => {
              const mt = newState.schema.marks[name]
              return mt && m.type === mt
            }),
          )
          if (stored !== null && !storedHasInclusive) return null

          const filtered = $head.marks().filter((m) =>
            !inclusiveMarkNames.some((name) => {
              const mt = newState.schema.marks[name]
              return mt && m.type === mt
            }),
          )
          const tr = newState.tr.setStoredMarks(filtered)
          tr.setMeta(pluginKey, 'boundary-marks-inclusive')
          tr.setMeta('addToHistory', false)
          return tr
        }
      }

      return null
    },
  })
}
