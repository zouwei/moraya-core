// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { createSchema } from '../../schema'
import { BrowserMediaResolver } from '../../adapters/browser-media-resolver'
import { parseMarkdown } from '../../markdown'
import { topLevelBlockRange, moveBlockTransaction, resolveDragUnit, siblingRangeInContainer, firstContentPos } from '../block-drag'

// A real, non-default schema — like every production editor actually gets
// from createEditor() (which always builds a fresh schema via createSchema(),
// never markdown.ts's internal `defaultSchema` singleton).
const testSchema = createSchema({ mediaResolver: new BrowserMediaResolver() })

function stateFor(md: string): EditorState {
  const doc = parseMarkdown(md, testSchema)
  return EditorState.create({ schema: testSchema, doc })
}

/** Range of the doc's Nth top-level child, for building move-transaction fixtures. */
function childRange(doc: import('prosemirror-model').Node, index: number): { from: number; to: number } {
  let from = 0
  for (let i = 0; i < index; i++) from += doc.child(i).nodeSize
  return { from, to: from + doc.child(index).nodeSize }
}

// A document exercising every "must move as a whole block" category from the
// spec: paragraph, heading, table, code block, math block, blockquote
// (multi-paragraph), bullet list (multi-item).
const MIXED_DOC = [
  '# Heading',
  '',
  'First paragraph.',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '| 3 | 4 |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '$$',
  'x^2',
  '$$',
  '',
  '> quote line one',
  '>',
  '> quote line two',
  '',
  '- item one',
  '- item two',
  '',
  'Last paragraph.',
].join('\n')

describe('topLevelBlockRange', () => {
  it('resolves a position inside a plain paragraph to that paragraph', () => {
    const state = stateFor(MIXED_DOC)
    const heading = state.doc.child(0)
    expect(heading.type.name).toBe('heading')
    const range = topLevelBlockRange(state.doc, 3) // inside "Heading" text
    expect(range).not.toBeNull()
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('heading')
    expect(range!.to - range!.from).toBe(heading.nodeSize)
  })

  it('resolves a position deep inside a table CELL to the WHOLE table', () => {
    const state = stateFor(MIXED_DOC)
    let tableFrom = -1
    let tableNode: import('prosemirror-model').Node | null = null
    state.doc.forEach((child, offset) => {
      if (child.type.name === 'table' && tableFrom === -1) { tableFrom = offset; tableNode = child }
    })
    expect(tableFrom).toBeGreaterThan(-1)
    // Find a position textually inside the "1" cell — a few chars into the table's content.
    const innerPos = tableFrom + 6
    const range = topLevelBlockRange(state.doc, innerPos)
    expect(range).not.toBeNull()
    expect(range!.from).toBe(tableFrom)
    expect(range!.to).toBe(tableFrom + tableNode!.nodeSize)
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('table')
  })

  it('resolves a position inside a code_block to the whole code block', () => {
    const state = stateFor(MIXED_DOC)
    let from = -1
    state.doc.forEach((child, offset) => { if (child.type.name === 'code_block' && from === -1) from = offset })
    const range = topLevelBlockRange(state.doc, from + 2)
    expect(range!.from).toBe(from)
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('code_block')
  })

  it('resolves a position inside math_block to the whole math block', () => {
    const state = stateFor(MIXED_DOC)
    let from = -1
    state.doc.forEach((child, offset) => { if (child.type.name === 'math_block' && from === -1) from = offset })
    const range = topLevelBlockRange(state.doc, from + 1)
    expect(range!.from).toBe(from)
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('math_block')
  })

  it('resolves a position inside the SECOND paragraph of a multi-paragraph blockquote to the WHOLE blockquote', () => {
    const state = stateFor(MIXED_DOC)
    let from = -1
    let node: import('prosemirror-model').Node | null = null
    state.doc.forEach((child, offset) => { if (child.type.name === 'blockquote' && from === -1) { from = offset; node = child } })
    expect(node!.childCount).toBeGreaterThanOrEqual(2) // two quote lines → two paragraphs
    // Position inside the second inner paragraph.
    const innerPos = from + node!.nodeSize - 3
    const range = topLevelBlockRange(state.doc, innerPos)
    expect(range!.from).toBe(from)
    expect(range!.to).toBe(from + node!.nodeSize)
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('blockquote')
  })

  it('resolves a position inside the SECOND item of a bullet list to the WHOLE list', () => {
    const state = stateFor(MIXED_DOC)
    let from = -1
    let node: import('prosemirror-model').Node | null = null
    state.doc.forEach((child, offset) => { if (child.type.name === 'bullet_list' && from === -1) { from = offset; node = child } })
    expect(node!.childCount).toBe(2)
    const innerPos = from + node!.nodeSize - 3 // inside the last list_item
    const range = topLevelBlockRange(state.doc, innerPos)
    expect(range!.from).toBe(from)
    expect(range!.to).toBe(from + node!.nodeSize)
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('bullet_list')
  })

  it('a freshly-created empty doc has one empty paragraph to drag (schema always fills required content)', () => {
    const state = EditorState.create({ schema: testSchema })
    const range = topLevelBlockRange(state.doc, 0)
    expect(range).not.toBeNull()
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('paragraph')
  })

  it('handles the very start (pos 0) and very end (doc size) without throwing', () => {
    const state = stateFor(MIXED_DOC)
    expect(topLevelBlockRange(state.doc, 0)).not.toBeNull()
    expect(topLevelBlockRange(state.doc, state.doc.content.size)).not.toBeNull()
  })
})

