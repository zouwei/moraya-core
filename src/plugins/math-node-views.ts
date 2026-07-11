// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Typora-style in-place math editing — NodeViews for math_block / math_inline.
 *
 * Faithful migration from Moraya desktop `src/lib/editor/math-node-views.ts`.
 * The only DI change vs. desktop is the i18n import: desktop used its
 * app-level `$lib/i18n` store (`get(t)('math.placeholder')`); core uses its
 * own synchronous `t()` from `../i18n`.
 *
 * Interaction model (per the live-preview reference):
 *  - Normal state: only the KaTeX-rendered formula is visible.
 *  - Click the formula → the LaTeX source appears IN THE DOCUMENT FLOW:
 *      · math_block : a monospace source line ABOVE the rendered preview,
 *        wrapped in decorative `$$ … $$` delimiters; the preview below
 *        re-renders live on every keystroke.
 *      · math_inline: the rendered formula is replaced in place by an inline
 *        monospace source field wrapped in `$ … $`.
 *  - Focus leaves the source field (blur) → commit the edit and return to
 *    rendered-only display. Escape reverts. Cmd/Ctrl+Enter commits.
 *  - Clearing the source and leaving deletes the formula node.
 *
 * The LaTeX source is syntax-highlighted via a backdrop layer behind a
 * transparent textarea/input (native fields cannot color individual tokens).
 * Colors are driven by `--math-src-*` CSS custom properties — see
 * `styles/plugins/math-source.css`, which the consumer imports and may
 * override from its own theme.
 *
 * Storage contract (from the shared schema):
 *  - math_block  keeps LaTeX in `attrs.value`   → commit via setNodeMarkup.
 *  - math_inline keeps LaTeX as its text child  → commit via replaceWith.
 *
 * These NodeViews REPLACE the schema's toDOM rendering (registered in setup's
 * `nodeViews`). The NodeView DOM deliberately does NOT carry
 * `data-type="math_block"` so the editor-props mousedown interceptor (which
 * works around WebKit selection quirks on the toDOM rendering) no longer
 * applies — the NodeView owns interaction itself.
 */

import katex from 'katex'
// Side-effect: registers the \ce/\pu chemistry macros (mhchem) on the katex
// singleton — without it chemical equations render as red unknown-macro
// markers. Idempotent with the same import in schema.ts; kept external in
// tsup so it resolves to the consumer's single katex instance.
import 'katex/contrib/mhchem'
import { katexStrict } from '../katex-options'
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { t } from '../i18n'

type GetPos = () => number | undefined

/** Render LaTeX into `target`; falls back to error styling on bad input. */
function renderKatex(target: HTMLElement, latex: string, displayMode: boolean) {
  try {
    katex.render(latex, target, { displayMode, throwOnError: false, strict: katexStrict })
    target.classList.remove('math-error')
  } catch {
    target.textContent = latex
    target.classList.add('math-error')
  }
}

/** HTML-escape (the highlight layer is set via innerHTML — never trust input). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Tokenize LaTeX source into colored spans for the syntax-highlight backdrop.
 * Native textarea/input cannot color individual tokens, so the visible text is
 * this layer (the input's own glyphs are transparent, overlaid for the caret).
 *
 * Token classes (styled in math-source.css → var(--math-src-tok-*)):
 *   .tok-cmd    control sequences: \frac \alpha \\ \{ ...
 *   .tok-brace  grouping braces { }
 *   .tok-script sub/superscript markers ^ _
 *   .tok-amp    alignment tab &
 * Everything else (identifiers, numbers, operators) uses the default color.
 */
