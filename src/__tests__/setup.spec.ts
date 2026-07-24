// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * REAL-DOM tests for buildKeymap()'s Backspace handling in createEditorPlugins.
 *
 * Bug this covers: pressing Backspace at the very start of a heading (empty
 * or not) fell through every explicit Backspace case (all of them are
 * WebKit atom-adjacency workarounds, none heading-aware) into
 * prosemirror-commands' baseKeymap joinBackward — which either no-ops when
 * the heading is the first block in the doc (nothing to lift into) or
 * silently merges it into the previous block. Either way the user could
 * delete a heading's text but never "un-heading" the now-empty block, so it
 * looked stuck. This only ever "worked" on some platforms by accident, via
 * WebKit's own native contenteditable Backspace fallback (ProseMirror lets
 * the browser handle it when every registered command returns false) — an
 * engine-specific behavior Chromium/Firefox don't replicate. The fix adds an
 * explicit case: cursor at a heading's start → demote it to a paragraph
 * (Typora/Notion convention), so the behavior is deterministic everywhere.
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

function backspaceAt(v: EditorView, pos: number) {
  const tr = v.state.tr.setSelection(TextSelection.create(v.state.doc, pos))
  v.dispatch(tr)
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
  v.dom.dispatchEvent(event)
  return event.defaultPrevented
}

/** Types through EditorView.handleTextInput — the same entry point real
    per-character typing uses (and what the inputRules plugin hooks into).
    Plain insertText transactions skip input rules entirely. */
function typeText(v: EditorView, text: string) {
  for (const ch of text) {
    const pos = v.state.selection.from
    const handled = v.someProp('handleTextInput', f => f(v, pos, pos, ch))
    if (!handled) v.dispatch(v.state.tr.insertText(ch, pos))
  }
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

describe('buildKeymap: Backspace at heading start', () => {
  it('demotes an empty heading (first block in the doc) to a paragraph', async () => {
    const v = await mount('# Hello')
    // Delete "Hello" first, leaving an empty heading — pos 1 is right after
    // the heading's opening tag, i.e. inside the (now empty) heading.
    v.dispatch(v.state.tr.delete(1, v.state.doc.content.size - 1))
    expect(v.state.doc.child(0).type.name).toBe('heading')
    expect(v.state.doc.child(0).textContent).toBe('')

    const handled = backspaceAt(v, 1)
    expect(handled).toBe(true)
    expect(v.state.doc.child(0).type.name).toBe('paragraph')
  })

  it('demotes a heading with text still present when the cursor is at its start', async () => {
    const v = await mount('## Section title\n\nBody text.')
    expect(v.state.doc.child(0).type.name).toBe('heading')

    const handled = backspaceAt(v, 1) // start of "Section title"
    expect(handled).toBe(true)
    expect(v.state.doc.child(0).type.name).toBe('paragraph')
    expect(v.state.doc.child(0).textContent).toBe('Section title')
  })

  it('does not fire when the cursor is NOT at the heading start', async () => {
    const v = await mount('# Hello')
    const handled = backspaceAt(v, 4) // mid-word, inside "Hel|lo"
    expect(handled).toBe(false)
    expect(v.state.doc.child(0).type.name).toBe('heading')
  })

  it('a second Backspace on the now-plain paragraph merges into the previous block', async () => {
    const v = await mount('Intro paragraph.\n\n# Hello')
    const headingPos = v.state.doc.content.size - v.state.doc.child(1).nodeSize + 1
    backspaceAt(v, headingPos) // heading → paragraph
    expect(v.state.doc.childCount).toBe(2)
    expect(v.state.doc.child(1).type.name).toBe('paragraph')

    const mergedHandled = backspaceAt(v, headingPos) // second press: joins into "Intro paragraph."
    expect(mergedHandled).toBe(true)
    expect(v.state.doc.childCount).toBe(1)
    expect(v.state.doc.child(0).textContent).toBe('Intro paragraph.Hello')
  })
})

describe('buildKeymap: Backspace after trailing formatting mark (ZWSP sentinel)', () => {
  it('deletes the last character of trailing bold text, not just the ZWSP', async () => {
    const v = await mount('**Bold text**')
    const endPos = v.state.doc.content.size - 1 // right after "Bold text", inside the paragraph

    // Landing the cursor there is exactly what a real click does: the
    // cursor-target plugin (inline-code-convert.ts) proactively inserts a
    // ZWSP after trailing formatting marks and moves the cursor past it —
    // see needsCursorTarget(). First Backspace should still remove "t".
    const handled = backspaceAt(v, endPos)
    expect(handled).toBe(true)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('Bold tex')
  })

  it('repeated Backspace presses each remove one character (no stuck state)', async () => {
    const v = await mount('**abc**')
    const endPos = v.state.doc.content.size - 1

    backspaceAt(v, endPos)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('ab')
    backspaceAt(v, v.state.selection.from)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('a')
    backspaceAt(v, v.state.selection.from)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('')
  })

  it('deletes the last character of trailing italic text', async () => {
    const v = await mount('*Italic*')
    const endPos = v.state.doc.content.size - 1
    const handled = backspaceAt(v, endPos)
    expect(handled).toBe(true)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('Itali')
  })

  it('deletes the last character of trailing inline code (non-inclusive mark, ZWSP is its own node)', async () => {
    const v = await mount('`code`')
    const endPos = v.state.doc.content.size - 1
    const handled = backspaceAt(v, endPos)
    expect(handled).toBe(true)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('cod')
  })

  it('deletes the last character of trailing strikethrough text', async () => {
    const v = await mount('~~struck~~')
    const endPos = v.state.doc.content.size - 1
    const handled = backspaceAt(v, endPos)
    expect(handled).toBe(true)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('struc')
  })

  it('re-landing the cursor on an already-targeted bold run does not duplicate the ZWSP', async () => {
    const v = await mount('**abc**')
    const endPos = v.state.doc.content.size - 1
    backspaceAt(v, endPos) // first Backspace: lands cursor + inserts the sentinel ZWSP
    const zwspCountAfterFirst = (v.state.doc.textContent.match(/​/g) ?? []).length
    expect(zwspCountAfterFirst).toBe(1)

    // Re-setting the selection to the exact same (already-targeted) position —
    // e.g. a second click, or any no-op selectionSet transaction — must not
    // insert a second ZWSP (needsCursorTarget's "already has one" check has
    // to recognize the merged-into-marked-run form, not just a bare node).
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, v.state.selection.from)))
    const zwspCountAfterReselect = (v.state.doc.textContent.match(/​/g) ?? []).length
    expect(zwspCountAfterReselect).toBe(1)
  })
})

