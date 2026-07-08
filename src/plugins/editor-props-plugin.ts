// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Unified editor props plugin — merges 5 separate ProseMirror plugins into one.
 *
 * Faithful 1:1 migration from Moraya desktop `src/lib/editor/plugins/editor-props-plugin.ts`
 * with the following DI changes (v0.60.0-pre §F2.6):
 *   - `editorStore.getState().currentFilePath` → `platform.getCurrentFilePath()`
 *   - `isMacOS` from `$lib/utils/platform` → `platform.isMacOS`
 *   - `import('@tauri-apps/plugin-opener').{openPath,openUrl}` → `linkOpener.open(href)`
 *     (the consumer's LinkOpener implementation routes to the right platform API)
 *
 * Consolidated props:
 *  - `clipboardTextParser`: parse pasted plain text as Markdown (render instead of escape)
 *  - `transformPastedHTML`: paste language fix (copy `class="language-xxx"` → `data-language`)
 *  - `handleDOMEvents.mousedown`: math_block click → prevent WebKit broken selection;
 *    Cmd/Ctrl+click on links → open externally via LinkOpener
 *  - `handleDOMEvents.keydown/keyup`: toggle link-hover cursor class on Cmd/Ctrl;
 *    fast AllSelection delete; WKWebView end-of-textblock Backspace fix
 *  - `handleClick`: click below content → append paragraph + place cursor
 *  - `handleClickOn`: image click → TextSelection (prevent NodeSelection blue highlight)
 *  - `handleKeyDown`: ArrowRight escape; fast AllSelection delete (fallback)
 *  - `decorations`: WKWebView caret fix for empty paragraphs (macOS only)
 *  - `view` lifecycle: scroll-after-paste; empty-doc focus recovery
 *
 * Reducing 5 plugin instances to 1 saves ~4 apply() traversals per transaction.
 */

import { Fragment, Slice } from 'prosemirror-model'
import { AllSelection, Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { parseMarkdown, parseMarkdownAsync } from '../markdown'
import type { LinkOpener, Platform } from '../types'

const editorPropsKey = new PluginKey('moraya-editor-props')

// Mirrors markdown.ts's own ASYNC_PARSE_THRESHOLD (50_000 chars). Pasting a
// document at or above this size runs `clipboardTextParser` SYNCHRONOUSLY on
// the main thread inside the native `paste` DOM event — fine on desktop
// hardware, but mobile WKWebView is far less tolerant of a multi-second
// synchronous script during a user gesture. Symptom observed: pasting a long
// markdown document directly into the visual editor silently did nothing
// (the parse blocked long enough that the paste never visibly landed).
// `handleDOMEvents.paste` below intercepts BEFORE ProseMirror's own paste
// pipeline runs `clipboardTextParser` (which is what makes this fixable —
// `handlePaste` fires too late, after that parse already happened to build
// its `slice` argument), and does the parse via `parseMarkdownAsync` instead.
const ASYNC_PASTE_THRESHOLD = 50_000

/** Detect whether a URL is a local file path (absolute or relative). */
function isLocalFilePath(href: string): boolean {
  // Absolute Unix/macOS paths
  if (href.startsWith('/')) return true
  // Relative paths
  if (href.startsWith('./') || href.startsWith('../')) return true
  // Windows absolute paths
  if (/^[A-Za-z]:[/\\]/.test(href)) return true
  // file:// protocol
  if (href.startsWith('file://')) return true
  return false
}

/** Resolve a local-path href against the platform's current file directory. */
function resolveLocalPath(href: string, platform: Platform): string {
  // Strip file:// protocol and decode URL-encoded characters
  let path = href
  if (path.startsWith('file:///')) {
    path = path.slice(7) // file:///path → /path
    try { path = decodeURIComponent(path) } catch { /* keep as-is */ }
  } else if (path.startsWith('file://')) {
    path = path.slice(5) // file://path → //path (UNC)
    try { path = decodeURIComponent(path) } catch { /* keep as-is */ }
  }

  // Already absolute
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path)) return path

  // Relative path: resolve against current file's directory
  const currentFile = platform.getCurrentFilePath()
  if (currentFile) {
    const dir = currentFile.replace(/[/\\][^/\\]*$/, '')
    return dir + '/' + path
  }
  return path
}

export interface EditorPropsPluginOptions {
  platform: Platform
  linkOpener: LinkOpener
}

