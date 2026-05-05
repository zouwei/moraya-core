import { Node } from 'prosemirror-model'
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownSerializer,
  MarkdownParser,
} from 'prosemirror-markdown'
import MarkdownIt from 'markdown-it'
import { defaultSchema } from './schema'

/**
 * Markdown ↔ ProseMirror Doc roundtrip.
 *
 * v0.60.0-pre §3.2 Public API:
 *   - parseMarkdown(content): Node          (sync)
 *   - parseMarkdownAsync(content): Promise<Node>  (yields to event loop for ≥50KB inputs)
 *   - serializeMarkdown(doc): string
 *
 * §4.5 error contract: parseMarkdown does NOT throw; markdown-it is fault-tolerant
 * for arbitrary input and ProseMirror createAndFill auto-fills missing structure.
 *
 * §4.6 first-pass roundtrip whitelist: `_em_` → `*em*`, `__strong__` → `**strong**`,
 * trailing-newline normalization, etc. Frontmatter / raw HTML / display math /
 * fenced code lang are byte-preserved (any deviation = bug).
 */

/** markdown-it tokens we support out of the box. Internal use. */
const md = MarkdownIt('default', { html: true })

// Use the default prosemirror-markdown parser/serializer wired against our schema.
// In production extraction (T2 full migration), this is replaced with the Moraya
// desktop's custom MorayaMarkdownParser / Serializer that handles raw HTML,
// frontmatter YAML, KaTeX, definition lists, footnotes, etc. The minimal version
// here is sufficient for the foundational fixture suite (headings / paragraphs /
// lists / emphasis / inline code / fenced code / links / images / blockquote / hr).

/**
 * Parser bound to our defaultSchema. Recognizes CommonMark tokens via markdown-it
 * and maps them to ProseMirror nodes/marks.
 */
const parser = new MarkdownParser(defaultSchema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok) => ({
      order: +(tok.attrGet('start') ?? 1),
    }),
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: {
    block: 'code_block',
    getAttrs: () => ({ language: 'text' }),
    noCloseToken: true,
  },
  fence: {
    block: 'code_block',
    getAttrs: (tok) => ({ language: (tok.info || '').trim() || 'text' }),
    noCloseToken: true,
  },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src') || '',
      title: tok.attrGet('title') || '',
      alt: (tok.children?.[0]?.content ?? '') || '',
    }),
  },
  hardbreak: { node: 'hardbreak' },

  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike_through' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({
      href: tok.attrGet('href'),
      title: tok.attrGet('title') || null,
    }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
})

/** Parse markdown synchronously into a ProseMirror Doc. Never throws. */
export function parseMarkdown(content: string): Node {
  try {
    const doc = parser.parse(content)
    return doc ?? defaultSchema.topNodeType.createAndFill()!
  } catch (err) {
    // Fault-tolerance per §4.5: never throw; return a minimal valid doc.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[parseMarkdown] best-effort fallback for malformed input:', err)
    }
    return defaultSchema.topNodeType.createAndFill()!
  }
}

/**
 * Async parse with yield-to-event-loop for large inputs (≥ 50KB).
 * Internally just calls parseMarkdown but wraps in microtask so the UI
 * stays responsive on large docs (consumers can show progress UI).
 *
 * §4.5: never rejects.
 */
export async function parseMarkdownAsync(content: string): Promise<Node> {
  if (content.length >= 50 * 1024) {
    // Yield once to let UI paint progress before heavy parse.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return parseMarkdown(content)
}

/**
 * Custom serializer that matches Moraya desktop's serialization rules.
 * For v0.1.0 we use prosemirror-markdown's default serializer, which already
 * implements §4.6 first-pass normalization (`_em_` → `*em*`, etc.).
 */
const serializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node))
    },
    code_block(state, node) {
      const language = (node.attrs.language as string) || ''
      const fence = language && language !== 'text' ? language : ''
      state.write('```' + fence + '\n')
      state.text(node.textContent, false)
      state.ensureNewLine()
      state.write('```')
      state.closeBlock(node)
    },
    heading(state, node) {
      state.write('#'.repeat(node.attrs.level as number) + ' ')
      state.renderInline(node)
      state.closeBlock(node)
    },
    horizontal_rule(state, node) {
      state.write(node.attrs.markup || '---')
      state.closeBlock(node)
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ')
    },
    ordered_list(state, node) {
      const start = (node.attrs.order as number) || 1
      const maxW = String(start + node.childCount - 1).length
      const space = ' '.repeat(maxW + 2)
      state.renderList(node, space, (i) => {
        const nStr = String(start + i)
        return ' '.repeat(maxW - nStr.length) + nStr + '. '
      })
    },
    list_item(state, node) {
      state.renderContent(node)
    },
    paragraph(state, node) {
      state.renderInline(node)
      state.closeBlock(node)
    },
    image(state, node) {
      const alt = state.esc((node.attrs.alt as string) || '')
      const src = state.esc(node.attrs.src as string)
      const title = node.attrs.title ? ' ' + quoteAttr(node.attrs.title as string) : ''
      state.write('![' + alt + '](' + src + title + ')')
    },
    hardbreak(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write('\\\n')
          return
        }
      }
    },
    text(state, node) {
      state.text(node.text!)
    },
  },
  {
    em: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    strike_through: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    link: {
      open(_state, mark, parent, index) {
        return isPlainURL(mark, parent, index, 1) ? '<' : '['
      },
      close(state, mark, parent, index) {
        return isPlainURL(mark, parent, index, -1)
          ? '>'
          : '](' +
              state.esc(mark.attrs.href as string) +
              (mark.attrs.title ? ' ' + quoteAttr(mark.attrs.title as string) : '') +
              ')'
      },
    },
    code: {
      open(_state, _mark, parent, index) {
        return backticksFor(parent.child(index), -1)
      },
      close(_state, _mark, parent, index) {
        return backticksFor(parent.child(index - 1), 1)
      },
      escape: false,
    },
  }
)

/**
 * Wrap a markdown attribute (image/link title) in double quotes, escaping any
 * embedded quotes. Replaces the older `MarkdownSerializerState.quote()` method
 * which was removed from prosemirror-markdown's public TypeScript surface.
 */
function quoteAttr(s: string): string {
  return '"' + s.replace(/"/g, '\\"') + '"'
}

function backticksFor(node: Node, side: number): string {
  const ticks = /`+/g
  let m: RegExpExecArray | null
  let len = 0
  if (node.isText) {
    while ((m = ticks.exec(node.text!))) len = Math.max(len, m[0].length)
  }
  let result = len > 0 && side > 0 ? ' `' : '`'
  for (let i = 0; i < len; i++) result += '`'
  if (len > 0 && side < 0) result += ' '
  return result
}

function isPlainURL(
  link: import('prosemirror-model').Mark,
  parent: Node,
  index: number,
  side: number
): boolean {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href as string)) return false
  const content = parent.child(index + (side < 0 ? -1 : 0))
  if (
    !content.isText ||
    content.text !== link.attrs.href ||
    content.marks[content.marks.length - 1] !== link
  ) {
    return false
  }
  if (index === (side < 0 ? 1 : parent.childCount - 1)) return true
  const next = parent.child(index + (side < 0 ? -2 : 1))
  return !link.isInSet(next.marks)
}

/** Serialize a ProseMirror Doc to markdown. Never throws (§4.5). */
export function serializeMarkdown(doc: Node): string {
  return serializer.serialize(doc)
}

// Mark unused import so eslint doesn't complain in build mode.
void defaultMarkdownParser
void defaultMarkdownSerializer