export function highlightLatex(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src.charAt(i)
    if (c === '\\') {
      // \word (letters) OR a single escaped char (\\, \{, \, , ...)
      let j = i + 1
      if (j < n && /[a-zA-Z]/.test(src.charAt(j))) {
        while (j < n && /[a-zA-Z]/.test(src.charAt(j))) j++
      } else {
        j = Math.min(j + 1, n)
      }
      out += `<span class="tok-cmd">${escapeHtml(src.slice(i, j))}</span>`
      i = j
    } else if (c === '{' || c === '}') {
      out += `<span class="tok-brace">${c}</span>`
      i++
    } else if (c === '^' || c === '_') {
      out += `<span class="tok-script">${c}</span>`
      i++
    } else if (c === '&') {
      out += `<span class="tok-amp">&amp;</span>`
      i++
    } else {
      let j = i
      while (j < n && !'\\{}^_&'.includes(src.charAt(j))) j++
      out += escapeHtml(src.slice(i, j))
      i = j
    }
  }
  // A trailing newline has no glyph line in a <div>, so the backdrop would be
  // one line shorter than the textarea — pad it to keep caret alignment.
  if (src.endsWith('\n')) out += ' '
  return out
}

// ── math_block ─────────────────────────────────────────────────────────

class MathBlockView implements NodeView {
  dom: HTMLDivElement
  private srcRow: HTMLDivElement
  private textarea: HTMLTextAreaElement
  private highlight: HTMLDivElement
  private preview: HTMLDivElement
  private node: PMNode
  private view: EditorView
  private getPos: GetPos
  private editing = false

  constructor(node: PMNode, view: EditorView, getPos: GetPos) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('div')
    this.dom.className = 'math-nodeview math-block-nodeview'

    // Source row: $$ [textarea] $$ — hidden until editing
    this.srcRow = document.createElement('div')
    this.srcRow.className = 'math-src-row'
    this.srcRow.style.display = 'none'
    const open = document.createElement('span')
    open.className = 'math-src-delim'
    open.textContent = '$$'
    const close = document.createElement('span')
    close.className = 'math-src-delim'
    close.textContent = '$$'
    this.textarea = document.createElement('textarea')
    this.textarea.className = 'math-src-input'
    this.textarea.spellcheck = false
    this.textarea.setAttribute('autocapitalize', 'off')
    this.textarea.setAttribute('autocorrect', 'off')
    this.textarea.placeholder = t('math.placeholder')
    // Syntax-highlight backdrop: colored token layer behind the transparent
    // textarea (native textareas cannot color individual tokens).
    this.highlight = document.createElement('div')
    this.highlight.className = 'math-src-highlight'
    this.highlight.setAttribute('aria-hidden', 'true')
    const field = document.createElement('div')
    field.className = 'math-src-field'
    field.append(this.highlight, this.textarea)
    this.srcRow.append(open, field, close)

    this.preview = document.createElement('div')
    this.preview.className = 'math-preview'
    renderKatex(this.preview, String(node.attrs.value ?? ''), true)

    this.dom.append(this.srcRow, this.preview)

    this.dom.addEventListener('mousedown', (e) => {
      // Keep PM from starting selection/mouse-tracking on the atom. Without
      // stopPropagation, PM's own click handling runs AFTER enterEdit() and
      // calls view.focus() — stealing focus from the textarea, firing blur,
      // and instantly closing the source row (reproduced in real WebKit).
      if (!this.editing) {
        e.preventDefault()
        e.stopPropagation()
      }
    })
    this.dom.addEventListener('click', (e) => {
      if (!this.editing) {
        e.preventDefault()
        e.stopPropagation()
        this.enterEdit()
      }
    })

