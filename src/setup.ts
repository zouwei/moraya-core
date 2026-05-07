/**
 * Editor lifecycle factory for `@moraya/core`.
 *
 * Faithful 1:1 migration from Moraya desktop `src/lib/editor/setup.ts`,
 * with the following DI changes (v0.60.0-pre §F2.5 / §F2.6):
 *   - Schema is built per-call from a consumer-injected `MediaResolver`.
 *   - `LinkOpener` / `RendererRegistry` / `Platform` are forwarded to plugins
 *     that need them (RendererRegistry → Tier 1 code-block-view in next batch).
 *   - All `require()` calls in the original (4 sites) are replaced with
 *     top-level ESM imports (§1.1.1 Pure ESM constraint).
 *
 * Public API per §3.2:
 *   - `createEditor(opts)` — returns a `MorayaEditorInstance` ready to mount
 *   - `createEditorPlugins(opts)` — returns the plugin array (for consumers
 *     that want full control over `EditorView` construction)
 *   - `preloadEnhancementPlugins()` — warms the Tier 1 lazy-load cache
 */

import {
  AllSelection,
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { history, redo, undo } from 'prosemirror-history'
import {
  baseKeymap,
  joinForward,
  setBlockType,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands'
import {
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
  InputRule,
} from 'prosemirror-inputrules'
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from 'prosemirror-schema-list'
import { dropCursor } from 'prosemirror-dropcursor'
import { columnResizing } from 'prosemirror-tables'
import type { Schema, Node as PmNode } from 'prosemirror-model'

import { createSchema } from './schema'
import { parseMarkdown, serializeMarkdown } from './markdown'
import { wrapInBulletList, wrapInOrderedList, wrapInTaskList } from './commands'
import { createDefListInputRule } from './plugins/definition-list'
import { createEnterHandlerPlugin } from './plugins/enter-handler'
import { createCursorSyntaxPlugin } from './plugins/cursor-syntax'
import { createLinkTextPlugin } from './plugins/link-text-plugin'
import { createInlineCodeConvertPlugin } from './plugins/inline-code-convert'
import { createEditorPropsPlugin } from './plugins/editor-props-plugin'
import type {
  MediaResolver,
  LinkOpener,
  RendererRegistry,
  Platform,
  SchemaConfig,
} from './types'
import { createDocCache, type DocCache } from './doc-cache'

// ── Tier 1: Enhancement plugins (dynamic imports, loaded in parallel) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodeBlockNodeView = any

interface Tier1Plugins {
  highlight?: Plugin
  /** NodeView factory: `(node, view, getPos) => NodeView`. Wired into nodeViews at editor mount. */
  codeBlockView?: CodeBlockNodeView
  emoji?: Plugin
  defListInputRule?: InputRule
}

interface Tier1CacheKey {
  schema: Schema
  rendererRegistry?: RendererRegistry
}

let tier1Cache: { key: Tier1CacheKey; plugins: Tier1Plugins } | null = null
let tier1Loading: Promise<Tier1Plugins> | null = null

/**
 * Preload Tier 1 enhancement plugins via dynamic `import()`.
 * Each plugin becomes a separate Vite/Rollup chunk (automatic code splitting).
 * Can be called early (e.g. in onMount) to warm the cache.
 *
 * The `defListInputRule` requires a Schema; the `codeBlockView` factory
 * closes over the consumer's `RendererRegistry`. The cache is keyed by
 * (schema, rendererRegistry) so consumers with different injection produce
 * different cached factories.
 */
export function preloadEnhancementPlugins(
  schema: Schema,
  rendererRegistry?: RendererRegistry,
): Promise<Tier1Plugins> {
  if (tier1Cache &&
      tier1Cache.key.schema === schema &&
      tier1Cache.key.rendererRegistry === rendererRegistry) {
    return Promise.resolve(tier1Cache.plugins)
  }
  if (tier1Loading) return tier1Loading

  tier1Loading = Promise.allSettled([
    import('./plugins/highlight'),
    import('./plugins/emoji'),
    import('./plugins/code-block-view'),
  ]).then(([hl, em, cbv]) => {
    const plugins: Tier1Plugins = {}
    if (hl.status === 'fulfilled') {
      plugins.highlight = hl.value.createHighlightPlugin()
    }
    if (em.status === 'fulfilled') {
      plugins.emoji = em.value.createEmojiPlugin()
    }
    if (cbv.status === 'fulfilled') {
      plugins.codeBlockView = cbv.value.createCodeBlockNodeViewFactory({
        ...(rendererRegistry ? { rendererRegistry } : {}),
      })
    }
    plugins.defListInputRule = createDefListInputRule(schema)
    tier1Cache = { key: { schema, ...(rendererRegistry ? { rendererRegistry } : {}) }, plugins }
    tier1Loading = null
    return plugins
  })

  return tier1Loading
}

// ── Image Selection Highlight ───────────────────────────────────
// When a range selection covers image nodes, add a decoration class so CSS
// can show a blue overlay (images don't get browser text-selection highlight).

function createImageSelectionPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('moraya-image-selection'),
    props: {
      decorations(state) {
        const { from, to } = state.selection
        if (from === to) return DecorationSet.empty // cursor, no range
        const decos: Decoration[] = []
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'image') {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'image-in-selection' }))
          } else if (node.type.name === 'html_inline' && /^<img\s/i.test((node.attrs.value as string) || '')) {
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'image-in-selection' }))
          }
        })
        return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
      },
    },
  })
}

