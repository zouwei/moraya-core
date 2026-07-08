// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Markdown ↔ ProseMirror Doc roundtrip for `@moraya/core`.
 *
 * Faithful 1:1 migration from Moraya desktop `src/lib/editor/markdown.ts`.
 * Uses `prosemirror-markdown` with `markdown-it` as the tokenizer.
 *
 * Supports: CommonMark + GFM (tables, strikethrough, task lists) +
 *           math (via markdown-it-texmath) + definition lists +
 *           paired raw-HTML marks + frontmatter / footnote pass-through.
 *
 * Configuration matches Milkdown output conventions:
 *   - bullet: '-'
 *   - horizontal rule: '---'
 *   - strong: '**'
 *   - emphasis: '*'
 *
 * Serializer wraps `defaultSchema` (host-agnostic NullMediaResolver). The
 * schema's structural shape is identical to consumer-injected schemas
 * (same NodeSpec/MarkSpec ids), so a doc parsed against `defaultSchema`
 * round-trips through any consumer schema without rebuilding.
 */

import MarkdownIt from 'markdown-it'
import deflistPlugin from 'markdown-it-deflist'
import texmathPlugin from 'markdown-it-texmath'
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown'
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as PmNode, Mark, Schema } from 'prosemirror-model'
import { defaultSchema } from './schema'

// ── markdown-it instance ────────────────────────────────────────

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
})
  .enable(['table', 'strikethrough'])
  .use(deflistPlugin)
  .use(texmathPlugin)

// ── Paired HTML tag pre-processing ──────────────────────────────

interface InlineToken {
  type: string
  content: string
  children?: InlineToken[] | null
  meta?: Record<string, unknown> | null
  hidden?: boolean
  level?: number
  block?: boolean
  attrs?: unknown
  info?: string
  map?: [number, number] | null
  markup?: string
  tag?: string
  nesting?: number
  attrGet?: (name: string) => string | null
}

/**
 * Pre-scan inline tokens to identify paired HTML opening/closing tags.
 * Sets `meta.htmlPaired = true` on paired tokens so the parser converts
 * them to marks (styled rendering) instead of atom nodes (invisible).
 * Unpaired tags remain unmarked → atom nodes → exact roundtrip fidelity.
 */
function tagPairedHtmlInline(tokens: InlineToken[]): void {
  const VOID_RE = /^<(?:br|hr|img|input|wbr|area|base|col|embed|link|meta|param|source|track)[\s/>]/i
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.children) continue
    const children = token.children
    const stack: { tagName: string; index: number }[] = []
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (!child || child.type !== 'html_inline') continue
      const content: string = child.content
      // Skip void/self-closing elements and comments
      if (VOID_RE.test(content) || /\/>$/.test(content) || /^<!--/.test(content)) continue
      // Closing tag?
      const closeMatch = content.match(/^<\/([a-zA-Z][a-zA-Z0-9]*)\s*>$/)
      if (closeMatch && closeMatch[1]) {
        const tagName = closeMatch[1].toLowerCase()
        for (let j = stack.length - 1; j >= 0; j--) {
          const entry = stack[j]
          if (!entry) continue
          if (entry.tagName === tagName) {
            const opener = children[entry.index]
            if (opener) {
              opener.meta = { ...(opener.meta || {}), htmlPaired: true }
            }
            child.meta = { ...(child.meta || {}), htmlPaired: true }
            stack.splice(j, 1)
            break
          }
        }
        continue
      }
      // Opening tag?
      const openMatch = content.match(/^<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>$/)
      if (openMatch && openMatch[1]) {
        stack.push({ tagName: openMatch[1].toLowerCase(), index: i })
      }
    }
  }
}

/**
 * Detect extra blank lines between top-level blocks and inject empty paragraph
 * tokens so ProseMirror preserves them as empty <p> nodes.
 *
 * Standard Markdown collapses consecutive blank lines into one paragraph break.
 * This post-processor restores each extra blank line as an empty paragraph,
 * giving Typora-style round-trip fidelity for multi-Enter spacing.
 */