describe('moveBlockTransaction', () => {
  it('moves a later block UP to the very start', () => {
    const state = stateFor('one\n\ntwo\n\nthree')
    const { from: thirdFrom, to: thirdTo } = childRange(state.doc, 2)
    const tr = moveBlockTransaction(state, thirdFrom, thirdTo, 0)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    expect(next.doc.child(0).textContent).toBe('three')
    expect(next.doc.child(1).textContent).toBe('one')
    expect(next.doc.child(2).textContent).toBe('two')
    expect(next.doc.childCount).toBe(3) // no block lost or duplicated
  })

  it('selects the moved block at its new position (drop feedback)', () => {
    const state = stateFor('one\n\ntwo\n\nthree')
    const { from: thirdFrom, to: thirdTo } = childRange(state.doc, 2)
    const tr = moveBlockTransaction(state, thirdFrom, thirdTo, 0)
    expect(tr!.selection).toBeInstanceOf(NodeSelection)
    expect((tr!.selection as NodeSelection).node.textContent).toBe('three')
    expect(tr!.selection.from).toBe(0)
  })

  it('moves an earlier block DOWN to the very end', () => {
    const state = stateFor('one\n\ntwo\n\nthree')
    const { from: firstFrom, to: firstTo } = childRange(state.doc, 0)
    const endPos = state.doc.content.size
    const tr = moveBlockTransaction(state, firstFrom, firstTo, endPos)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    expect(next.doc.child(0).textContent).toBe('two')
    expect(next.doc.child(1).textContent).toBe('three')
    expect(next.doc.child(2).textContent).toBe('one')
    expect(next.doc.childCount).toBe(3)
  })

  it('moves a middle block to swap with its neighbor (adjacent move)', () => {
    const state = stateFor('one\n\ntwo\n\nthree')
    // Move block "two" (index 1) to the gap before block "one" (index 0).
    const { from: secondFrom, to: secondTo } = childRange(state.doc, 1)
    const { from: firstGap } = childRange(state.doc, 0)
    const tr = moveBlockTransaction(state, secondFrom, secondTo, firstGap)
    const next = state.apply(tr!)
    expect(next.doc.child(0).textContent).toBe('two')
    expect(next.doc.child(1).textContent).toBe('one')
    expect(next.doc.child(2).textContent).toBe('three')
  })

  it('is a no-op when dropping at the gap immediately BEFORE its own range', () => {
    const state = stateFor('one\n\ntwo\n\nthree')
    const { from: secondFrom, to: secondTo } = childRange(state.doc, 1)
    expect(moveBlockTransaction(state, secondFrom, secondTo, secondFrom)).toBeNull()
  })

  it('is a no-op when dropping at the gap immediately AFTER its own range', () => {
    const state = stateFor('one\n\ntwo\n\nthree')
    const { from: secondFrom, to: secondTo } = childRange(state.doc, 1)
    expect(moveBlockTransaction(state, secondFrom, secondTo, secondTo)).toBeNull()
  })

  it('moves a whole table intact (structure preserved, not flattened)', () => {
    const state = stateFor(MIXED_DOC)
    let tableFrom = -1, tableTo = -1
    state.doc.forEach((child, offset) => {
      if (child.type.name === 'table' && tableFrom === -1) { tableFrom = offset; tableTo = offset + child.nodeSize }
    })
    const tr = moveBlockTransaction(state, tableFrom, tableTo, 0) // move to doc start
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    expect(next.doc.child(0).type.name).toBe('table')
    expect(next.doc.child(0).childCount).toBe(3) // 1 header row + 2 body rows preserved
  })

  it('moves a whole multi-paragraph blockquote intact', () => {
    const state = stateFor(MIXED_DOC)
    let from = -1, to = -1, childCount = 0
    state.doc.forEach((child, offset) => {
      if (child.type.name === 'blockquote' && from === -1) { from = offset; to = offset + child.nodeSize; childCount = child.childCount }
    })
    const tr = moveBlockTransaction(state, from, to, 0)
    const next = state.apply(tr!)
    expect(next.doc.child(0).type.name).toBe('blockquote')
    expect(next.doc.child(0).childCount).toBe(childCount)
  })
})