// ── Input Rules ─────────────────────────────────────────────────

function buildInputRules(schema: Schema, tier1: Tier1Plugins): Plugin {
  const rules: InputRule[] = []
  const N = schema.nodes
  const M = schema.marks

  // Code block: ```language
  if (N.code_block) {
    rules.push(textblockTypeInputRule(
      /^```(?<language>[a-zA-Z][a-zA-Z0-9_+#.\-]*)?[\s\n]$/,
      N.code_block,
      (match) => ({ language: match.groups?.language ?? '' }),
    ))
  }

  // Blockquote: > at start of line
  if (N.blockquote) {
    rules.push(wrappingInputRule(/^\s*>\s$/, N.blockquote))
  }

  // Bullet list: - or * at start of line
  if (N.bullet_list) {
    rules.push(wrappingInputRule(/^\s*[-*]\s$/, N.bullet_list))
  }

  // Ordered list: 1. at start of line
  if (N.ordered_list) {
    rules.push(wrappingInputRule(
      /^\s*(\d+)\.\s$/,
      N.ordered_list,
      (match) => ({ order: +(match[1] ?? '1') }),
      (match, node) => node.childCount + (node.attrs.order as number) === +(match[1] ?? '1'),
    ))
  }

  // Heading: # to ######
  if (N.heading) {
    for (let level = 1; level <= 6; level++) {
      const pattern = new RegExp(`^#{${level}}\\s$`)
      rules.push(textblockTypeInputRule(pattern, N.heading, { level }))
    }
  }

  // Horizontal rule: ---
  if (N.horizontal_rule) {
    rules.push(new InputRule(/^---$/, (state, _match, start, end) => {
      const hr = N.horizontal_rule!.create()
      return state.tr.replaceWith(start - 1, end, hr)
    }))
  }

  // Math block: $$
  if (N.math_block) {
    rules.push(new InputRule(/^\$\$\s$/, (state, _match, start, end) => {
      const $start = state.doc.resolve(start)
      if (!$start.node(-1).canReplaceWith(
        $start.index(-1), $start.indexAfter(-1), N.math_block!,
      )) return null
      return state.tr.delete(start, end).setBlockType(start, start, N.math_block!)
    }))
  }

  // Math inline: $...$
  if (N.math_inline) {
    rules.push(new InputRule(/(?:\$)([^$]+)(?:\$)$/, (state, match, start, end) => {
      const content = match[1]
      if (!content) return null
      const node = N.math_inline!.create(null, schema.text(content))
      return state.tr.replaceWith(start, end, node)
    }))
  }

  // Strong: **text** or __text__
  if (M.strong) {
    rules.push(new InputRule(
      /(?<![\w:/])(?:\*\*|__)([^*_]+?)(?:\*\*|__)(?![\w/])$/,
      (state, match, start, end) => {
        const tr = state.tr
        const captured = match[1]
        if (captured) {
          const textStart = start + match[0].indexOf(captured)
          const textEnd = textStart + captured.length
          if (textEnd < end) tr.delete(textEnd, end)
          if (textStart > start) tr.delete(start, textStart)
          const markFrom = start
          const markTo = markFrom + captured.length
          tr.addMark(markFrom, markTo, M.strong!.create())
        }
        return tr
      },
    ))
  }

  // Emphasis: *text* or _text_
  if (M.em) {
    rules.push(new InputRule(
      /(?<![\w:/*])(?:\*|_)([^*_]+?)(?:\*|_)(?![\w/])$/,
      (state, match, start, end) => {
        const tr = state.tr
        const captured = match[1]
        if (captured) {
          const textStart = start + match[0].indexOf(captured)
          const textEnd = textStart + captured.length
          if (textEnd < end) tr.delete(textEnd, end)
          if (textStart > start) tr.delete(start, textStart)
          const markFrom = start
          const markTo = markFrom + captured.length
          tr.addMark(markFrom, markTo, M.em!.create())
        }
        return tr
      },
    ))
  }

  // Inline code: `text`
  if (M.code) {
    rules.push(new InputRule(
      /(?:`)([^`]+)(?:`)$/,
      (state, match, start, end) => {
        const tr = state.tr
        const captured = match[1]
        if (captured) {
          // The closing backtick is the just-typed character and is NOT in the
          // document yet (ProseMirror InputRule contract). Only text up to `end`
          // exists. Use indexOf to locate the captured text within the match,
          // then delete surrounding delimiters that ARE in the document.
          const textStart = start + match[0].indexOf(captured)
          const textEnd = textStart + captured.length
          if (textEnd < end) tr.delete(textEnd, end)
          if (textStart > start) tr.delete(start, textStart)
          const markFrom = start
          const markTo = markFrom + captured.length
          tr.addMark(markFrom, markTo, M.code!.create())
        }
        return tr
      },
    ))
  }

  // Strikethrough: ~~text~~
  if (M.strike_through) {
    rules.push(new InputRule(
      /~~([^~]+)~~$/,
      (state, match, start, end) => {
        const tr = state.tr
        const captured = match[1]
        if (captured) {
          const textStart = start + match[0].indexOf(captured)
          const textEnd = textStart + captured.length
          if (textEnd < end) tr.delete(textEnd, end)
          if (textStart > start) tr.delete(start, textStart)
          const markFrom = start
          const markTo = markFrom + captured.length
          tr.addMark(markFrom, markTo, M.strike_through!.create())
        }
        return tr
      },
    ))
  }

  // Task list: [ ] or [x] at start of list item
  rules.push(new InputRule(
    /^\[(?<checked>\s|x)\]\s$/,
    (state, match, start, end) => {
      const pos = state.doc.resolve(start)
      let depth = 0
      let node: PmNode | null = pos.node(depth)
      while (node && node.type.name !== 'list_item') {
        depth--
        try { node = pos.node(depth) } catch { node = null }
      }
      if (!node || node.attrs.checked != null) return null
      const checked = Boolean(match.groups?.checked === 'x')
      const finPos = pos.before(depth)
      return state.tr.deleteRange(start, end).setNodeMarkup(finPos, undefined, {
        ...node.attrs,
        checked,
      })
    },
  ))

  // Link: [text](url) — typed in visual mode becomes a proper link mark.
  // This prevents the serializer from escaping brackets (issue: []() → \[\]()).
  if (M.link) {
    rules.push(new InputRule(
      /\[([^\]]+)\]\(([^)]+)\)$/,
      (state, match, start, end) => {
        const text = match[1]
        const url = match[2]
        if (!text || !url) return null
        const linkMark = M.link!.create({ href: url })
        return state.tr.replaceWith(start, end, schema.text(text, [linkMark]))
      },
    ))
  }

  // Definition list input rule (Tier 1)
  if (tier1.defListInputRule) {
    rules.push(tier1.defListInputRule)
  }

  return inputRules({ rules })
}

// ── Keymap ──────────────────────────────────────────────────────

function buildKeymap(schema: Schema): Plugin {
  const N = schema.nodes
  const M = schema.marks
  const listItemType = N.list_item

  const bindings: Record<string, import('prosemirror-state').Command> = {
    // History
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,

    // Marks
    ...(M.strong ? { 'Mod-b': toggleMark(M.strong) } : {}),
    ...(M.em ? { 'Mod-i': toggleMark(M.em) } : {}),
    ...(M.code ? { 'Mod-e': toggleMark(M.code) } : {}),
    ...(M.strike_through ? { 'Mod-Shift-x': toggleMark(M.strike_through) } : {}),
  }

  if (listItemType) {
    bindings['Enter'] = splitListItem(listItemType)
    bindings['Tab'] = (state, dispatch) => {
      // In a list → indent list item
      if (sinkListItem(listItemType)(state)) return sinkListItem(listItemType)(state, dispatch)
      // Otherwise → insert tab (4 spaces)
      if (dispatch) dispatch(state.tr.insertText('    '))
      return true
    }
    bindings['Mod-]'] = sinkListItem(listItemType)
    bindings['Shift-Tab'] = liftListItem(listItemType)
    bindings['Mod-['] = liftListItem(listItemType)
  }

  if (N.paragraph) bindings['Mod-Alt-0'] = setBlockType(N.paragraph)
  if (N.heading) {
    for (let level = 1; level <= 6; level++) {
      bindings[`Mod-Alt-${level}`] = setBlockType(N.heading, { level })
    }
  }
  if (N.code_block) bindings['Mod-Alt-c'] = setBlockType(N.code_block)
  if (N.blockquote) bindings['Mod-Shift-b'] = wrapIn(N.blockquote)

  // Select All: code block local select or whole-doc select
  bindings['Mod-a'] = (state, dispatch) => {
    const { $from } = state.selection
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'code_block') {
        if (dispatch) {
          dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(d), $from.end(d))))
        }
        return true
      }
    }
    if (dispatch) {
      dispatch(state.tr.setSelection(new AllSelection(state.doc)))
    }
    return true
  }

  // Hard break - explicitly set isInline to false for proper markdown serialization
  if (N.hardbreak) {
    bindings['Shift-Enter'] = (state, dispatch) => {
      if (dispatch) {
        dispatch(state.tr.replaceSelectionWith(N.hardbreak!.create({ isInline: false })).scrollIntoView())
      }
      return true
    }
  }

  // Backspace: protect block atom nodes (math_block, etc.) from deletion.
  //
  // WebKit contenteditable bug: when the caret is at the end of a textblock
  // adjacent to a contenteditable="false" block (atom node), the browser's
  // native Backspace deletes that block instead of the previous character.
  // All ProseMirror built-in handlers return false for this position, so
  // native behavior runs unchecked. We must handle it ourselves.
  bindings['Backspace'] = (state, dispatch) => {
    const sel = state.selection

    // Case 0: Fast AllSelection / full-range deletion.
    // ProseMirror's default AllSelection delete is very slow on large docs
    // (step-by-step replacement). Replace entire content with a single empty
    // paragraph in one transaction for instant deletion.
    {
      const docSize = state.doc.content.size
      const isAllSelected =
        sel instanceof AllSelection ||
        (docSize > 0 && sel.from <= 1 && sel.to >= docSize - 1)
      if (isAllSelected && dispatch) {
        const paragraphType = state.schema.nodes.paragraph
        if (!paragraphType) return false
        const emptyParagraph = paragraphType.create()
        const tr = state.tr.replaceWith(0, docSize, emptyParagraph)
        tr.setSelection(TextSelection.create(tr.doc, 1))
        tr.setMeta('full-delete', true)
        dispatch(tr)
        return true
      }
      if (isAllSelected) return true // no dispatch but still consumed
    }

    // Case 1: NodeSelection on a block atom (via arrow keys) — move cursor
    // to nearest previous text position instead of deleting the atom.
    if (sel instanceof NodeSelection && sel.node.isBlock && sel.node.type.spec.atom) {
      const before = Selection.findFrom(state.doc.resolve(sel.from), -1, true)
      if (before && dispatch) {
        dispatch(state.tr.setSelection(before).scrollIntoView())
      }
      return true
    }

    // Remaining cases need an empty TextSelection with a cursor
    if (!sel.empty || !(sel instanceof TextSelection)) return false
    const $cursor = sel.$cursor
    if (!$cursor) return false
    const { parent, parentOffset } = $cursor

    // Case 2: Cursor at END of a textblock, next sibling is a block atom.
    // Main WebKit bug fix: delete the previous character via ProseMirror
    // transaction instead of letting native Backspace run.
    if (parent.isTextblock && parentOffset === parent.content.size && parent.content.size > 0) {
      const afterPos = $cursor.after()
      if (afterPos < state.doc.content.size) {
        const nextNode = state.doc.resolve(afterPos).nodeAfter
        if (nextNode && nextNode.isBlock && nextNode.type.spec.atom) {
          if (dispatch) {
            const before = $cursor.nodeBefore
            if (before) {
              const delSize = before.isText ? 1 : before.nodeSize
              dispatch(state.tr.delete(sel.from - delSize, sel.from).scrollIntoView())
            }
          }
          return true
        }
      }
    }

    // Case 3: Cursor at START of a textblock, previous sibling is a block atom.
    if (parent.isTextblock && parentOffset === 0) {
      const beforePos = $cursor.before()
      if (beforePos > 0) {
        const prevNode = state.doc.resolve(beforePos).nodeBefore
        if (prevNode && prevNode.isBlock && prevNode.type.spec.atom) {
          const target = Selection.findFrom(
            state.doc.resolve(beforePos - prevNode.nodeSize), -1, true,
          )
          if (target && dispatch) {
            dispatch(state.tr.setSelection(target).scrollIntoView())
          }
          return true
        }
      }
    }

    // Case 4: End of paragraph after an inline atom — join forward
    if (parent.type.name === 'paragraph' && parentOffset === parent.content.size) {
      const nodeBeforeAtom = $cursor.nodeBefore
      if (nodeBeforeAtom && nodeBeforeAtom.isAtom) {
        const afterPos2 = $cursor.after()
        if (afterPos2 < state.doc.content.size) {
          const nextNode2 = state.doc.resolve(afterPos2).nodeAfter
          if (nextNode2 && nextNode2.isBlock) {
            return joinForward(state, dispatch)
          }
        }
      }
    }

    // Case 5: Cursor at END of a textblock — delete previous char explicitly.
    // WKWebView's Selection.modify("move","backward","character") can fail
    // at the end of a contenteditable block, causing endOfTextblock("backward")
    // to incorrectly return true. This makes baseKeymap's joinBackward merge
    // the current paragraph with the next one instead of deleting a character.
    if (parent.isTextblock && parentOffset === parent.content.size && parentOffset > 0) {
      if (dispatch) {
        const nb = $cursor.nodeBefore
        if (nb && nb.isText && nb.text) {
          // Handle surrogate pairs (emoji etc.)
          const code = nb.text.charCodeAt(nb.text.length - 1)
          const delLen = (code >= 0xDC00 && code <= 0xDFFF) ? 2 : 1
          dispatch(state.tr.delete(sel.from - delLen, sel.from).scrollIntoView())
        } else if (nb) {
          dispatch(state.tr.delete(sel.from - nb.nodeSize, sel.from).scrollIntoView())
        }
      }
      return true
    }

    return false
  }

  // Delete: protect block atom nodes from deletion.
  bindings['Delete'] = (state, dispatch) => {
    const sel = state.selection

    if (sel instanceof NodeSelection && sel.node.isBlock && sel.node.type.spec.atom) {
      const after = Selection.findFrom(state.doc.resolve(sel.to), 1, true)
      if (after && dispatch) {
        dispatch(state.tr.setSelection(after).scrollIntoView())
      }
      return true
    }

    if (sel.empty && sel instanceof TextSelection && sel.$cursor) {
      const $c = sel.$cursor
      if ($c.parent.isTextblock && $c.parentOffset === $c.parent.content.size) {
        const ap = $c.after()
        if (ap < state.doc.content.size) {
          const nn = state.doc.resolve(ap).nodeAfter
          if (nn && nn.isBlock && nn.type.spec.atom) {
            return true // consume — don't delete the atom
          }
        }
      }
    }

    return false
  }

  return keymap(bindings)
}

// ── Lazy/Dirty change plugins ───────────────────────────────────

/**
 * Lightweight dirty-tracking plugin: fires on every doc change with the
 * document's plain text content. No markdown serialization, no debounce —
 * runs in O(1) after each transaction.
 */
function createDirtyTrackPlugin(onDocChanged: (textContent: string) => void): Plugin {
  return new Plugin({
    key: new PluginKey('moraya-dirty-track'),
    view: () => ({
      update: (view, prevState) => {
        if (!prevState || view.state.doc.eq(prevState.doc)) return
        onDocChanged(view.state.doc.textContent)
      },
    }),
  })
}

/**
 * ProseMirror plugin that defers markdown serialization. Used in split mode
 * where a SourceEditor needs periodic markdown sync. Debounce default 500ms.
 */
function createLazyChangePlugin(onChange: (markdown: string) => void, debounceMs = 500): Plugin {
  let changeTimer: ReturnType<typeof setTimeout> | null = null

  return new Plugin({
    key: new PluginKey('moraya-lazy-change'),
    view: () => ({
      update: (view, prevState) => {
        if (!prevState || view.state.doc.eq(prevState.doc)) return

        if (changeTimer !== null) clearTimeout(changeTimer)
        changeTimer = setTimeout(() => {
          try {
            const markdown = serializeMarkdown(view.state.doc)
            onChange(markdown)
          } catch { /* editor might be destroyed */ }
          changeTimer = null
        }, debounceMs)
      },
      destroy: () => {
        if (changeTimer !== null) {
          clearTimeout(changeTimer)
          changeTimer = null
        }
      },
    }),
  })
}

// ── Public types ────────────────────────────────────────────────

export interface EditorPluginOptions {
  /** Render features */
  enableMath?: boolean              // default true (KaTeX in toDOM, no plugin)
  enableMermaid?: boolean           // default false; Moraya desktop = true (next batch)
  enableTableResize?: boolean       // default true (columnResizing)
  enableImageSelection?: boolean    // default true
  enableHistory?: boolean           // default true; v0.72 Yjs collab consumers set false

  /** Dependency injection (§3.3) */
  mediaResolver: MediaResolver           // required
  rendererRegistry?: RendererRegistry    // optional; default = highlight.js only
  linkOpener?: LinkOpener                // optional; default = window.open
  platform?: Platform                    // optional; default = navigator detection

  /** Change callbacks */
  onDocChanged?: (textContent: string) => void
  onChange?: (markdown: string) => void
  changeDebounceMs?: number              // default 500
}

export interface CreateEditorOptions extends EditorPluginOptions {
  container: HTMLElement
  initialContent?: string
  docCache?: DocCache
  onFocus?: () => void
  onBlur?: () => void
}

export interface MorayaEditorInstance {
  view: EditorView
  getMarkdown(): string
  setContent(md: string): void
  destroy(): void
}

const defaultPlatform = (): Platform => ({
  getCurrentFilePath: () => null,
  isMacOS:
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform ?? ''),
})

// ── Plugin assembly ─────────────────────────────────────────────

/**
 * Build the plugin array per v0.60.0-pre §4.1.
 *
 * Plugin order (with `key`s for fingerprint stability):
 *   1. listShortcutsPlugin (event.code list shortcuts; macOS Option-key safe)
 *   2. buildInputRules (must precede keymap)
 *   3. createEnterHandlerPlugin (must precede keymap so pipe-table / fence detection runs first)
 *   4. buildKeymap
 *   5. keymap(baseKeymap)
 *   6. history (skipped if enableHistory=false; for v0.72 Yjs)
 *   7. dropCursor
 *   8. columnResizing (table)
 *   9. createCursorSyntaxPlugin
 *  10. createLinkTextPlugin
 *  11. createInlineCodeConvertPlugin
 *  12. createImageSelectionPlugin
 *  13. change callback (lazy / dirty)
 *  14. Tier 1 highlight + emoji (lazy-loaded; appended to plugins array)
 *
 * NOTE: editor-props-plugin and code-block-view (RendererRegistry-coupled)
 * land in the next batch.
 */
export async function createEditorPlugins(
  opts: EditorPluginOptions,
  // Allow callers (e.g. createEditor) that already built a Schema to pass it
  // in to avoid double-construction. Defaults to a fresh schema from
  // createSchema(opts).
  schemaArg?: Schema,
): Promise<Plugin[]> {
  if (!opts.mediaResolver) {
    throw new TypeError(
      '@moraya/core: createEditorPlugins() requires a MediaResolver in opts.mediaResolver',
    )
  }

  const platform: Platform = opts.platform ?? defaultPlatform()
  void platform // used by editor-props-plugin in the next batch

  const schemaConfig: SchemaConfig = {
    mediaResolver: opts.mediaResolver,
    ...(opts.rendererRegistry ? { rendererRegistry: opts.rendererRegistry } : {}),
    ...(opts.linkOpener ? { linkOpener: opts.linkOpener } : {}),
  }
  const schema = schemaArg ?? createSchema(schemaConfig)
  const linkOpener: LinkOpener = opts.linkOpener ?? {
    open(url: string) {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    },
  }

  const tier1 = await preloadEnhancementPlugins(schema, opts.rendererRegistry)

  const plugins: Plugin[] = [
    // List shortcuts using event.code (reliable on macOS where Option+key
    // produces special chars). Must come before keymap so this handler has
    // highest priority.
    new Plugin({
      key: new PluginKey('moraya-list-shortcuts'),
      props: {
        handleKeyDown(view, event) {
          const mod = event.metaKey || event.ctrlKey
          if (!mod || !event.altKey || event.shiftKey) return false
          if (event.code === 'KeyO') return wrapInOrderedList(view.state, view.dispatch, view)
          if (event.code === 'KeyU') return wrapInBulletList(view.state, view.dispatch, view)
          if (event.code === 'KeyX') return wrapInTaskList(view.state, view.dispatch, view)
          return false
        },
      },
    }),

    // Input rules (must come before keymaps)
    buildInputRules(schema, tier1),

    // Custom Enter handler MUST come before keymaps so pipe-table and
    // code-fence detection run before baseKeymap's splitBlock intercepts Enter.
    createEnterHandlerPlugin(),

    // Keymaps
    buildKeymap(schema),
    keymap(baseKeymap),
  ]

  if (opts.enableHistory !== false) {
    plugins.push(history())
  }

  plugins.push(dropCursor())

  // Table column resizing (skip tableEditing — its drag-to-select behavior
  // hijacks native text selection inside tables, preventing users from
  // selecting text across multiple cells).
  if (opts.enableTableResize !== false) {
    plugins.push(columnResizing())
  }

  // Editor props (paste handlers, link click → LinkOpener, math click fix,
  // WKWebView caret + Backspace fixes, ArrowRight ZWSP escape)
  plugins.push(createEditorPropsPlugin({ platform, linkOpener }))

  // Custom plugins
  plugins.push(createCursorSyntaxPlugin())
  plugins.push(createLinkTextPlugin())
  plugins.push(createInlineCodeConvertPlugin())

  if (opts.enableImageSelection !== false) {
    plugins.push(createImageSelectionPlugin())
  }

  // Change detection
  if (opts.onChange) {
    plugins.push(createLazyChangePlugin(opts.onChange, opts.changeDebounceMs))
  } else if (opts.onDocChanged) {
    plugins.push(createDirtyTrackPlugin(opts.onDocChanged))
  }

  // Tier 1 enhancement plugins
  if (tier1.highlight) plugins.push(tier1.highlight)
  if (tier1.emoji) plugins.push(tier1.emoji)

  return plugins
}

// ── Public createEditor ─────────────────────────────────────────

/**
 * Create a full editor instance. Convenience wrapper that handles schema +
 * plugins + EditorState + EditorView wiring.
 */
export async function createEditor(opts: CreateEditorOptions): Promise<MorayaEditorInstance> {
  if (!opts.container) {
    throw new TypeError(
      '@moraya/core: createEditor() requires opts.container (HTMLElement)',
    )
  }
  if (!opts.mediaResolver) {
    throw new TypeError(
      '@moraya/core: createEditor() requires opts.mediaResolver',
    )
  }

  const schemaConfig: SchemaConfig = {
    mediaResolver: opts.mediaResolver,
    ...(opts.rendererRegistry ? { rendererRegistry: opts.rendererRegistry } : {}),
    ...(opts.linkOpener ? { linkOpener: opts.linkOpener } : {}),
  }
  const schema = createSchema(schemaConfig)
  const docCache = opts.docCache ?? createDocCache(10)
  void docCache // exposed for caller; not auto-applied at v0.1.0

  const plugins = await createEditorPlugins(opts, schema)

  // Tier 1 nodeViews: code_block replaced with toolbar+picker+mermaid+renderer NodeView.
  // We don't await preloadEnhancementPlugins again — createEditorPlugins already did.
  const tier1 = await preloadEnhancementPlugins(schema, opts.rendererRegistry)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeViews: Record<string, any> = {}
  if (tier1.codeBlockView) {
    nodeViews.code_block = tier1.codeBlockView
  }

  const initialDoc = opts.initialContent
    ? parseMarkdown(opts.initialContent, schema)
    : schema.topNodeType.createAndFill()!

  const state = EditorState.create({ schema, doc: initialDoc, plugins })
  const view = new EditorView(opts.container, {
    state,
    nodeViews,
    attributes: {
      class: 'moraya-editor',
      spellcheck: 'true',
    },
  })

  // Handle focus/blur events
  if (opts.onFocus || opts.onBlur) {
    const editorDom = opts.container.querySelector('.ProseMirror')
    if (editorDom) {
      if (opts.onFocus) editorDom.addEventListener('focus', opts.onFocus)
      if (opts.onBlur) editorDom.addEventListener('blur', opts.onBlur)
    }
  }

  return {
    view,
    getMarkdown() {
      return serializeMarkdown(view.state.doc)
    },
    setContent(md: string) {
      const newDoc = parseMarkdown(md, schema)
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content)
      view.dispatch(tr)
    },
    destroy() {
      view.destroy()
    },
  }
}