function preserveBlankLines(tokens: InlineToken[]): InlineToken[] {
  function mkToken(type: string, tag: string, nesting: number, extra?: Partial<InlineToken>): InlineToken {
    return {
      type, tag, nesting, content: '', children: null, attrs: null, info: '',
      meta: null, map: null, block: true, hidden: false, level: 0, markup: '',
      ...extra,
    }
  }

  const result: InlineToken[] = []
  let lastTopBlockEndLine = 0

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok) continue

    if (tok.map && tok.level === 0 && (tok.nesting === 1 || tok.nesting === 0)) {
      const startLine = tok.map[0] as number
      const gap = startLine - lastTopBlockEndLine

      if (gap > 1 && lastTopBlockEndLine > 0) {
        const extra = gap - 1
        for (let j = 0; j < extra; j++) {
          result.push(
            mkToken('paragraph_open', 'p', 1),
            mkToken('inline', '', 0, { level: 1, block: false, children: [] }),
            mkToken('paragraph_close', 'p', -1),
          )
        }
      }

      lastTopBlockEndLine = tok.map[1] as number
    }

    result.push(tok)
  }

  return result
}

// Patch md.parse to inject paired-tag pre-processing and blank-line preservation
// before prosemirror-markdown processes the tokens.
const _origMdParse = md.parse.bind(md)
md.parse = function (src: string, env: unknown) {
  let tokens = _origMdParse(src, env) as unknown as InlineToken[]
  tagPairedHtmlInline(tokens)
  tokens = preserveBlankLines(tokens)
  return tokens as unknown as ReturnType<typeof _origMdParse>
}

// ── Parser ──────────────────────────────────────────────────────

/**
 * Token-to-node mapping for prosemirror-markdown's MarkdownParser.
 * markdown-it token names → ProseMirror node/mark names from schema.ts
 */
const parserTokens: Record<string, import('prosemirror-markdown').ParseSpec> = {
  // ── Block tokens ──
  paragraph: { block: 'paragraph' },
  blockquote: { block: 'blockquote' },
  heading: {
    block: 'heading',
    getAttrs(token) {
      return { level: Number(token.tag.slice(1)) }
    },
  },
  hr: { node: 'horizontal_rule' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: {
    block: 'ordered_list',
    getAttrs(token) {
      return { order: Number(token.attrGet('start') || 1) }
    },
  },
  list_item: {
    block: 'list_item',
    getAttrs(_token, tokens, index) {
      // Check for task list checkbox in the first inline child.
      // The inline content starts with [x] or [ ]
      let checked: boolean | null = null
      for (let i = index + 1; i < tokens.length; i++) {
        const t = tokens[i]
        if (!t) continue
        if (t.type === 'inline' && t.content) {
          const match = t.content.match(/^\[( |x|X)\]\s?/)
          if (match) {
            checked = match[1] !== ' '
            // Strip the checkbox text from the token content
            t.content = t.content.slice(match[0].length)
            // Also update children if they exist
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const children = (t as any).children
            if (children && children.length > 0) {
              const firstChild = children[0]
              if (firstChild.type === 'text') {
                firstChild.content = firstChild.content.slice(match[0].length)
                if (!firstChild.content) {
                  children.shift()
                }
              }
            }
          }
          break
        }
        if (t.type === 'list_item_close') break
      }
      return { checked }
    },
  },
  code_block: {
    block: 'code_block',
    getAttrs() {
      return { language: 'text' }
    },
    noCloseToken: true,
  },
  fence: {
    block: 'code_block',
    getAttrs(token) {
      return { language: token.info.trim() || 'text' }
    },
    noCloseToken: true,
  },
  html_block: {
    block: 'html_block',
    noCloseToken: true,
  },
  html_inline: {
    // markdown-it emits this token for inline HTML like <br>, <span>, <sup>,
    // and HTML comments <!-- ... -->. Store raw HTML in the `value` attr.
    node: 'html_inline',
    noCloseToken: true,
    getAttrs(token) {
      return { value: token.content }
    },
  },

  // ── Table tokens ──
  // NOTE: tr/th/td are NOT listed here — they are handled by custom tokenHandler
  // overrides in MorayaMarkdownParser below. The `block:` spec alone can't
  // handle (a) thead-row → table_header_row vs table_row dispatch, or
  // (b) wrapping inline content in the required paragraph child of each cell.
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },

  // ── Definition list tokens ──
  dl: { block: 'defList' },
  dt: { block: 'defListTerm' },
  dd: { block: 'defListDescription' },

  // ── Math tokens (from markdown-it-texmath) ──
  // Use block: spec (not node:) so token.content is added as text children,
  // correctly filling math_inline's `content: 'text*'`.
  math_inline: {
    block: 'math_inline',
    noCloseToken: true,
  },
  // markdown-it-texmath emits math_inline_double for $$...$$ in inline context.
  // Map to math_inline to prevent "Token type not supported" crash.
  math_inline_double: {
    block: 'math_inline',
    noCloseToken: true,
  },
  math_block: {
    node: 'math_block',
    noCloseToken: true,
    getAttrs(token) {
      return { value: token.content.trim() }
    },
  },

  // ── Inline tokens ──
  image: {
    node: 'image',
    getAttrs(token) {
      // markdown-it URL-encodes backslashes in paths (\ → %5C),
      // which breaks Windows local paths on roundtrip.
      // Decode to preserve the original path.
      let src = token.attrGet('src') || ''
      try { src = decodeURIComponent(src) } catch { /* keep as-is */ }
      return {
        src,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        alt: ((token.children as any[]) || []).map(c => c.content).join('') || '',
        title: token.attrGet('title') || '',
      }
    },
  },
  hardbreak: { node: 'hardbreak' },
  softbreak: { node: 'hardbreak', attrs: { isInline: true } },

  // ── Mark tokens ──
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike_through' },
  code_inline: { mark: 'code', noCloseToken: true },
  link: {
    mark: 'link',
    getAttrs(token) {
      let href = token.attrGet('href') || ''
      // Decode percent-encoded non-ASCII UTF-8 characters (e.g. Chinese/Japanese/Korean)
      // so URLs preserve original characters through roundtrips.
      // Only decodes multi-byte UTF-8 sequences (C2-FF start bytes + 80-BF continuations),
      // leaving ASCII encodings like %20 (space), %28/%29 (parens) intact.
      href = href.replace(
        /%[C-F][0-9A-F](?:%[89AB][0-9A-F])+/gi,
        (m) => { try { return decodeURIComponent(m) } catch { return m } },
      )
      return {
        href,
        title: token.attrGet('title') || null,
      }
    },
  },
}