// A list with: a plain item, an item containing a NESTED sub-list (two
// items), and an item containing a blockquote — exercises "drag just this
// list row" (not the whole list) and "innermost list_item wins" nesting.
const LIST_DOC = [
  '- item one',
  '- item two',
  '  - nested a',
  '  - nested b',
  '- item three',
  '',
  '  > quoted text',
  '  > second line',
].join('\n')

describe('resolveDragUnit', () => {
  it('resolves a plain paragraph to the top-level block (unchanged behavior)', () => {
    const state = stateFor('one\n\ntwo')
    const unit = resolveDragUnit(state.doc, 1)
    expect(unit).not.toBeNull()
    expect(state.doc.nodeAt(unit!.from)?.type.name).toBe('paragraph')
    expect(unit!.containerFrom).toBe(0)
    expect(unit!.containerTo).toBe(state.doc.content.size)
  })

  it('resolves a position inside a list item to just THAT item, not the whole list', () => {
    const state = stateFor(LIST_DOC)
    const list = state.doc.child(0)
    expect(list.type.name).toBe('bullet_list')
    const firstItem = list.child(0)
    const unit = resolveDragUnit(state.doc, 2) // inside "item one"
    expect(unit).not.toBeNull()
    expect(state.doc.nodeAt(unit!.from)?.type.name).toBe('list_item')
    expect(unit!.to - unit!.from).toBe(firstItem.nodeSize)
    // Container is the list's own content span, not the whole doc.
    expect(unit!.containerFrom).toBe(1) // right after bullet_list opens
    expect(unit!.containerTo).toBe(1 + list.content.size)
  })

  it('resolves a position inside a NESTED sub-list item to the innermost item (not the outer item, not the outer list)', () => {
    const state = stateFor(LIST_DOC)
    let outerFrom = -1
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'text' && node.text === 'nested a' && outerFrom === -1) outerFrom = pos
    })
    expect(outerFrom).toBeGreaterThan(-1)
    const unit = resolveDragUnit(state.doc, outerFrom + 2)
    expect(unit).not.toBeNull()
    const node = state.doc.nodeAt(unit!.from)
    expect(node?.type.name).toBe('list_item')
    expect(node?.textContent).toBe('nested a') // the INNER item, not "item two"
  })

  it('resolves a position inside a blockquote NESTED in a list item to the WHOLE list item (blockquote included)', () => {
    const state = stateFor(LIST_DOC)
    let quotePos = -1
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'text' && node.text === 'quoted text' && quotePos === -1) quotePos = pos
    })
    const unit = resolveDragUnit(state.doc, quotePos)
    expect(unit).not.toBeNull()
    const node = state.doc.nodeAt(unit!.from)
    expect(node?.type.name).toBe('list_item')
    expect(node?.textContent).toContain('item three')
    expect(node?.textContent).toContain('quoted text') // blockquote came along — whole row moves
  })

  // Regression: hovering right at a list's own top/bottom edge (very
  // plausible in practice — e.g. approaching the first or last row) used to
  // fall through to the WHOLE bullet_list/ordered_list as the drag unit,
  // because PM attributes a position exactly at a node's own content
  // boundary to that node itself, not to whichever child touches the edge —
  // so the ancestor walk never saw a `list_item` there.
  it('resolves the position right at the TOP edge of a list to its FIRST item, not the whole list', () => {
    const state = stateFor(['- item one', '- item two', '- item three'].join('\n'))
    const list = state.doc.child(0)
    const unit = resolveDragUnit(state.doc, 1) // right after bullet_list opens, before item one
    expect(unit).not.toBeNull()
    const node = state.doc.nodeAt(unit!.from)
    expect(node?.type.name).toBe('list_item')
    expect(node?.textContent).toBe('item one') // NOT the whole list's concatenated text
    expect(unit!.to - unit!.from).toBe(list.child(0).nodeSize)
  })

  it('resolves the position right at the BOTTOM edge of a list to its LAST item, not the whole list', () => {
    const state = stateFor(['- item one', '- item two', '- item three'].join('\n'))
    const list = state.doc.child(0)
    const endPos = list.nodeSize - 1 // right before bullet_list closes, after item three
    const unit = resolveDragUnit(state.doc, endPos)
    expect(unit).not.toBeNull()
    const node = state.doc.nodeAt(unit!.from)
    expect(node?.type.name).toBe('list_item')
    expect(node?.textContent).toBe('item three')
  })

  it('resolves the TOP edge of a NESTED sub-list to its first nested item, not the outer list', () => {
    const state = stateFor(LIST_DOC) // "item two" contains a nested list: nested a / nested b
    let nestedListFrom = -1
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'bullet_list' && pos > 0 && nestedListFrom === -1) nestedListFrom = pos
    })
    expect(nestedListFrom).toBeGreaterThan(-1)
    const unit = resolveDragUnit(state.doc, nestedListFrom + 1) // top edge of the nested list
    expect(unit).not.toBeNull()
    const node = state.doc.nodeAt(unit!.from)
    expect(node?.type.name).toBe('list_item')
    expect(node?.textContent).toBe('nested a')
  })
})