    this.textarea.addEventListener('input', () => {
      this.autosize()
      this.updateHighlight()
      renderKatex(this.preview, this.textarea.value.trim(), true)
    })
    this.textarea.addEventListener('scroll', () => {
      this.highlight.scrollTop = this.textarea.scrollTop
      this.highlight.scrollLeft = this.textarea.scrollLeft
    })
    this.textarea.addEventListener('blur', () => {
      if (this.editing) this.commitAndExit(false)
    })
    this.textarea.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        this.revertAndExit()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        this.commitAndExit(true)
      }
      e.stopPropagation()
    })
  }

  private autosize() {
    const lines = this.textarea.value.split('\n').length
    this.textarea.rows = Math.max(1, Math.min(lines, 12))
  }

  private updateHighlight() {
    this.highlight.innerHTML = highlightLatex(this.textarea.value)
  }

  private enterEdit() {
    this.editing = true
    this.textarea.value = String(this.node.attrs.value ?? '')
    this.autosize()
    this.updateHighlight()
    this.srcRow.style.display = ''
    this.dom.classList.add('editing')
    this.textarea.focus()
    // Caret at the end — matches "click to open source, keep typing" flow.
    const len = this.textarea.value.length
    this.textarea.setSelectionRange(len, len)
  }

  private exitEdit() {
    this.editing = false
    this.srcRow.style.display = 'none'
    this.dom.classList.remove('editing')
  }

  /** Commit textarea → node. Empty source deletes the formula. */
  private commitAndExit(refocusView: boolean) {
    const value = this.textarea.value.trim()
    this.exitEdit()
    const pos = this.getPos()
    if (pos === undefined) return
    const current = this.view.state.doc.nodeAt(pos)
    if (!current || current.type !== this.node.type) return

    if (!value) {
      this.view.dispatch(this.view.state.tr.delete(pos, pos + current.nodeSize))
      this.view.focus()
      return
    }
    if (value !== String(current.attrs.value ?? '')) {
      this.view.dispatch(
        this.view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, value }),
      )
    } else {
      renderKatex(this.preview, value, true)
    }
    if (refocusView) {
      this.view.focus()
      const after = pos + (this.view.state.doc.nodeAt(pos)?.nodeSize ?? 0)
      const sel = TextSelection.near(this.view.state.doc.resolve(after))
      this.view.dispatch(this.view.state.tr.setSelection(sel))
    }
  }

  private revertAndExit() {
    this.exitEdit()
    renderKatex(this.preview, String(this.node.attrs.value ?? ''), true)
    this.view.focus()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.attrs.value !== this.node.attrs.value
    this.node = node
    if (changed && !this.editing) {
      renderKatex(this.preview, String(node.attrs.value ?? ''), true)
    }
    return true
  }

  // While editing, all events inside the source row belong to the textarea.
  // Mouse events on the preview are ALSO ours: returning true here makes PM
  // skip its click handling entirely, so it can't re-focus the editor and
  // blur-close the source row right after enterEdit() (WebKit focus race).
  stopEvent(e: Event): boolean {
    if (this.editing && this.srcRow.contains(e.target as Node)) return true
    return e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'click'
  }

  ignoreMutation(): boolean {
    return true
  }
}

// ── math_inline ────────────────────────────────────────────────────────

class MathInlineView implements NodeView {
  dom: HTMLSpanElement
  private srcWrap: HTMLSpanElement
  private input: HTMLInputElement
  private highlight: HTMLSpanElement
  private preview: HTMLSpanElement
  private node: PMNode
  private view: EditorView
  private getPos: GetPos
  private editing = false