/**
 * Custom MarkdownParser that correctly handles GFM table structure.
 *
 * Two problems with the default prosemirror-markdown `block:` approach for tables:
 *
 * 1. `table_header` and `table_cell` both have `content: 'paragraph+'` in our schema.
 *    prosemirror-markdown opens the cell block, then adds raw inline text via addText().
 *    When closeNode() calls createAndFill(attrs, [text("A")]), the content match
 *    for `paragraph+` cannot fit a bare text node, so createAndFill() returns null
 *    and the cell (and all its content) is silently dropped → empty table.
 *
 * 2. `table: content: 'table_header_row table_row+'` requires the first child to be
 *    a `table_header_row`, but the default `tr` handler always creates `table_row`.
 *    ProseMirror's createAndFill() then auto-inserts an empty `table_header_row`
 *    at the front, leaving the real header data in a wrongly-typed `table_row`.
 *
 * Fix: override tr/th/td tokenHandlers in the constructor.
 */
class MorayaMarkdownParser extends MarkdownParser {
  /**
   * The schema this parser instance is bound to. Captured for use in
   * tokenHandler overrides (tr_open / th_open / etc.) so they reference the
   * caller-provided schema rather than the module-level defaultSchema.
   */
  public readonly schema: Schema

  constructor(schemaArg: Schema = defaultSchema) {
    super(schemaArg, md, parserTokens)
    this.schema = schemaArg

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h: Record<string, (state: any, tok: any, tokens: any[], i: number) => void> =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).tokenHandlers

    function cellAlignment(tok: { attrGet(s: string): string | null }): string {
      const style = tok.attrGet('style') || ''
      const m = style.match(/text-align:\s*(\w+)/)
      return m && m[1] ? m[1] : 'left'
    }

