// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Pure position/transaction logic for the visual-mode block drag handle.
 *
 * The handle lets the user grab a block and drop it anywhere else in the
 * document. The draggable UNIT depends on what's under the cursor:
 *   - Inside a list item (bullet or ordered, at any nesting level) → that ONE
 *     list item, so list rows reorder one at a time — not the whole list.
 *   - Anywhere else → the whole top-level block (the depth-1 child of `doc`).
 *     No matter how deep the position resolves into nested content (a cell
 *     inside a table row, a paragraph inside a blockquote), the unit is the
 *     WHOLE table/code block/math block/blockquote — never a fragment of it.
 *
 * A dragged unit can only be dropped among its own SIBLINGS (other list items
 * of the same list for a list-item drag; other top-level blocks for
 * everything else) — see `containerFrom`/`containerTo` on `DragUnit` and
 * `siblingRangeInContainer`, used to constrain drop-target search for the
 * whole duration of one drag gesture.
 *
 * This module is intentionally host-agnostic (only `doc`/`EditorState`
 * positions, no DOM) so every consumer shares one tested implementation.
 * DOM/mouse wiring (mousemove hover + a custom mousedown/mousemove/mouseup
 * drag loop — deliberately NOT native HTML5 drag-and-drop, since desktop
 * WebViews and some mobile browsers have unreliable native DnD) lives
 * per-platform in each consumer's own editor component.
 */

import type { Node as PmNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { NodeSelection } from 'prosemirror-state'

/**
 * Resolve `pos` to the `[from, to)` range of the CHILD of the node at
 * `containerDepth` that contains it (`containerDepth` 0 = the doc itself, so
 * this is `[from, to)` of a top-level block). Handles the edge case where
 * `pos` sits exactly at the container's own outer boundary — PM attributes
 * those positions to the container, not to whichever child touches that edge
 * — by falling back to the first/last child directly.
 */
function childRangeAtDepth(doc: PmNode, pos: number, containerDepth: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos)
  const container = containerDepth === 0 ? doc : $pos.node(containerDepth)
  if (container.content.size === 0) return null
  const containerStart = containerDepth === 0 ? 0 : $pos.start(containerDepth)
  const containerEnd = containerStart + container.content.size
  const clamped = Math.max(containerStart, Math.min(pos, containerEnd))
  const $clamped = clamped === pos ? $pos : doc.resolve(clamped)
  if ($clamped.depth > containerDepth) {
    return { from: $clamped.before(containerDepth + 1), to: $clamped.after(containerDepth + 1) }
  }
  if (clamped === containerStart) {
    const first = container.maybeChild(0)
    return first ? { from: containerStart, to: containerStart + first.nodeSize } : null
  }
  const last = container.maybeChild(container.childCount - 1)
  return last ? { from: clamped - last.nodeSize, to: clamped } : null
}

/**
 * Resolve any document position to the `[from, to)` range of its enclosing
 * top-level block (the depth-1 child of `doc` that contains it). Returns
 * `null` for an empty document (nothing to drag).
 */
export function topLevelBlockRange(doc: PmNode, pos: number): { from: number; to: number } | null {
  if (doc.content.size === 0) return null
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  return childRangeAtDepth(doc, clamped, 0)
}

export interface DragUnit {
  from: number
  to: number
  /** `[containerFrom, containerTo)` — the range within which this unit's
   *  siblings live. A drop is only ever valid inside this range: the whole
   *  doc for a top-level block, or the specific enclosing list's content for
   *  a list item. */
  containerFrom: number
  containerTo: number
}

const LIST_TYPES = new Set(['bullet_list', 'ordered_list'])

/**
 * Resolve `pos` to its natural drag unit: the INNERMOST enclosing list_item
 * if the position is nested inside one (at any list depth), otherwise the
 * whole top-level block. Returns `null` for an empty document.
 */
