// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * REAL-DOM mount tests for the Typora-style math NodeViews (happy-dom).
 *
 * These construct an actual EditorView with the same nodeViews wiring
 * createEditor uses, and drive it through DOM events — verifying the live
 * interaction path (click → source opens → edit → blur → committed), the
 * focus-race stopEvent contract, and the LaTeX token highlighter.
 *
 * NOTE: happy-dom cannot reproduce ProseMirror's real click→focus path, so
 * the focus-race guard here is a *contract* test on stopEvent(); the true
 * end-to-end guard lives in Moraya PC's Playwright/WebKit suite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { defaultSchema } from '../../schema'
import { parseMarkdown } from '../../markdown'
import { mathBlockNodeView, mathInlineNodeView, highlightLatex } from '../math-node-views'

let host: HTMLDivElement
let view: EditorView | null = null

function mount(md: string): EditorView {
  const doc = parseMarkdown(md, defaultSchema)
  const state = EditorState.create({ schema: defaultSchema, doc })
  view = new EditorView(host, {
    state,
    nodeViews: {
      math_block: mathBlockNodeView as never,
      math_inline: mathInlineNodeView as never,
    },
  })
  return view
}

function click(el: Element) {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
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

describe('math_block NodeView (in-place source editing)', () => {
  it('renders the preview, source row hidden initially', () => {
    mount('$$\nx_0 + y\n$$')
    const nv = host.querySelector('.math-block-nodeview')!
    expect(nv).toBeTruthy()
    expect(nv.querySelector('.math-preview')?.textContent).toContain('x')
    expect((nv.querySelector('.math-src-row') as HTMLElement).style.display).toBe('none')
  })

  it('click opens the source row above the preview with the LaTeX value', () => {
    mount('$$\nR_m = x\n$$')
    const nv = host.querySelector('.math-block-nodeview')!
    click(nv.querySelector('.math-preview')!)
    const row = nv.querySelector('.math-src-row') as HTMLElement
    expect(row.style.display).toBe('')
    const ta = nv.querySelector('textarea.math-src-input') as HTMLTextAreaElement
    expect(ta.value).toBe('R_m = x')
    expect(row.nextElementSibling?.classList.contains('math-preview')).toBe(true)
  })

  it('editing + blur commits the new LaTeX into attrs.value', () => {
    const v = mount('$$\nR_m = x\n$$')
    const nv = host.querySelector('.math-block-nodeview')!
    click(nv.querySelector('.math-preview')!)
    const ta = nv.querySelector('textarea.math-src-input') as HTMLTextAreaElement
    ta.value = 'R_m = y^2'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.dispatchEvent(new FocusEvent('blur'))

    let value = ''
    v.state.doc.descendants(n => { if (n.type.name === 'math_block') value = n.attrs.value })
    expect(value).toBe('R_m = y^2')
    expect((nv.querySelector('.math-src-row') as HTMLElement).style.display).toBe('none')
  })

  it('Escape reverts without committing', () => {
    const v = mount('$$\na + b\n$$')
    const nv = host.querySelector('.math-block-nodeview')!
    click(nv.querySelector('.math-preview')!)
    const ta = nv.querySelector('textarea.math-src-input') as HTMLTextAreaElement
    ta.value = 'CHANGED'
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    let value = ''
    v.state.doc.descendants(n => { if (n.type.name === 'math_block') value = n.attrs.value })
    expect(value).toBe('a + b')
  })

  it('clearing the source and blurring deletes the formula node', () => {
    const v = mount('$$\nz\n$$')
    const nv = host.querySelector('.math-block-nodeview')!
    click(nv.querySelector('.math-preview')!)
    const ta = nv.querySelector('textarea.math-src-input') as HTMLTextAreaElement
    ta.value = ''
    ta.dispatchEvent(new FocusEvent('blur'))

    let found = false
    v.state.doc.descendants(n => { if (n.type.name === 'math_block') found = true })
    expect(found).toBe(false)
  })
})

describe('math_inline NodeView', () => {
  it('click swaps rendered formula for the inline source field', () => {
    mount('value $x_0$ here')
    const nv = host.querySelector('.math-inline-nodeview')!
    click(nv.querySelector('.math-preview-inline')!)
    const input = nv.querySelector('input.math-src-input') as HTMLInputElement
    expect((nv.querySelector('.math-src-inline') as HTMLElement).style.display).toBe('')
    expect((nv.querySelector('.math-preview-inline') as HTMLElement).style.display).toBe('none')
    expect(input.value).toBe('x_0')
  })

  it('edit + blur commits new LaTeX into the text child', () => {
    const v = mount('value $x_0$ here')
    const nv = host.querySelector('.math-inline-nodeview')!
    click(nv.querySelector('.math-preview-inline')!)
    const input = nv.querySelector('input.math-src-input') as HTMLInputElement
    input.value = '\\alpha_1'
    input.dispatchEvent(new FocusEvent('blur'))

    let text = ''
    v.state.doc.descendants(n => { if (n.type.name === 'math_inline') text = n.textContent })
    expect(text).toBe('\\alpha_1')
  })
})

// Focus-race guard: PM's click handler runs AFTER enterEdit() and re-focuses
// the editor, blur-closing the source row in the same frame. The fix is
// stopEvent() swallowing mouse events; lock that contract here.
describe('stopEvent swallows mouse events (focus-race guard)', () => {
  function makeBlockNodeView() {
    const v = mount('$$\nx\n$$')
    const node = v.state.doc.firstChild!
    return mathBlockNodeView(node, v, () => 0)
  }
  function makeInlineNodeView() {
    const v = mount('a $x$ b')
    let node = v.state.doc.firstChild!
    node.forEach(c => { if (c.type.name === 'math_inline') node = c })
    return mathInlineNodeView(node, v, () => 2)
  }

  for (const type of ['mousedown', 'mouseup', 'click'] as const) {
    it(`math_block stopEvent('${type}') === true`, () => {
      expect(makeBlockNodeView().stopEvent!(new MouseEvent(type))).toBe(true)
    })
    it(`math_inline stopEvent('${type}') === true`, () => {
      expect(makeInlineNodeView().stopEvent!(new MouseEvent(type))).toBe(true)
    })
  }
})

describe('highlightLatex (source token coloring)', () => {
  it('wraps control sequences in .tok-cmd', () => {
    expect(highlightLatex('\\frac{a}{b}')).toContain('<span class="tok-cmd">\\frac</span>')
  })

  it('colors braces and sub/superscript markers distinctly', () => {
    const html = highlightLatex('x^2_i')
    expect(html).toContain('<span class="tok-script">^</span>')
    expect(html).toContain('<span class="tok-script">_</span>')
    expect(highlightLatex('{x}')).toContain('<span class="tok-brace">{</span>')
  })

  it('treats an escaped single char as one command token', () => {
    expect(highlightLatex('a\\\\b')).toContain('<span class="tok-cmd">\\\\</span>')
  })

  it('escapes HTML so the innerHTML backdrop cannot be injected', () => {
    const html = highlightLatex('a < b > c & d')
    expect(html).toContain('&lt;')
    expect(html).toContain('&gt;')
    expect(html).not.toContain('<b >')
    expect(highlightLatex('a & b')).toContain('<span class="tok-amp">&amp;</span>')
  })

  it('pads a trailing newline so the backdrop keeps caret alignment', () => {
    expect(highlightLatex('a\n')).toBe('a\n ')
  })

  it('leaves plain identifiers/numbers uncolored', () => {
    expect(highlightLatex('abc123')).toBe('abc123')
  })
})