    // tr_open: dispatch to table_header_row or table_row based on parent context
    h['tr_open'] = (state, _tok, tokens, i) => {
      let inThead = false
      for (let j = i - 1; j >= 0; j--) {
        if (tokens[j].type === 'thead_open') { inThead = true; break }
        if (tokens[j].type === 'thead_close' || tokens[j].type === 'tbody_open') break
      }
      state.openNode(inThead ? schemaArg.nodes.table_header_row : schemaArg.nodes.table_row, null)
    }
    h['tr_close'] = (state) => state.closeNode()

    // th_open/close: open table_header + inner paragraph so inline text lands correctly
    h['th_open'] = (state, tok) => {
      state.openNode(schemaArg.nodes.table_header, { alignment: cellAlignment(tok) })
      state.openNode(schemaArg.nodes.paragraph, null)
    }
    h['th_close'] = (state) => {
      state.closeNode() // close paragraph
      state.closeNode() // close table_header
    }

    // td_open/close: open table_cell + inner paragraph
    h['td_open'] = (state, tok) => {
      state.openNode(schemaArg.nodes.table_cell, { alignment: cellAlignment(tok) })
      state.openNode(schemaArg.nodes.paragraph, null)
    }
    h['td_close'] = (state) => {
      state.closeNode() // close paragraph
      state.closeNode() // close table_cell
    }

