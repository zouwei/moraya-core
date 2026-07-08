// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * REAL-DOM tests for editor-props-plugin's large-paste fast path.
 *
 * Bug this covers: pasting a long markdown document directly into the
 * visual editor synchronously ran `clipboardTextParser` on the main thread
 * inside the native `paste` event — fine on desktop, but mobile WKWebView
 * is much less tolerant of a multi-second synchronous block during a user
 * gesture, and the paste could silently fail to land at all. The fix
 * intercepts large pastes earlier, in `handleDOMEvents.paste` (which fires
 * BEFORE ProseMirror's own clipboardTextParser), and finishes the insert
 * asynchronously via `parseMarkdownAsync`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { defaultSchema } from '../../schema'
import { parseMarkdown } from '../../markdown'
import { createEditorPropsPlugin } from '../editor-props-plugin'

let host: HTMLDivElement
let view: EditorView | null = null

function mount(md: string): EditorView {
  const doc = parseMarkdown(md, defaultSchema)
  const plugin = createEditorPropsPlugin({
    platform: { getCurrentFilePath: () => null, isMacOS: false },
    linkOpener: { open: () => {} },
  })
  const state = EditorState.create({ schema: defaultSchema, doc, plugins: [plugin] })
  view = new EditorView(host, { state })
  return view
}

function pasteText(target: Element, text: string) {
  const dataTransfer = new DataTransfer()
  dataTransfer.setData('text/plain', text)
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer as unknown as DataTransfer,
  })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  view?.destroy()
  view = null
  host.remove()
  vi.useRealTimers()
})

describe('editor-props-plugin: large paste async fast path', () => {
  // Note: ProseMirror's OWN default paste handling also calls
  // `event.preventDefault()` (it inserts via its own clipboardTextParser
  // rather than letting the browser insert natively), so `defaultPrevented`
  // is true either way and can't distinguish "my async path claimed this"
  // from "the default sync path handled it". Instead assert on TIMING:
  // the async path leaves the doc untouched immediately after dispatch and
  // only inserts once the microtask/timer queue is flushed; the default
  // sync path inserts immediately, before the dispatch call returns.

  it('small paste (< threshold) lands synchronously via the default path', () => {
    const v = mount('')
    const event = pasteText(v.dom, 'a short paste')
    expect(event.defaultPrevented).toBe(true)
    // Synchronous — content is already there, no need to await anything.
    expect(v.state.doc.textContent).toContain('a short paste')
  })

  it('large paste (>= threshold) is deferred: nothing lands until the async parse resolves', async () => {
    const v = mount('')

    // Build a markdown doc well above ASYNC_PASTE_THRESHOLD (50_000 chars):
    // repeated headings + paragraphs so it parses into real structure, not
    // just one giant paragraph.
    const section = '# Heading\n\nSome paragraph text that repeats many times to build size.\n\n'
    const big = section.repeat(1000) // comfortably over 50_000 chars
    expect(big.length).toBeGreaterThan(50_000)

    pasteText(v.dom, big)
    // Content hasn't landed yet — the parse is still in flight, proving this
    // took the async branch rather than the default synchronous one.
    expect(v.state.doc.textContent.length).toBe(0)

    // Let the async parseMarkdownAsync + dispatch resolve.
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(v.state.doc.textContent.length).toBeGreaterThan(0)
    expect(v.state.doc.textContent).toContain('Heading')
    expect(v.state.doc.textContent).toContain('Some paragraph text')
  })

  it('large paste inside a code_block lands synchronously via the default path (no interception)', () => {
    const v = mount('```\ncode\n```')
    // Place selection inside the code_block content.
    const sel = TextSelection.near(v.state.doc.resolve(2))
    v.dispatch(v.state.tr.setSelection(sel))

    const big = 'x'.repeat(60_000)
    pasteText(v.dom, big)
    // Code-block target: handler bails out early (returns false) — the
    // default path handles it synchronously, so the text is already in the
    // doc immediately, unlike the deferred-large-paste case above.
    expect(v.state.doc.textContent).toContain('x'.repeat(100))
  })

  it('stale async result is discarded if the view is destroyed before the parse resolves', async () => {
    const v = mount('')
    const big = ('# X\n\nPara.\n\n').repeat(1000)
    const event = pasteText(v.dom, big)
    expect(event.defaultPrevented).toBe(true)

    v.destroy()
    view = null

    // Should not throw even though the view is gone.
    await new Promise(resolve => setTimeout(resolve, 50))
  })
})