describe('siblingRangeInContainer', () => {
  it('finds the sibling list item nearest a position, constrained to the given list', () => {
    const state = stateFor(LIST_DOC)
    const list = state.doc.child(0)
    const containerFrom = 1
    const containerTo = 1 + list.content.size
    // Position inside "item three" (the last top-level item).
    let pos = -1
    state.doc.descendants((node, p) => { if (node.type.name === 'text' && node.text === 'item three' && pos === -1) pos = p })
    const range = siblingRangeInContainer(state.doc, pos, containerFrom, containerTo)
    expect(range).not.toBeNull()
    expect(state.doc.nodeAt(range!.from)?.textContent).toContain('item three')
  })

  it('clamps a position OUTSIDE the container to the nearest edge inside it', () => {
    const state = stateFor(LIST_DOC)
    const list = state.doc.child(0)
    const containerFrom = 1
    const containerTo = 1 + list.content.size
    // Position 0 is the very start of the doc — outside the list entirely.
    const range = siblingRangeInContainer(state.doc, 0, containerFrom, containerTo)
    expect(range).not.toBeNull()
    expect(state.doc.nodeAt(range!.from)?.type.name).toBe('list_item')
    expect(range!.from).toBe(containerFrom) // clamped to the container's own start
  })

  it('moving a list item within its own list reorders it (moveBlockTransaction is unit-agnostic)', () => {
    const state = stateFor(LIST_DOC)
    const list = state.doc.child(0)
    const firstItem = list.child(0)
    const thirdItemFrom = 1 + firstItem.nodeSize + list.child(1).nodeSize
    const thirdItemTo = thirdItemFrom + list.child(2).nodeSize
    // Move "item three" to the very start of the list (before "item one").
    const tr = moveBlockTransaction(state, thirdItemFrom, thirdItemTo, 1)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    const newList = next.doc.child(0)
    expect(newList.type.name).toBe('bullet_list')
    expect(newList.childCount).toBe(3) // still one list, 3 items — not split/flattened
    expect(newList.child(0).textContent).toContain('item three')
    expect(newList.child(1).textContent).toBe('item one')
    expect(newList.child(2).textContent).toContain('item two')
  })
})

