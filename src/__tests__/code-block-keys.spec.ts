// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * REAL-DOM tests for creating consecutive code blocks from the keyboard.
 *
 * Bug 1: Shift+Enter inside a code block inserted a hard break. A code block
 * can't hold one, so it spilled into a paragraph after the block with the
 * caret BEHIND the break; "```" typed there was not at the line start, never
 * became a fence, and was saved escaped as \`\`\`.
 *
 * Bug 2: "```" + Enter replaced the paragraph with a code block without
 * placing the caret. Mapped from the replaced range it landed after the new
 * block, so when anything followed (e.g. a second code block typed above an
 * existing paragraph) the caret jumped below and the block was unreachable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { createSchema } from '../schema'
import { BrowserMediaResolver } from '../adapters/browser-media-resolver'
import { parseMarkdown, serializeMarkdown } from '../markdown'
import { createEditorPlugins } from '../setup'

const testSchema = createSchema({ mediaResolver: new BrowserMediaResolver() })

let host: HTMLDivElement
let view: EditorView | null = null

async function mount(md: string): Promise<EditorView> {
  const doc = parseMarkdown(md, testSchema)
  const plugins = await createEditorPlugins({ mediaResolver: new BrowserMediaResolver() }, testSchema)
  const state = EditorState.create({ schema: testSchema, doc, plugins })
  view = new EditorView(host, { state })
  return view
}

function press(v: EditorView, key: string, opts: KeyboardEventInit = {}) {
  v.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
}

/** Types through handleTextInput — the path input rules hook into. */
function typeText(v: EditorView, text: string) {
  for (const ch of text) {
    const pos = v.state.selection.from
    const handled = v.someProp('handleTextInput', f => f(v, pos, pos, ch))
    if (!handled) v.dispatch(v.state.tr.insertText(ch, pos))
  }
}

/** Put the caret at the end of the top-level block at `index`. */
function caretAtEndOfBlock(v: EditorView, index: number) {
  let pos = 0
  for (let i = 0; i < index; i++) pos += v.state.doc.child(i).nodeSize
  const end = pos + v.state.doc.child(index).nodeSize - 1
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, end)))
}

const caretParent = (v: EditorView) => v.state.selection.$from.parent.type.name
const blockTypes = (v: EditorView) => {
  const names: string[] = []
  v.state.doc.forEach(n => names.push(n.type.name))
  return names
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  view?.destroy()
  view = null
  host.remove()
})

describe('"```" + Enter places the caret inside the new code block', () => {
  it('when the fence paragraph is the last block', async () => {
    const v = await mount('```')
    caretAtEndOfBlock(v, 0)
    press(v, 'Enter')
    expect(blockTypes(v)).toEqual(['code_block'])
    expect(caretParent(v)).toBe('code_block')
  })

  it('when another block follows (second code block above existing text)', async () => {
    // Escaped so the middle line parses as a paragraph holding "```" (a bare
    // fence would open a code block running to the end of the file).
    const v = await mount('```js\nfirst\n```\n\n\\`\\`\\`\n\nafter')
    expect(blockTypes(v)).toEqual(['code_block', 'paragraph', 'paragraph'])
    caretAtEndOfBlock(v, 1)
    press(v, 'Enter')
    expect(blockTypes(v)).toEqual(['code_block', 'code_block', 'paragraph'])
    expect(caretParent(v)).toBe('code_block')
    expect(v.state.selection.$from.index(0)).toBe(1)
    typeText(v, 'second')
    expect(v.state.doc.child(1).textContent).toBe('second')
  })
})

describe('Shift+Enter inside a code block exits it', () => {
  it('opens a paragraph below with the caret in it', async () => {
    const v = await mount('```js\nfirst\n```')
    caretAtEndOfBlock(v, 0)
    press(v, 'Enter', { shiftKey: true })
    expect(blockTypes(v)).toEqual(['code_block', 'paragraph'])
    expect(v.state.doc.child(0).textContent).toBe('first')
    expect(caretParent(v)).toBe('paragraph')
    expect(v.state.doc.child(1).childCount).toBe(0) // no stray hard break
  })

  it('a second code block can be typed right after, unescaped', async () => {
    const v = await mount('```js\nfirst\n```')
    caretAtEndOfBlock(v, 0)
    press(v, 'Enter', { shiftKey: true })
    typeText(v, '```')
    press(v, 'Enter')
    expect(blockTypes(v)).toEqual(['code_block', 'code_block'])
    expect(caretParent(v)).toBe('code_block')
    typeText(v, 'second')
    const md = serializeMarkdown(v.state.doc)
    expect(md).not.toContain('\\`')
    expect(md).toContain('```js\nfirst\n```')
    expect(md).toContain('```\nsecond\n```')
  })

  it('still inserts a hard break in a paragraph', async () => {
    const v = await mount('text')
    caretAtEndOfBlock(v, 0)
    press(v, 'Enter', { shiftKey: true })
    expect(blockTypes(v)).toEqual(['paragraph'])
    expect(v.state.doc.child(0).lastChild?.type.name).toBe('hardbreak')
  })
})
