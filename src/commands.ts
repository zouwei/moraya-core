import { type Command, type EditorState, type Transaction } from 'prosemirror-state'
import {
  toggleMark,
  setBlockType,
  wrapIn,
  lift,
} from 'prosemirror-commands'
import { wrapInList, liftListItem } from 'prosemirror-schema-list'
import { type Node, type MarkType, type NodeType, type Attrs } from 'prosemirror-model'
import { defaultSchema } from './schema'

/**
 * Core editing commands (§3.2).
 *
 * Pure ProseMirror Commands: `(state, dispatch?) => boolean`. No IO,
 * no async. Consumer extensions (findAndReplace / quickOpen / etc.) live
 * in their own repos and are NOT exported from this package.
 */

const schema = defaultSchema

function markType(name: string): MarkType {
  const m = schema.marks[name]
  if (!m) throw new Error(`[@moraya/markdown-core] mark "${name}" not in schema`)
  return m
}

function nodeType(name: string): NodeType {
  const n = schema.nodes[name]
  if (!n) throw new Error(`[@moraya/markdown-core] node "${name}" not in schema`)
  return n
}

export const toggleBold: Command = (state, dispatch) =>
  toggleMark(markType('strong'))(state, dispatch)

export const toggleItalic: Command = (state, dispatch) =>
  toggleMark(markType('em'))(state, dispatch)

export const toggleStrikethrough: Command = (state, dispatch) =>
  toggleMark(markType('strike_through'))(state, dispatch)

export const toggleCode: Command = (state, dispatch) =>
  toggleMark(markType('code'))(state, dispatch)

export function setHeading(level: 1 | 2 | 3 | 4 | 5 | 6): Command {
  return (state, dispatch) => setBlockType(nodeType('heading'), { level })(state, dispatch)
}

export const toggleBlockquote: Command = (state, dispatch) => {
  // If already in blockquote, lift; else wrap.
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'blockquote') {
      return lift(state, dispatch)
    }
  }
  return wrapIn(nodeType('blockquote'))(state, dispatch)
}

export const toggleOrderedList: Command = (state, dispatch) =>
  wrapInList(nodeType('ordered_list'))(state, dispatch)

export const toggleBulletList: Command = (state, dispatch) =>
  wrapInList(nodeType('bullet_list'))(state, dispatch)

/**
 * Toggle a list: wrap if not in this list type, lift out if already in it.
 * Schema-agnostic — uses `state.schema` rather than `defaultSchema`.
 */
function makeToggleList(typeName: 'bullet_list' | 'ordered_list'): Command {
  return (state, dispatch, view) => {
    const listType = state.schema.nodes[typeName]
    const listItemType = state.schema.nodes.list_item
    if (!listType || !listItemType) return false
    const { $from } = state.selection
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type === listType) {
        return liftListItem(listItemType)(state, dispatch, view)
      }
    }
    return wrapInList(listType)(state, dispatch, view)
  }
}

export const wrapInBulletList: Command = makeToggleList('bullet_list')
export const wrapInOrderedList: Command = makeToggleList('ordered_list')

/**
 * Wrap current block(s) in a bullet list with task-list items (checked: false).
 * Two-step: first apply wrapInList against the bullet_list type, then
 * post-process newly-created list_item nodes within the affected range to
 * set `checked: false` so they render as task items.
 */
export const wrapInTaskList: Command = (state, dispatch) => {
  const bulletListType = state.schema.nodes.bullet_list
  const listItemType = state.schema.nodes.list_item
  if (!bulletListType || !listItemType) return false
  if (!wrapInList(bulletListType)(state)) return false
  if (!dispatch) return true

  let listTr: Transaction | undefined
  wrapInList(bulletListType)(state, (tr) => { listTr = tr })
  if (!listTr) return false

  const { from, to } = listTr.selection
  const updates: Array<{ pos: number; attrs: Attrs }> = []
  listTr.doc.nodesBetween(
    Math.max(0, from - 200),
    Math.min(listTr.doc.content.size, to + 200),
    (node, pos) => {
      if (node.type === listItemType && node.attrs.checked === null) {
        updates.push({ pos, attrs: { ...node.attrs, checked: false } })
      }
    },
  )
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i]!
    listTr.setNodeMarkup(u.pos, undefined, u.attrs)
  }
  dispatch(listTr.scrollIntoView())
  return true
}

export const toggleCodeBlock: Command = (state, dispatch) => {
  const cb = nodeType('code_block')
  if (state.selection.$from.parent.type === cb) {
    return setBlockType(nodeType('paragraph'))(state, dispatch)
  }
  return setBlockType(cb)(state, dispatch)
}

export const insertHorizontalRule: Command = (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(nodeType('horizontal_rule').create()))
  }
  return true
}

/**
 * Insert a 3×3 placeholder table. Note: full table support requires
 * prosemirror-tables setup at editor mount time; this command falls back
 * to inserting a markdown-style code block snippet if tables aren't
 * registered (true for this minimal v0.1.0 schema).
 */
export const insertTable: Command = (state, dispatch) => {
  const tableType = schema.nodes.table
  if (!tableType) {
    // Insert pipe-table markdown directly into a paragraph.
    if (dispatch) {
      const text = '\n\n| Col 1 | Col 2 | Col 3 |\n|---|---|---|\n|   |   |   |\n|   |   |   |\n\n'
      dispatch(state.tr.insertText(text))
    }
    return true
  }
  return false
}

export const insertMathBlock: Command = (state, dispatch) => {
  const mathBlock = schema.nodes.math_block
  if (!mathBlock) {
    if (dispatch) {
      dispatch(state.tr.insertText('\n$$\n\\\n$$\n'))
    }
    return true
  }
  if (dispatch) {
    const node = mathBlock.create({ value: '' })
    dispatch(state.tr.replaceSelectionWith(node))
  }
  return true
}

export function toggleLink(href?: string): Command {
  return (state, dispatch) => {
    const link = markType('link')
    const { from, to } = state.selection
    if (state.doc.rangeHasMark(from, to, link)) {
      if (dispatch) dispatch(state.tr.removeMark(from, to, link))
      return true
    }
    if (!href) return false
    if (dispatch) {
      dispatch(state.tr.addMark(from, to, link.create({ href })))
    }
    return true
  }
}

export function insertImage(src: string, alt?: string): Command {
  return (state, dispatch) => {
    const img = nodeType('image').create({ src, alt: alt ?? null })
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(img))
    }
    return true
  }
}

// Re-export for ergonomic imports
export type { Command, EditorState, Transaction, Node }