  constructor(node: PMNode, view: EditorView, getPos: GetPos) {
    this.node = node
    this.view = view
    this.getPos = getPos

    this.dom = document.createElement('span')
    this.dom.className = 'math-nodeview math-inline-nodeview'

    this.srcWrap = document.createElement('span')
    this.srcWrap.className = 'math-src-inline'
    this.srcWrap.style.display = 'none'
    const open = document.createElement('span')
    open.className = 'math-src-delim'
    open.textContent = '$'
    const close = document.createElement('span')
    close.className = 'math-src-delim'
    close.textContent = '$'
    this.input = document.createElement('input')
    this.input.type = 'text'
    this.input.className = 'math-src-input'
    this.input.spellcheck = false
    this.input.setAttribute('autocapitalize', 'off')
    this.highlight = document.createElement('span')
    this.highlight.className = 'math-src-highlight-inline'
    this.highlight.setAttribute('aria-hidden', 'true')
    const field = document.createElement('span')
    field.className = 'math-src-field-inline'
    field.append(this.highlight, this.input)
    this.srcWrap.append(open, field, close)

    this.preview = document.createElement('span')
    this.preview.className = 'math-preview-inline'
    renderKatex(this.preview, node.textContent, false)

    this.dom.append(this.srcWrap, this.preview)

    this.dom.addEventListener('mousedown', (e) => {
      if (!this.editing) {
        e.preventDefault()
        e.stopPropagation()
      }
    })
    this.dom.addEventListener('click', (e) => {
      if (!this.editing) {
        e.preventDefault()
        e.stopPropagation()
        this.enterEdit()
      }
    })
    this.input.addEventListener('input', () => {
      this.resizeToContent()
      this.updateHighlight()
    })
    this.input.addEventListener('scroll', () => {
      this.highlight.scrollLeft = this.input.scrollLeft
    })
    this.input.addEventListener('blur', () => {
      if (this.editing) this.commitAndExit(false)
    })
    this.input.addEventListener('keydown', (e) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        this.revertAndExit()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        this.commitAndExit(true)
      }
      e.stopPropagation()
    })
  }

  private resizeToContent() {
    // ch-based sizing keeps the inline field snug around the source text.
    this.input.style.width = `${Math.max(2, this.input.value.length + 1)}ch`
  }

  private updateHighlight() {
    this.highlight.innerHTML = highlightLatex(this.input.value)
  }

  private enterEdit() {
    this.editing = true
    this.input.value = this.node.textContent
    this.resizeToContent()
    this.updateHighlight()
    this.srcWrap.style.display = ''
    this.preview.style.display = 'none'
    this.dom.classList.add('editing')
    this.input.focus()
    const len = this.input.value.length
    this.input.setSelectionRange(len, len)
  }

  private exitEdit() {
    this.editing = false
    this.srcWrap.style.display = 'none'
    this.preview.style.display = ''
    this.dom.classList.remove('editing')
  }

  private commitAndExit(refocusView: boolean) {
    const value = this.input.value.trim()
    this.exitEdit()
    const pos = this.getPos()
    if (pos === undefined) return
    const current = this.view.state.doc.nodeAt(pos)
    if (!current || current.type !== this.node.type) return

    if (!value) {
      this.view.dispatch(this.view.state.tr.delete(pos, pos + current.nodeSize))
      this.view.focus()
      return
    }
    if (value !== current.textContent) {
      const newNode = current.type.create(
        current.attrs,
        this.view.state.schema.text(value),
        current.marks,
      )
      this.view.dispatch(
        this.view.state.tr.replaceWith(pos, pos + current.nodeSize, newNode),
      )
    } else {
      renderKatex(this.preview, value, false)
    }
    if (refocusView) {
      this.view.focus()
      const after = pos + (this.view.state.doc.nodeAt(pos)?.nodeSize ?? 0)
      const sel = TextSelection.near(this.view.state.doc.resolve(after))
      this.view.dispatch(this.view.state.tr.setSelection(sel))
    }
  }

  private revertAndExit() {
    this.exitEdit()
    renderKatex(this.preview, this.node.textContent, false)
    this.view.focus()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    const changed = node.textContent !== this.node.textContent
    this.node = node
    if (changed && !this.editing) {
      renderKatex(this.preview, node.textContent, false)
    }
    return true
  }

  stopEvent(e: Event): boolean {
    if (this.editing && this.srcWrap.contains(e.target as Node)) return true
    return e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'click'
  }

  ignoreMutation(): boolean {
    return true
  }
}

// ── Factories (EditorView `nodeViews` signature) ───────────────────────

export function mathBlockNodeView(node: PMNode, view: EditorView, getPos: GetPos): NodeView {
  return new MathBlockView(node, view, getPos)
}

export function mathInlineNodeView(node: PMNode, view: EditorView, getPos: GetPos): NodeView {
  return new MathInlineView(node, view, getPos)
}