export function resolveDragUnit(doc: PmNode, pos: number): DragUnit | null {
  if (doc.content.size === 0) return null
  const clamped = Math.max(0, Math.min(pos, doc.content.size))
  const $pos = doc.resolve(clamped)

  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'list_item') {
      const containerDepth = d - 1
      const range = childRangeAtDepth(doc, clamped, containerDepth)
      if (!range) break
      const containerFrom = containerDepth === 0 ? 0 : $pos.start(containerDepth)
      const containerTo = containerDepth === 0 ? doc.content.size : $pos.end(containerDepth)
      return { ...range, containerFrom, containerTo }
    }
    // Boundary case: `clamped` sits exactly at the START or END of a list's
    // own content (right before its first item, or right after its last) —
    // PM attributes that position to the LIST itself, not to whichever item
    // touches the edge, so the ancestor walk above never sees a `list_item`
    // there and would otherwise fall through to treating the WHOLE list as
    // the drag unit (dragging the entire list instead of one row). Attribute
    // it to the first/last item directly — the same edge handling
    // childRangeAtDepth already does one level up for the doc's own boundary.
    if (LIST_TYPES.has(node.type.name)) {
      const start = d === 0 ? 0 : $pos.start(d)
      const end = start + node.content.size
      if (clamped === start || clamped === end) {
        const range = childRangeAtDepth(doc, clamped, d)
        if (!range) break
        return { ...range, containerFrom: start, containerTo: end }
      }
    }
  }

  const range = topLevelBlockRange(doc, clamped)
  if (!range) return null
  return { ...range, containerFrom: 0, containerTo: doc.content.size }
}

/**
 * During an ACTIVE drag, re-resolve `pos` (clamped into `[containerFrom,
 * containerTo)`) to find which SIBLING within that same container it now
 * falls into. `containerFrom`/`containerTo` come from the `DragUnit` captured
 * when the drag started, so this stays constrained to the same list (or the
 * whole doc, for a top-level drag) no matter where the mouse currently is.
 */
export function siblingRangeInContainer(
  doc: PmNode,
  pos: number,
  containerFrom: number,
  containerTo: number,
): { from: number; to: number } | null {
  const clamped = Math.max(containerFrom, Math.min(pos, containerTo))
  const $pos = doc.resolve(clamped)
  for (let d = 0; d <= $pos.depth; d++) {
    const start = d === 0 ? 0 : $pos.start(d)
    const end = d === 0 ? doc.content.size : $pos.end(d)
    if (start === containerFrom && end === containerTo) {
      return childRangeAtDepth(doc, clamped, d)
    }
  }
  return null
}

/**
 * Find the position of the first actual TEXT content inside `[unitFrom,
 * unitTo)` — descending past any wrapping block nodes (a list_item wraps its
 * first line in a paragraph, one MORE level than a plain top-level paragraph
 * does) until reaching a position whose immediate parent is a textblock (or a
 * leaf). `unitFrom + 1` alone only works when the unit itself IS a textblock;
 * for a list_item that position sits at the boundary between the item and
 * its first child (parent = the item, not textblock yet), which is why the
 * handle's first-line detection needs this instead of a fixed `+1`.
 *
 * Bounded to a handful of hops — deep enough for any realistic nesting
 * (list item → blockquote → paragraph, table → row → cell → paragraph) but
 * never loops. Returns `unitTo` if no textblock is found within the bound
 * (e.g. a leaf/atom unit with no inner content at all).
 */
export function firstContentPos(doc: PmNode, unitFrom: number, unitTo: number): number {
  let pos = unitFrom + 1
  for (let i = 0; i < 8 && pos < unitTo; i++) {
    const $pos = doc.resolve(pos)
    if ($pos.parent.isTextblock || $pos.parent.isLeaf) return pos
    pos += 1
  }
  return Math.min(pos, unitTo)
}

/**
 * Build a transaction that moves the block at `[blockFrom, blockTo)` so it
 * ends up at `insertPos` — a gap between/around some OTHER top-level block.
 * Uses the transaction's own step mapping to translate `insertPos` through
 * the delete, so it's correct whether the drop target is before or after the
 * dragged block's original position.
 *
 * Returns `null` for a no-op drop: `insertPos` anywhere inside (or exactly at
 * either edge of) the dragged block's own current range, i.e. dropping it
 * back where it already is.
 *
 * On success, the returned transaction also selects the moved block at its
 * new position (a NodeSelection, same outline PM already draws for any
 * selected node) so the drop gives clear "this is what just moved" feedback.
 * If the moved content isn't selectable as a single node for some reason,
 * the selection is left to ProseMirror's default position-mapping.
 */
export function moveBlockTransaction(
  state: EditorState,
  blockFrom: number,
  blockTo: number,
  insertPos: number,
): Transaction | null {
  if (insertPos >= blockFrom && insertPos <= blockTo) return null
  const slice = state.doc.slice(blockFrom, blockTo)
  let tr = state.tr.delete(blockFrom, blockTo)
  const mappedInsertPos = tr.mapping.map(insertPos)
  tr = tr.insert(mappedInsertPos, slice.content)
  try {
    tr = tr.setSelection(NodeSelection.create(tr.doc, mappedInsertPos))
  } catch {
    // Not selectable as a single node — leave the default mapped selection.
  }
  return tr
}