describe('buildInputRules: strong (**text**) converts only once fully typed', () => {
  it('typing ** then content then ** produces real bold with no literal asterisks', async () => {
    const v = await mount('')
    typeText(v, '**加粗文字**')
    expect(serializeMarkdown(v.state.doc, testSchema)).toBe('**加粗文字**')
    const strongMark = testSchema.marks.strong!
    v.state.doc.descendants((node) => {
      if (node.isText) expect(strongMark.isInSet(node.marks)).toBeTruthy()
    })
  })

  it('converts two independent **runs** on the same line', async () => {
    const v = await mount('')
    typeText(v, '**a** **b**')
    expect(serializeMarkdown(v.state.doc, testSchema)).toBe('**a** **b**')
  })

  it('leaves a bare "**" literal until it is closed (no live toggle)', async () => {
    // Regression guard: the removed bare-"**" live-toggle deleted the pair the
    // moment the second "*" was typed, which surprised users. Typing "**" now
    // simply shows literal "**" and waits for the closing pair.
    const v = await mount('')
    typeText(v, '**')
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('**')
  })

  it('leaves "****" (no content between) as literal text', async () => {
    const v = await mount('')
    typeText(v, '****')
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('****')
  })

  it('plain typing with no ** is completely unaffected', async () => {
    const v = await mount('')
    typeText(v, 'hello world')
    expect(serializeMarkdown(v.state.doc, testSchema)).toBe('hello world')
  })

  it('a bold run created by the input rule can still be Backspace-deleted normally', async () => {
    const v = await mount('')
    typeText(v, '**abc**')
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    v.dom.dispatchEvent(event)
    expect(v.state.doc.textContent.replace(/​/g, '')).toBe('ab')
  })
})