describe('firstContentPos', () => {
  it('a plain top-level paragraph/heading needs no descent (unitFrom + 1 is already text)', () => {
    const state = stateFor('# Heading')
    const range = topLevelBlockRange(state.doc, 1)!
    const pos = firstContentPos(state.doc, range.from, range.to)
    expect(pos).toBe(range.from + 1)
    const $pos = state.doc.resolve(pos)
    expect($pos.parent.isTextblock).toBe(true)
  })

  it('a list item (one extra wrapping level) descends past the paragraph boundary', () => {
    const state = stateFor(LIST_DOC)
    const unit = resolveDragUnit(state.doc, 2)! // inside "item one"
    const pos = firstContentPos(state.doc, unit.from, unit.to)
    // unit.from + 1 sits between list_item-open and paragraph-open (parent
    // = list_item, not a textblock yet) — must land one further in.
    expect(pos).toBe(unit.from + 2)
    const $pos = state.doc.resolve(pos)
    expect($pos.parent.isTextblock).toBe(true)
    expect($pos.parent.type.name).toBe('paragraph')
  })

  it('a list item whose first child is a blockquote descends two extra levels', () => {
    const state = stateFor(['- outer', '', '  > quoted'].join('\n'))
    let quotePos = -1
    state.doc.descendants((node, p) => { if (node.type.name === 'text' && node.text === 'outer' && quotePos === -1) quotePos = p })
    const unit = resolveDragUnit(state.doc, quotePos)!
    // This item's ONLY structure is [paragraph("outer")] — firstContentPos
    // should land inside that paragraph regardless, matching the plain case.
    const pos = firstContentPos(state.doc, unit.from, unit.to)
    const $pos = state.doc.resolve(pos)
    expect($pos.parent.isTextblock).toBe(true)
  })

  it('a leaf/atom unit with no inner content returns unitTo without looping', () => {
    const state = stateFor('one\n\n---\n\ntwo')
    let hrFrom = -1, hrTo = -1
    state.doc.forEach((child, offset) => { if (child.type.name === 'horizontal_rule') { hrFrom = offset; hrTo = offset + child.nodeSize } })
    expect(hrFrom).toBeGreaterThan(-1)
    expect(firstContentPos(state.doc, hrFrom, hrTo)).toBe(hrTo)
  })
})