    // ── Empty link preservation ────────────────────────────────────
    // When markdown-it parses `[]()` or `[](url)`, it emits link_open → link_close
    // with no text token between them. ProseMirror discards marks with no content,
    // so the link completely disappears. Fix: detect empty-text links and insert
    // the raw markdown syntax as literal text instead of creating a mark.
    const defaultLinkOpen = h['link_open']
    const defaultLinkClose = h['link_close']

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h['link_open'] = (state: any, tok: any, tokens: any[], i: number) => {
      // Check if there's actual content between link_open and link_close
      let hasContent = false
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'link_close') break
        if (tokens[j].type === 'text' && tokens[j].content) {
          hasContent = true
          break
        }
        if (['image', 'code_inline', 'softbreak', 'hardbreak', 'html_inline'].includes(tokens[j].type)) {
          hasContent = true
          break
        }
      }

      if (!hasContent) {
        // Empty-text link: insert raw markdown syntax as literal text
        let href = tok.attrGet('href') || ''
        href = href.replace(
          /%[C-F][0-9A-F](?:%[89AB][0-9A-F])+/gi,
          (m: string) => { try { return decodeURIComponent(m) } catch { return m } },
        )
        const title = tok.attrGet('title')
        let literal = `[](${href}`
        if (title) literal += ` "${title}"`
        literal += ')'
        state.addText(literal)
        // Mark the corresponding link_close to be skipped
        for (let j = i + 1; j < tokens.length; j++) {
          if (tokens[j].type === 'link_close') {
            tokens[j].meta = { ...(tokens[j].meta || {}), skipClose: true }
            break
          }
        }
        return
      }

      defaultLinkOpen!(state, tok, tokens, i)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h['link_close'] = (state: any, tok: any, tokens: any[], i: number) => {
      if (tok.meta?.skipClose) return
      defaultLinkClose!(state, tok, tokens, i)
    }

    // ── Paired inline HTML → marks ─────────────────────────────────
    // Pre-scanned paired tags (meta.htmlPaired) become openMark/closeMark
    // so the visual editor renders them with styling. Unpaired tags stay
    // as html_inline atom nodes for exact roundtrip fidelity.
    //
    // Special case: <audio>/<video> inline tags (single-line, e.g.
    // `<audio src="..." controls></audio>`) are combined into a single
    // html_inline atom node so toDOM renders them as media players.
    const defaultTextHandler = h['text']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h['text'] = (state: any, tok: any, toks: any[], ii: number) => {
      if (tok.meta?.mediaSkip) return
      defaultTextHandler!(state, tok, toks, ii)
    }

    h['html_inline'] = (state, tok, tokens, i) => {
      // Skip tokens already consumed by audio/video combination
      if (tok.meta?.mediaSkip) return

      const content: string = tok.content

      // <audio>/<video> inline: combine opening + closing into single atom.
      const mediaMatch = content.match(/^<(audio|video)\b/i)
      if (mediaMatch && mediaMatch[1]) {
        const tagName = mediaMatch[1].toLowerCase()
        const closeRe = new RegExp(`^</${tagName}\\s*>$`, 'i')
        let fullHtml = content
        for (let j = i + 1; j < tokens.length; j++) {
          const t = tokens[j]
          if (t.type === 'html_inline' && closeRe.test(t.content.trim())) {
            fullHtml += t.content
            t.meta = { ...(t.meta || {}), mediaSkip: true }
            break
          }
          if (t.content) fullHtml += t.content
          t.meta = { ...(t.meta || {}), mediaSkip: true }
        }
        state.addNode(schemaArg.nodes.html_inline, { value: fullHtml })
        return
      }

      if (tok.meta?.htmlPaired) {
        const htmlMark = schemaArg.marks.html_mark
        if (!htmlMark) {
          // Schema lacks html_mark — fall through to atom-node fallback
          state.addNode(schemaArg.nodes.html_inline, { value: content })
          return
        }
        if (!content.startsWith('</')) {
          // Opening tag → open mark
          const tagMatch = content.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)
          const tagName = tagMatch && tagMatch[1] ? tagMatch[1].toLowerCase() : ''
          state.openMark(htmlMark.create({
            openTag: content,
            closeTag: `</${tagName}>`,
          }))
        } else {
          // Closing tag → close mark
          state.closeMark(htmlMark)
        }
        return
      }
      // Not paired → atom node (preserves current behavior)
      state.addNode(schemaArg.nodes.html_inline, { value: content })
    }

    // ── HTML <img> / <video> / <audio> tag: block → inline promotion ──
    // markdown-it tokenizes standalone <img> as html_block (renders as code block).
    // Promote to paragraph(html_inline) so the toDOM can render it as an image.
    // Source format is preserved: html_inline serializes attrs.value (original HTML).
    const defaultHtmlBlock = h['html_block']
    h['html_block'] = (state, tok, tokens, i) => {
      const content = tok.content.trim()
      if (/^<img\s/i.test(content)) {
        // Extract all <img> tags — put them in ONE paragraph with inline
        // hardbreaks between them, matching markdown image behavior.
        const imgPattern = /<img\s[^>]*\/?>/gi
        const imgs = content.match(imgPattern)
        state.openNode(schemaArg.nodes.paragraph, null)
        if (imgs && imgs.length > 0) {
          for (let j = 0; j < imgs.length; j++) {
            if (j > 0) {
              state.addNode(schemaArg.nodes.hardbreak, { isInline: true })
            }
            state.addNode(schemaArg.nodes.html_inline, { value: imgs[j] })
          }
        } else {
          state.addNode(schemaArg.nodes.html_inline, { value: content })
        }
        state.closeNode()
      } else if (/^<(video|audio)\b/i.test(content)) {
        // Promote <video>/<audio> blocks to paragraph(html_inline) so toDOM
        // renders them as actual media players instead of code blocks.
        state.openNode(schemaArg.nodes.paragraph, null)
        state.addNode(schemaArg.nodes.html_inline, { value: content })
        state.closeNode()
      } else {
        defaultHtmlBlock!(state, tok, tokens, i)
      }
    }
  }
}

/** Default parser bound to {@link defaultSchema} (used when caller doesn't pass a schema). */
const defaultParser = new MorayaMarkdownParser(defaultSchema)

/**
 * Cache of parsers keyed by schema identity. Rebuilding the parser per call
 * would re-construct token handlers + retype-overrides on every parseMarkdown
 * invocation; this WeakMap avoids that. The defaultSchema entry is pre-seeded.
 */
const parserCache = new WeakMap<Schema, MorayaMarkdownParser>()
parserCache.set(defaultSchema, defaultParser)

function getParserFor(schema: Schema | undefined): MorayaMarkdownParser {
  if (!schema || schema === defaultSchema) return defaultParser
  let p = parserCache.get(schema)
  if (!p) {
    p = new MorayaMarkdownParser(schema)
    parserCache.set(schema, p)
  }
  return p
}

// ── Serializer ──────────────────────────────────────────────────