export function createEditorPropsPlugin(opts: EditorPropsPluginOptions): Plugin {
  const { platform, linkOpener } = opts
  const isMacOS = platform.isMacOS

  // scroll-after-paste state
  let pendingPaste = false

  return new Plugin({
    key: editorPropsKey,

    props: {
      /**
       * Parse pasted plain text as Markdown so syntax renders instead of
       * being inserted as escaped literal text.
       */
      clipboardTextParser(text, $context, plain) {
        if (plain || $context.parent.type.spec.code) return undefined!
        const doc = parseMarkdown(text)
        // If markdown parse produced a single empty paragraph, fall back to
        // literal text insertion to avoid replacing the current selection.
        if (doc.textContent.length === 0 && doc.content.size <= 2) return undefined!
        const content = doc.content
        // Single paragraph → extract inline content so it merges into current text
        if (content.childCount === 1 && content.firstChild!.type.name === 'paragraph') {
          return new Slice(content.firstChild!.content, 0, 0)
        }
        return new Slice(content, 0, 0)
      },

      /**
       * Safety net for degenerate pastes (empty markdown link, empty <a>, etc.).
       * Also routes pasted markdown image syntax through the markdown parser.
       */
      handlePaste(view, event, slice) {
        const plain = event.clipboardData?.getData('text/plain')
        if (!plain) return false

        // Markdown image syntax — parse so the image renders instead of being escaped
        const trimmed = plain.trim()
        if (/^!\[/.test(trimmed)) {
          const doc = parseMarkdown(trimmed)
          if (doc.content.size > 2) {
            const content = doc.content
            const inner = (content.childCount === 1 && content.firstChild!.type.name === 'paragraph')
              ? content.firstChild!.content
              : content
            view.dispatch(
              view.state.tr.replaceSelection(new Slice(inner, 0, 0)),
            )
            pendingPaste = true
            return true
          }
        }

        // Link pattern with empty text or empty URL
        const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(trimmed)
        if (linkMatch && (!linkMatch[1] || !linkMatch[2])) {
          const textNode = view.state.schema.text(plain)
          view.dispatch(
            view.state.tr.replaceSelection(new Slice(Fragment.from(textNode), 0, 0)),
          )
          pendingPaste = true
          return true
        }

        // Degenerate slice (e.g. empty <a> tag from HTML clipboard)
        try {
          const sliceText = slice.content.textBetween(0, slice.content.size, '', '')
          if (sliceText.trim().length === 0 && trimmed.length > 0) {
            const textNode = view.state.schema.text(plain)
            view.dispatch(
              view.state.tr.replaceSelection(new Slice(Fragment.from(textNode), 0, 0)),
            )
            pendingPaste = true
            return true
          }
        } catch { /* malformed slice — fall through */ }

        return false
      },

      /**
       * Paste language normalization:
       * Copy class="language-xxx" from <code> to data-language on parent <pre>.
       */
      transformPastedHTML(html) {
        if (!html.includes('language-')) return html
        try {
          const template = document.createElement('template')
          template.innerHTML = html
          const fragment = template.content
          for (const pre of fragment.querySelectorAll('pre')) {
            if (pre.dataset.language) continue
            const code = pre.querySelector('code')
            if (!code) continue
            const match = code.className.match(/(?:language|lang)-(\S+)/)
            if (match && match[1]) {
              pre.dataset.language = match[1]
            }
          }
          return template.innerHTML
        } catch {
          return html
        }
      },

      handleDOMEvents: {
        /**
         * Large-paste fast path: parse asynchronously so a big markdown
         * document doesn't block the main thread synchronously inside this
         * event handler (see ASYNC_PASTE_THRESHOLD comment above). Returning
         * `true` here stops ProseMirror's own paste pipeline from running at
         * all for this event — including the synchronous `clipboardTextParser`
         * call — so we own the entire insert ourselves.
         *
         * Falls through to the default (synchronous, existing) path for:
         *   - anything without text/plain data (e.g. images — unaffected)
         *   - text under the threshold (cheap enough to stay synchronous)
         *   - paste target inside a code block (plain-text paste, no markdown
         *     parsing involved either way — letting the default path run is
         *     simpler and behaviorally identical)
         */
        paste(view, event) {
          const pasteEvent = event as ClipboardEvent
          const plain = pasteEvent.clipboardData?.getData('text/plain')
          if (!plain || plain.length < ASYNC_PASTE_THRESHOLD) return false
          if (view.state.selection.$from.parent.type.spec.code) return false

          pasteEvent.preventDefault()
          const { from, to } = view.state.selection
          parseMarkdownAsync(plain).then(doc => {
            if (view.isDestroyed) return
            const content = doc.content
            if (content.size === 0) return // nothing usable came out of the parse
            const inner = (content.childCount === 1 && content.firstChild!.type.name === 'paragraph')
              ? content.firstChild!.content
              : content
            // Selection may have moved during the async gap — clamp to the
            // current doc bounds rather than assume from/to are still valid.
            const docSize = view.state.doc.content.size
            const safeFrom = Math.min(from, docSize)
            const safeTo = Math.min(Math.max(to, safeFrom), docSize)
            view.dispatch(view.state.tr.replace(safeFrom, safeTo, new Slice(inner, 0, 0)))
          }).catch(err => {
            // parseMarkdownAsync's own contract is "never rejects" — this is
            // a defensive backstop in case that ever changes, not a path
            // expected to run.
            console.error('[editor-props-plugin] large-paste insert failed unexpectedly:', err)
          })
          return true
        },

        /**
         * Safety: prevent WebView navigation on any remaining <a> clicks.
         * (Most <a> tags get expanded to literal text on mousedown, but this
         * is a fallback in case the click fires before the expand.)
         */
        click(_view, event) {
          const me = event as MouseEvent
          const target = me.target as HTMLElement | null
          if (!target) return false
          const anchor = target.closest('a[href]') as HTMLAnchorElement | null
          if (anchor) {
            me.preventDefault()
          }
          return false
        },

        mousedown(view, event) {
          const me = event as MouseEvent
          if (me.button !== 0) return false
          const target = me.target as HTMLElement | null
          if (!target) return false

          // ── Cmd/Ctrl+click on links → open externally via LinkOpener ──
          // Must be handled in mousedown BEFORE ProseMirror places cursor,
          // because link-text-plugin's appendTransaction expands link marks
          // to literal text on cursor entry, removing <a> from DOM before
          // the click event fires.
          if (me.metaKey || me.ctrlKey) {
            const anchor = target.closest('a[href]') as HTMLAnchorElement | null
            if (anchor) {
              const href = anchor.getAttribute('href')
              if (href) {
                me.preventDefault()
                const targetHref = isLocalFilePath(href)
                  ? resolveLocalPath(href, platform)
                  : href
                try {
                  linkOpener.open(targetHref)
                } catch (e) {
                  console.warn('[opener] failed:', targetHref, e)
                }
                return true // consume — don't place cursor or expand
              }
            }
          }

          // ── Math block click fix ──
          const mathBlock = target.closest('div[data-type="math_block"]')
          if (!mathBlock) return false

          // Prevent WebKit from creating the broken range selection
          me.preventDefault()

          try {
            const pos = view.posAtDOM(mathBlock, 0)
            const $pos = view.state.doc.resolve(pos)

            // Walk up to find the math_block node and get its before-position
            let beforePos = pos
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type.name === 'math_block') {
                beforePos = $pos.before(d)
                break
              }
            }
            const $before = view.state.doc.resolve(beforePos)
            if (!$before.nodeAfter || $before.nodeAfter.type.name !== 'math_block') {
              if ($pos.nodeAfter?.type.name === 'math_block') {
                beforePos = pos
              }
            }

            const sel = TextSelection.near(view.state.doc.resolve(beforePos), -1)
            view.dispatch(view.state.tr.setSelection(sel))
          } catch { /* ignore — focus below is the fallback */ }

          view.focus()
          return true
        },

        /**
         * Cmd/Ctrl held → add 'link-hover' class for pointer cursor on links.
         * Also handles fast AllSelection delete + WKWebView end-of-textblock
         * Backspace fix at the highest priority interception point.
         */
        keydown(view, event) {
          if (event.isComposing) return false

          if (event.key === 'Meta' || event.key === 'Control') {
            view.dom.classList.add('link-hover')
          }

          // handleDOMEvents.keydown fires BEFORE handleKeyDown and captureKeyDown
          if ((event.key === 'Backspace' || event.key === 'Delete') &&
              !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
            // Fast AllSelection / full-range deletion
            // On macOS Cmd+A is handled by native PredefinedMenuItem::select_all
            // which changes the DOM selection but ProseMirror's selectionchange
            // observer may NOT have synced yet. Force flush + DOM Range comparison.
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ;(view as any).domObserver?.flush?.()
            } catch { /* internal API */ }

            const docSize = view.state.doc.content.size
            let isAllSelected = false

            // Check 1: ProseMirror's internal selection
            const sel = view.state.selection
            if (sel instanceof AllSelection ||
              (docSize > 0 && sel.from <= 1 && sel.to >= docSize - 1)) {
              isAllSelected = true
            }

            // Check 2: DOM Range comparison
            if (!isAllSelected && docSize > 0) {
              try {
                const domSel = window.getSelection()
                if (domSel && !domSel.isCollapsed && domSel.rangeCount > 0) {
                  const range = domSel.getRangeAt(0)
                  const editorRange = document.createRange()
                  editorRange.selectNodeContents(view.dom)
                  if (range.compareBoundaryPoints(Range.START_TO_START, editorRange) <= 0 &&
                    range.compareBoundaryPoints(Range.END_TO_END, editorRange) >= 0) {
                    isAllSelected = true
                  }
                }
              } catch { /* Range API edge cases */ }
            }

            // Check 3: Text content length comparison (last resort)
            if (!isAllSelected && docSize > 0) {
              try {
                const domSel = window.getSelection()
                if (domSel && !domSel.isCollapsed) {
                  const selectedText = domSel.toString()
                  const fullText = view.dom.textContent || ''
                  if (selectedText.length > 0 && fullText.length > 0 &&
                    selectedText.length >= fullText.length * 0.9) {
                    isAllSelected = true
                  }
                }
              } catch { /* ignore */ }
            }

            if (isAllSelected) {
              event.preventDefault()
              const paragraphType = view.state.schema.nodes.paragraph
              if (!paragraphType) return false
              const emptyParagraph = paragraphType.create()
              const tr = view.state.tr.replaceWith(0, docSize, emptyParagraph)
              tr.setSelection(TextSelection.create(tr.doc, 1))
              tr.setMeta('full-delete', true)
              view.dispatch(tr)
              return true
            }

            // ── WKWebView end-of-textblock Backspace fix ──
            // ProseMirror's captureKeyDown → stopNativeHorizontalDelete uses
            // view.endOfTextblock("backward") which relies on WebKit's
            // Selection.modify(). In WKWebView this can return incorrect
            // results at paragraph boundaries, causing joinBackward to merge
            // paragraphs instead of deleting the character before the cursor.
            if (event.key === 'Backspace') {
              if (sel instanceof TextSelection && sel.empty && sel.$cursor) {
                const { parent, parentOffset } = sel.$cursor
                if (parent.isTextblock && parentOffset === parent.content.size && parentOffset > 0) {
                  const nb = sel.$cursor.nodeBefore
                  if (nb) {
                    event.preventDefault()
                    if (nb.isText && nb.text) {
                      const code = nb.text.charCodeAt(nb.text.length - 1)
                      const delLen = (code >= 0xDC00 && code <= 0xDFFF) ? 2 : 1
                      view.dispatch(view.state.tr.delete(sel.from - delLen, sel.from).scrollIntoView())
                    } else {
                      view.dispatch(view.state.tr.delete(sel.from - nb.nodeSize, sel.from).scrollIntoView())
                    }
                    return true
                  }
                }
              }
            }
          }

          return false
        },
        keyup(view, event) {
          if (event.key === 'Meta' || event.key === 'Control') {
            view.dom.classList.remove('link-hover')
          }
          return false
        },
      },

      /**
       * Click below content: append a paragraph and place cursor there when
       * the last node is a code_block / table / etc. and user clicks below it.
       */
      handleClick(view, _pos, event) {
        if (event.button !== 0) return false
        const { doc } = view.state
        const lastNode = doc.lastChild
        if (!lastNode || lastNode.type.name === 'paragraph') return false
        const lastNodePos = doc.content.size - lastNode.nodeSize
        const lastDOM = view.nodeDOM(lastNodePos) as HTMLElement | null
        if (!lastDOM) return false

        // Only trigger when clicking BELOW the last block's bottom edge.
        const rect = lastDOM.getBoundingClientRect()
        if (event.clientY <= rect.bottom) return false

        const paragraphType = view.state.schema.nodes.paragraph
        if (!paragraphType) return false
        const endPos = doc.content.size
        const paragraph = paragraphType.create()
        const tr = view.state.tr.insert(endPos, paragraph)
        tr.setSelection(TextSelection.create(tr.doc, endPos + 1))
        view.dispatch(tr)
        view.focus()
        return true
      },

      /**
       * Image click: prevent NodeSelection blue highlight, place TextSelection
       * after the image instead. (math_block is handled in mousedown above.)
       */
      handleClickOn(view, _pos, node, nodePos, event) {
        if (node.type.name !== 'image') return false
        if (event.button !== 0) return false

        const $pos = view.state.doc.resolve(nodePos + node.nodeSize)
        const sel = TextSelection.near($pos)
        view.dispatch(view.state.tr.setSelection(sel))
        return true
      },

      /**
       * Keyboard shortcuts (after keymap plugins):
       *  - ArrowRight: escape formatting mark boundary
       *  - Backspace/Delete on AllSelection: fast full-doc deletion
       */
      handleKeyDown(view, event) {
        if (event.isComposing) return false

        // ArrowRight: escape formatting mark at right boundary
        if (event.key === 'ArrowRight' &&
            !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const sel = view.state.selection
          if (sel.empty && sel instanceof TextSelection && sel.$cursor) {
            const $cursor = sel.$cursor
            const ZWSP_MARK_NAMES = ['code', 'strong', 'em', 'strike_through']
            const nodeBefore = $cursor.nodeBefore
            const nodeAfter = $cursor.nodeAfter
            const hasTargetMarkBefore = nodeBefore != null && ZWSP_MARK_NAMES.some(name => {
              const mt = view.state.schema.marks[name]
              return mt && nodeBefore.marks.some(m => m.type === mt)
            })
            if (hasTargetMarkBefore && nodeAfter?.isText &&
                nodeAfter.text?.startsWith('​')) {
              const nextPos = $cursor.pos + nodeAfter.nodeSize
              const $next = view.state.doc.resolve(Math.min(nextPos, view.state.doc.content.size))
              const nextSel = TextSelection.near($next, 1)
              const tr = view.state.tr.setSelection(nextSel)
              tr.setStoredMarks([])
              tr.setMeta('code-escape', true)
              tr.scrollIntoView()
              view.dispatch(tr)
              return true
            }
          }
        }

        // Fast AllSelection / full-range deletion
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const sel = view.state.selection
          const docSize = view.state.doc.content.size
          const isAllSelected =
            sel instanceof AllSelection ||
            (docSize > 0 && sel.from <= 1 && sel.to >= docSize - 1)
          if (isAllSelected) {
            event.preventDefault()
            const paragraphType = view.state.schema.nodes.paragraph
            if (!paragraphType) return false
            const emptyParagraph = paragraphType.create()
            const tr = view.state.tr.replaceWith(0, docSize, emptyParagraph)
            tr.setSelection(TextSelection.create(tr.doc, 1))
            tr.setMeta('full-delete', true)
            view.dispatch(tr)
            return true
          }
        }

        return false
      },

      /**
       * WKWebView caret fix: add 'caret-empty-para' decoration to empty
       * paragraph under cursor on macOS.
       */
      decorations(state) {
        if (!isMacOS) return DecorationSet.empty
        const { selection } = state
        if (!selection.empty) return DecorationSet.empty

        const { $from } = selection
        const parent = $from.parent
        if (parent.type.name === 'paragraph' && parent.content.size === 0) {
          const pos = $from.before()
          return DecorationSet.create(state.doc, [
            Decoration.node(pos, pos + parent.nodeSize, { class: 'caret-empty-para' }),
          ])
        }
        return DecorationSet.empty
      },
    },

    /**
     * Scroll-after-paste + empty-doc focus recovery.
     */
    view(editorView) {
      function onPaste() { pendingPaste = true }
      editorView.dom.addEventListener('paste', onPaste, true)

      // Remove link-hover class when window loses focus (Cmd/Ctrl release won't fire)
      function onBlur() { editorView.dom.classList.remove('link-hover') }
      window.addEventListener('blur', onBlur)

      return {
        update(view, prevState) {
          // WKWebView empty-doc focus recovery
          if (isMacOS && view.state.doc !== prevState.doc) {
            const docSize = view.state.doc.content.size
            const prevDocSize = prevState.doc.content.size
            if (docSize <= 4 && prevDocSize > 4) {
              requestAnimationFrame(() => {
                try {
                  if (!view.hasFocus()) view.focus()
                } catch { /* ignore */ }
              })
            }
          }

          if (!pendingPaste || view.state.doc.eq(prevState.doc)) return
          pendingPaste = false
          requestAnimationFrame(() => {
            try {
              const { from } = view.state.selection
              const coords = view.coordsAtPos(from)
              const wrapper = view.dom.closest('.editor-wrapper') as HTMLElement | null
              if (!wrapper) return
              const rect = wrapper.getBoundingClientRect()
              if (coords.top < rect.top || coords.bottom > rect.bottom) {
                wrapper.scrollTop += coords.top - rect.top - rect.height / 2
              }
            } catch { /* ignore */ }
          })
        },
        destroy() {
          editorView.dom.removeEventListener('paste', onPaste, true)
          window.removeEventListener('blur', onBlur)
          editorView.dom.classList.remove('link-hover')
        },
      }
    },
  })
}