const serializer = new MarkdownSerializer(
  {
    // ── Block nodes ──
    doc(state, node) {
      state.renderContent(node)
    },
    paragraph(state, node) {
      if (node.content.size === 0) {
        state.write('')
      } else {
        state.renderInline(node)
      }
      state.closeBlock(node)
    },
    heading(state, node) {
      state.write(`${'#'.repeat(node.attrs.level as number)} `)
      // fromBlockStart=false: the `## ` prefix already prevents text from being
      // parsed as list markers / blockquote, so don't escape `1.`, `-`, `>` etc.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(state.renderInline as (n: PmNode, b?: boolean) => void)(node, false)
      state.closeBlock(node)
    },
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node))
    },
    code_block(state, node) {
      const lang = (node.attrs.language as string) || ''
      const fenceLang = lang === 'text' ? '' : lang
      state.write(`\`\`\`${fenceLang}\n`)
      state.text(node.textContent, false)
      state.ensureNewLine()
      state.write('```')
      state.closeBlock(node)
    },
    horizontal_rule(state, node) {
      state.write('---')
      state.closeBlock(node)
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ')
    },
    ordered_list(state, node) {
      const start = (node.attrs.order as number) || 1
      state.renderList(node, '   ', (i: number) => `${start + i}. `)
    },
    list_item(state, node) {
      // Task list checkbox prefix
      if (node.attrs.checked != null) {
        const checkbox = node.attrs.checked ? '[x] ' : '[ ] '
        state.write(checkbox)
      }
      state.renderContent(node)
    },
    image(state, node) {
      const alt = state.esc((node.attrs.alt as string) || '', false)
      const src = (node.attrs.src as string) || ''
      const title = node.attrs.title as string | null | undefined
      if (title) {
        state.write(`![${alt}](${src} "${state.esc(title, false)}")`)
      } else {
        state.write(`![${alt}](${src})`)
      }
    },
    hardbreak(state) {
      // Always use markdown hardbreak format (two spaces + newline)
      // for consistent parsing and roundtrip fidelity
      state.write('  \n')
    },
    html_block(state, node) {
      state.text(node.textContent, false)
      state.closeBlock(node)
    },
    html_inline(state, node) {
      // Write the raw HTML back verbatim (no escaping); value attr holds the original HTML.
      state.text(node.attrs.value as string, false)
    },

    // ── Table nodes ──
    table(state, node) {
      // Collect alignment from header row
      const alignments: string[] = []
      const headerRow = node.child(0)
      headerRow.forEach(cell => {
        alignments.push((cell.attrs.alignment as string) || 'left')
      })

      // Render header row
      renderTableRow(state, headerRow)

      // Render separator
      const sep = alignments.map(a => {
        switch (a) {
          case 'center': return ':---:'
          case 'right': return '---:'
          default: return '---'
        }
      })
      state.write(`| ${sep.join(' | ')} |`)
      state.ensureNewLine()

      // Render data rows
      for (let i = 1; i < node.childCount; i++) {
        renderTableRow(state, node.child(i))
      }
      state.closeBlock(node)
    },
    table_header_row() { /* handled by table */ },
    table_row() { /* handled by table */ },
    table_header(state, node) {
      state.renderInline(node.firstChild!)
    },
    table_cell(state, node) {
      state.renderInline(node.firstChild!)
    },

    // ── Math nodes ──
    math_inline(state, node) {
      state.write(`$${node.textContent}$`)
    },
    math_block(state, node) {
      state.write('$$\n')
      state.text((node.attrs.value as string) || node.textContent, false)
      state.ensureNewLine()
      state.write('$$')
      state.closeBlock(node)
    },

    // ── Definition list nodes ──
    defList(state, node) {
      state.renderContent(node)
    },
    defListTerm(state, node) {
      state.renderInline(node)
      state.closeBlock(node)
    },
    defListDescription(state, node) {
      state.write(':   ')
      state.renderContent(node)
    },

    // ── Fallback for text node (shouldn't be needed but safe) ──
    text(state, node) {
      state.text(node.text || '')
    },
  },
  {
    // ── Mark serializers ──
    strong: {
      open: '**',
      close: '**',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    em: {
      open: '*',
      close: '*',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    code: {
      open(_state: MarkdownSerializerState, mark: Mark, parent: PmNode, index: number) {
        return isPlainURL(mark, parent, index, 1) ? '' : '`'
      },
      close(_state: MarkdownSerializerState, mark: Mark, parent: PmNode, index: number) {
        return isPlainURL(mark, parent, index, -1) ? '' : '`'
      },
      escape: false,
    },
    link: {
      open(_state, mark, parent, index) {
        return isPlainURL(mark, parent, index, 1) ? '<' : '['
      },
      close(state, mark, parent, index) {
        const href = mark.attrs.href as string
        const title = mark.attrs.title as string | null | undefined
        if (isPlainURL(mark, parent, index, -1)) {
          return '>'
        }
        return title
          ? `](${href} "${state.esc(title, false)}")`
          : `](${href})`
      },
      mixable: false,
    },
    strike_through: {
      open: '~~',
      close: '~~',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    html_mark: {
      open(_state: MarkdownSerializerState, mark: Mark) {
        return mark.attrs.openTag as string
      },
      close(_state: MarkdownSerializerState, mark: Mark) {
        return mark.attrs.closeTag as string
      },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ({
    hardBreakNodeName: 'hardbreak',
    strict: false,
  } as any),
)

/**
 * Helper: render a table row as `| cell1 | cell2 | ... |`
 *
 * Uses ProseMirror's built-in renderInline via output-buffer capture so that
 * ALL inline content (text, marks, hard breaks, math, images, etc.) is
 * serialized correctly — the same path used for headings and paragraphs.
 */
function renderTableRow(state: MarkdownSerializerState, row: PmNode) {
  const cells: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = state as any
  row.forEach(cell => {
    // Cells with 'paragraph+' content: each paragraph is one "line" in the cell.
    // GFM cells are single-line, so join multiple paragraphs with a space.
    const parts: string[] = []
    cell.forEach(para => {
      if (para.type.name !== 'paragraph') return
      // Capture renderInline output by swapping the serializer's output buffer.
      //
      // IMPORTANT: prosemirror-markdown's text() calls write() for every line,
      // and write() calls flushClose() which resets this.closed. We must save
      // and restore BOTH out AND closed so the pending block-separator (the
      // blank line between the preceding paragraph and this table) is not
      // accidentally consumed here — it must survive until state.write('| … |')
      // fires at the end of this function, where flushClose() will emit it.
      const savedOut: string = s.out
      const savedClosed = s.closed
      s.out = ''
      s.closed = null
      state.renderInline(para)
      const piece: string = (s.out as string).replace(/\n/g, ' ').trim()
      s.out = savedOut
      s.closed = savedClosed
      parts.push(piece)
    })
    cells.push(parts.join(' '))
  })
  state.write(`| ${cells.join(' | ')} |`)
  state.ensureNewLine()
}

/**
 * Check if a link mark represents a plain URL (autolink style).
 * If so, serialize as `<url>` instead of `[text](url)`.
 */
function isPlainURL(mark: Mark, parent: PmNode, index: number, side: number): boolean {
  if (mark.attrs.title || !/^\w+:/.test(mark.attrs.href as string)) return false
  const content = parent.child(index + (side < 0 ? -1 : 0))
  if (
    !content.isText ||
    content.text !== mark.attrs.href ||
    content.marks[content.marks.length - 1] !== mark
  ) {
    return false
  }
  if (index === (side < 0 ? 1 : parent.childCount - 1)) return true
  const next = parent.child(index + (side < 0 ? -2 : 1))
  return !mark.isInSet(next.marks)
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Ensure display math blocks ($$…$$) are surrounded by blank lines so
 * markdown-it-texmath parses them as math_block, not math_inline_double.
 * Without blank lines, they get absorbed into the preceding paragraph as
 * inline tokens, causing wrong rendering and roundtrip corruption.
 */
function normalizeMathBlocks(text: string): string {
  if (!text.includes('$$')) return text

  const lines = text.split('\n')
  const result: string[] = []
  let inFence = false
  let inMathBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    // Skip fenced code blocks
    if (!inMathBlock && /^(`{3,}|~{3,})/.test(trimmed)) {
      inFence = !inFence
      result.push(line)
      continue
    }
    if (inFence) {
      result.push(line)
      continue
    }

    if (trimmed === '$$') {
      if (!inMathBlock) {
        // Opening $$: ensure blank line before
        const last = result[result.length - 1]
        if (result.length > 0 && last !== undefined && last.trim() !== '') {
          result.push('')
        }
        result.push(line)
        inMathBlock = true
      } else {
        // Closing $$
        result.push(line)
        inMathBlock = false
        // Ensure blank line after if next line is non-empty
        const next = lines[i + 1]
        if (next !== undefined && next.trim() !== '') {
          result.push('')
        }
      }
    } else {
      result.push(line)
    }
  }

  return result.join('\n')
}

/**
 * Normalize smart/curly quotes to straight quotes in markdown syntax positions.
 * Only targets image/link title delimiters to preserve intentional smart quotes in prose.
 * Pattern: `](url "title")` or `](url 'title')` with curly quotes.
 */
function normalizeSmartQuotes(text: string): string {
  // Quick bail: no curly quotes at all
  if (!/[“”„‟‘’‚‛]/.test(text)) return text

  return text
    .replace(
      /(\]\([^\n)]*\s)“([^”\n]*)”(\s*\))/g,
      (_m, pre, title, post) => `${pre}"${title}"${post}`,
    )
    .replace(
      /(\]\([^\n)]*\s)“([^”\n]*)”(\s*\))/g,
      (_m, pre, title, post) => `${pre}"${title}"${post}`,
    )
    // Also handle single curly quotes as title delimiters
    .replace(
      /(\]\([^\n)]*\s)‘([^’\n]*)’(\s*\))/g,
      (_m, pre, title, post) => `${pre}'${title}'${post}`,
    )
}

/**
 * Parse a markdown string into a ProseMirror document node. Never throws (§4.5).
 *
 * @param markdown   Source markdown string (may contain frontmatter, math, html, etc.).
 * @param schemaArg  Optional consumer schema. When provided, the returned doc's
 *                   `node.type` references the consumer's NodeType identities,
 *                   allowing it to be loaded directly into an `EditorState.create`
 *                   built with that same schema. Defaults to {@link defaultSchema}.
 */
export function parseMarkdown(markdown: string, schemaArg?: Schema): PmNode {
  const p = getParserFor(schemaArg)
  try {
    return p.parse(normalizeSmartQuotes(normalizeMathBlocks(markdown)))
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[parseMarkdown] best-effort fallback for malformed input:', err)
    }
    return p.schema.topNodeType.createAndFill()!
  }
}

const ASYNC_PARSE_THRESHOLD = 50_000

/**
 * Async version of parseMarkdown. For large files (≥50KB), yields to the
 * event loop via setTimeout(0) so the main thread stays responsive.
 * §4.5: never rejects.
 */
export function parseMarkdownAsync(markdown: string, schemaArg?: Schema): Promise<PmNode> {
  const p = getParserFor(schemaArg)
  const normalized = normalizeSmartQuotes(normalizeMathBlocks(markdown))
  // Small-doc path delegates to parseMarkdown(), which already has its own
  // internal try/catch + best-effort empty-doc fallback — nothing further
  // to guard here.
  if (normalized.length < ASYNC_PARSE_THRESHOLD) {
    return Promise.resolve(parseMarkdown(normalized, schemaArg))
  }
  return new Promise(resolve => setTimeout(() => {
    try {
      resolve(p.parse(normalized))
    } catch (err) {
      console.warn('[parseMarkdownAsync] best-effort fallback for malformed input:', err)
      resolve(p.schema.topNodeType.createAndFill()!)
    }
  }, 0))
}

/**
 * Serialize a ProseMirror document node to a markdown string. Never throws (§4.5).
 */
export function serializeMarkdown(doc: PmNode): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result = serializer.serialize(doc, ({ tightLists: true } as any))
  // Un-escape markdown link syntax that the serializer's esc() over-escapes.
  result = result.replace(/\\\[([^\\\[\]]*)\\\]\(([^)]*)\)/g, '[$1]($2)')
  // Strip zero-width spaces used as cursor targets after inline code marks.
  result = result.replace(/​/g, '')
  return result
}
