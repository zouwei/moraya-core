/**
 * Unified ProseMirror Schema for `@moraya/markdown-core`.
 *
 * Faithful 1:1 migration from Moraya desktop `src/lib/editor/schema.ts`
 * with the following DI changes (v0.60.0-pre §F2.5):
 *   - All Tauri IPC `read_file_binary` / `plugin-http` calls in image / media
 *     loaders are replaced by consumer-injected `MediaResolver` methods.
 *   - Schema NodeSpecs that depend on the resolver (image, html_inline) are
 *     built inside `createSchema(config)` factory body, capturing `config`
 *     in closures for `toDOM`. Other NodeSpecs are pure data.
 *   - Module-level `documentBaseDir` + `setDocumentBaseDir` is preserved
 *     (pure string state, not Tauri-coupled).
 *   - Per §6.1.1: this module does NOT export the default schema. It is
 *     used internally by parseMarkdown / serializeMarkdown only.
 *
 * Nodes (23): doc, text, paragraph, heading, blockquote, code_block,
 *   horizontal_rule, bullet_list, ordered_list, list_item, image,
 *   hardbreak, html_block, html_inline, table, table_header_row, table_row,
 *   table_header, table_cell, math_inline, math_block,
 *   defList, defListTerm, defListDescription
 *
 * Marks (6): html_mark, strong, em, code, link, strike_through
 */

import { Schema, Fragment } from 'prosemirror-model'
import type { NodeSpec, MarkSpec, Node as PmNode } from 'prosemirror-model'
import katex from 'katex'
import {
  type SchemaConfig,
  type MediaResolver,
  isNullMediaResolver,
  NULL_MEDIA_RESOLVER_SENTINEL,
  type NullMediaResolver,
} from './types'

// ── Helpers (pure DOM / string ops, no host coupling) ────────────

/** Extract a quoted attribute value from an HTML tag string. */
function extractHtmlAttr(html: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = html.match(re)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

/** Extract all attributes from an HTML tag string as key-value pairs. */
function extractAllHtmlAttrs(html: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const name = m[1]
    if (!name) continue
    attrs[name.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return attrs
}

/** Replace element content with broken-image icon + source code display. */
function showBrokenImage(container: HTMLElement, sourceText: string): void {
  container.textContent = ''
  container.className = (container.className.replace(/\bhtml-img-wrapper\b|\bimage-node\b/, '').trim()
    + ' broken-image').trim()
  const icon = document.createElement('span')
  icon.className = 'broken-image-icon'
  container.appendChild(icon)
  const code = document.createElement('code')
  code.className = 'broken-image-src'
  code.textContent = sourceText
  container.appendChild(code)
}

/** Convert HTML tag attributes to CSS inline styles for visual rendering. */
function htmlTagToStyle(openTag: string): string {
  const tagMatch = openTag.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)
  if (!tagMatch || !tagMatch[1]) return ''
  const tagName = tagMatch[1].toLowerCase()
  switch (tagName) {
    case 'font': {
      const parts: string[] = []
      const color = extractHtmlAttr(openTag, 'color')
      if (color) parts.push(`color: ${color}`)
      const size = extractHtmlAttr(openTag, 'size')
      if (size) {
        const sizeMap: Record<string, string> = {
          '1': '0.63em', '2': '0.82em', '3': '1em', '4': '1.13em',
          '5': '1.5em', '6': '2em', '7': '3em',
        }
        parts.push(`font-size: ${sizeMap[size] || size}`)
      }
      const face = extractHtmlAttr(openTag, 'face')
      if (face) parts.push(`font-family: ${face}`)
      return parts.join('; ')
    }
    case 'span':
    case 'div':
      return extractHtmlAttr(openTag, 'style') || ''
    default:
      return ''
  }
}

/**
 * Base directory for resolving relative image paths. Set by the consumer when
 * a document is opened so `<img src="./foo.png">` can be resolved. Pure
 * string state — not Tauri-coupled.
 */
let documentBaseDir = ''

/** Update the base directory used to resolve relative image paths. */
export function setDocumentBaseDir(dir: string): void {
  documentBaseDir = dir
}

/** Read the current base dir. Exposed for consumers that need to coordinate (e.g. tests). */
export function getDocumentBaseDir(): string {
  return documentBaseDir
}

/** Check if a path is a local file path (absolute Unix or Windows path). */
function isAbsoluteFilePath(src: string): boolean {
  if (!src) return false
  if (src.startsWith('/') && !src.startsWith('//')) return true
  if (/^[A-Z]:[\\/]/i.test(src)) return true
  return false
}

/** Check if a src is a relative file path (not a URL scheme). */
function isRelativePath(src: string): boolean {
  if (!src) return false
  if (/^(https?:|data:|blob:|javascript:|vbscript:|tauri:|\/\/)/i.test(src)) return false
  if (src.startsWith('/') || /^[A-Z]:[\\/]/i.test(src)) return false
  return true
}

/** Resolve a relative path against documentBaseDir to an absolute path. */
function resolveRelativePath(src: string): string {
  if (!documentBaseDir) return src
  let rel = src.replace(/^\.\//, '')
  const sep = documentBaseDir.includes('\\') ? '\\' : '/'
  let base = documentBaseDir.endsWith(sep) ? documentBaseDir.slice(0, -1) : documentBaseDir
  while (rel.startsWith('../') || rel.startsWith('..\\')) {
    rel = rel.slice(3)
    const lastSep = base.lastIndexOf(sep)
    if (lastSep > 0) base = base.slice(0, lastSep)
  }
  return `${base}${sep}${rel}`
}

// ── Image / media DI helpers ────────────────────────────────────

/**
 * Apply MediaResolver-loaded URL to an <img> element. Decodes URL-encoded
 * paths first (markdown parsers URL-encode non-ASCII; filesystem expects
 * actual Unicode characters).
 */
function loadLocalImageSrc(
  img: HTMLImageElement,
  src: string,
  mediaResolver: MediaResolver
): void {
  let path: string
  try { path = decodeURIComponent(src) } catch { path = src }

  mediaResolver.loadLocalImage(path).then((url) => {
    if (url) img.src = url
    else img.dispatchEvent(new Event('error'))
  }).catch(() => {
    img.dispatchEvent(new Event('error'))
  })
}

/** Apply MediaResolver-loaded URL to a <video>/<audio>/<source> element. */
function setMediaSrc(
  el: HTMLMediaElement | HTMLSourceElement,
  src: string,
  mediaResolver: MediaResolver
): void {
  if (isAbsoluteFilePath(src)) {
    mediaResolver.loadLocalMedia(src).then((url) => {
      if (!url) return
      el.src = url
      if (el instanceof HTMLMediaElement) el.load()
    }).catch(() => { /* media load failed silently */ })
  } else if (isRelativePath(src)) {
    mediaResolver.loadLocalMedia(resolveRelativePath(src)).then((url) => {
      if (!url) return
      el.src = url
      if (el instanceof HTMLMediaElement) el.load()
    }).catch(() => { /* media load failed silently */ })
  } else if (/^https?:\/\//i.test(src)) {
    // For <video>, set src directly so the browser can issue HTTP range requests
    // and stream playback. Tauri-HTTP-to-blob proxy used for <audio> would
    // download entire file before any frame plays — fine for a few-MB audio,
    // fatal for 10s-of-MB to GB video.
    if (el instanceof HTMLVideoElement) {
      el.src = src
      el.load()
    } else {
      mediaResolver.loadRemoteMedia(src).then((url) => {
        if (!url) return
        el.src = url
        if (el instanceof HTMLMediaElement) el.load()
      }).catch(() => { /* fetch failed */ })
    }
  } else {
    el.src = src
  }
}

/**
 * Create a <video> or <audio> element from raw HTML. Attributes from the
 * original tag are preserved. Child <source> elements are extracted.
 * Event handler attributes (on*) are stripped for XSS prevention.
 */
function createMediaElement(
  tagName: 'video' | 'audio',
  value: string,
  mediaResolver: MediaResolver
): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.dataset.type = 'html-inline'
  wrapper.dataset.value = value
  wrapper.className = 'html-media-wrapper'
  wrapper.contentEditable = 'false'

  const el = document.createElement(tagName)
  // Stop ProseMirror from grabbing mousedown for atom-node selection — the
  // browser's native <audio>/<video> controls (play, scrub, volume) must
  // receive events directly, otherwise clicks select the node instead of
  // triggering playback.
  const stopForControls = (ev: Event) => ev.stopPropagation()
  el.addEventListener('mousedown', stopForControls)
  el.addEventListener('click', stopForControls)
  el.addEventListener('pointerdown', stopForControls)

  const openTagMatch = value.match(new RegExp(`^<${tagName}\\b[^>]*>`, 'i'))
  const openTag = openTagMatch ? openTagMatch[0] : ''
  const attrs = extractAllHtmlAttrs(openTag)

  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'src') continue
    if (key.startsWith('on')) continue
    el.setAttribute(key, val)
  }

  const strippedTag = openTag.replace(/=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, '')
  const boolAttrs = ['controls', 'autoplay', 'loop', 'muted', 'playsinline']
  for (const attr of boolAttrs) {
    if (!(attr in attrs) && new RegExp(`\\b${attr}\\b`, 'i').test(strippedTag)) {
      el.setAttribute(attr, '')
    }
  }

  if (tagName === 'audio' && !attrs.preload) {
    el.setAttribute('preload', 'auto')
  }

  const sourceRe = /<source\b[^>]*\/?>/gi
  let srcMatch: RegExpExecArray | null
  while ((srcMatch = sourceRe.exec(value)) !== null) {
    const srcAttrs = extractAllHtmlAttrs(srcMatch[0])
    if (!srcAttrs.src) continue
    const source = document.createElement('source')
    if (srcAttrs.type) source.type = srcAttrs.type
    setMediaSrc(source, srcAttrs.src, mediaResolver)
    el.appendChild(source)
  }

  if (attrs.src) {
    setMediaSrc(el, attrs.src, mediaResolver)
  }

  wrapper.appendChild(el)
  return wrapper
}

// ── Pure NodeSpecs (no MediaResolver coupling) ─────────────────

const doc: NodeSpec = {
  content: 'block+',
}

const text: NodeSpec = { group: 'inline' }

const paragraph: NodeSpec = {
  content: 'inline*',
  group: 'block',
  parseDOM: [{ tag: 'p' }],
  toDOM() { return ['p', 0] },
}

const heading: NodeSpec = {
  attrs: {
    id: { default: '' },
    level: { default: 1 },
  },
  content: 'inline*',
  group: 'block',
  defining: true,
  parseDOM: [1, 2, 3, 4, 5, 6].map(level => ({
    tag: `h${level}`,
    getAttrs(dom: HTMLElement) {
      return { level, id: dom.getAttribute('id') || '' }
    },
  })),
  toDOM(node) {
    const attrs: Record<string, string> = {}
    if (node.attrs.id) attrs.id = node.attrs.id as string
    return [`h${node.attrs.level as number}`, attrs, 0]
  },
}

const blockquote: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM() { return ['blockquote', 0] },
}

const code_block: NodeSpec = {
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  code: true,
  attrs: {
    language: { default: 'text' },
  },
  parseDOM: [{
    tag: 'pre',
    preserveWhitespace: 'full' as const,
    getAttrs(dom: HTMLElement) {
      return { language: dom.dataset.language || 'text' }
    },
  }],
  toDOM(node) {
    return ['pre', { 'data-language': (node.attrs.language as string) || undefined }, ['code', 0]]
  },
}

const horizontal_rule: NodeSpec = {
  group: 'block',
  parseDOM: [{ tag: 'hr' }],
  toDOM() { return ['hr'] },
}

const bullet_list: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM() { return ['ul', 0] },
}

const ordered_list: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: {
    order: { default: 1 },
  },
  parseDOM: [{
    tag: 'ol',
    getAttrs(dom: HTMLElement) {
      return { order: dom.hasAttribute('start') ? +(dom.getAttribute('start') || 1) : 1 }
    },
  }],
  toDOM(node) {
    return node.attrs.order === 1
      ? ['ol', 0]
      : ['ol', { start: node.attrs.order as number }, 0]
  },
}

const list_item: NodeSpec = {
  content: 'paragraph block*',
  group: 'listItem',
  defining: true,
  attrs: {
    label: { default: '•' },
    listType: { default: 'bullet' },
    spread: { default: 'true' },
    checked: { default: null },
  },
  parseDOM: [
    {
      tag: 'li[data-item-type="task"]',
      getAttrs(dom: HTMLElement) {
        return {
          label: dom.dataset.label,
          listType: dom.dataset.listType,
          spread: dom.dataset.spread,
          checked: dom.dataset.checked ? dom.dataset.checked === 'true' : null,
        }
      },
    },
    {
      tag: 'li',
      getAttrs(dom: HTMLElement) {
        return {
          label: dom.dataset.label || '•',
          listType: dom.dataset.listType || 'bullet',
          spread: dom.dataset.spread || 'true',
        }
      },
    },
  ],
  toDOM(node) {
    if (node.attrs.checked != null) {
      return ['li', {
        'data-item-type': 'task',
        'data-label': node.attrs.label as string,
        'data-list-type': node.attrs.listType as string,
        'data-spread': node.attrs.spread as string,
        'data-checked': String(node.attrs.checked),
      }, 0]
    }
    return ['li', {
      'data-label': node.attrs.label as string,
      'data-list-type': node.attrs.listType as string,
      'data-spread': node.attrs.spread as string,
    }, 0]
  },
}

const hardbreak: NodeSpec = {
  inline: true,
  group: 'inline',
  selectable: false,
  attrs: {
    isInline: { default: false },
  },
  parseDOM: [
    { tag: 'br' },
    {
      tag: 'span[data-type="hardbreak"]',
      getAttrs() { return { isInline: true } },
    },
  ],
  toDOM() {
    // Always render as span with newline to maintain consistent cursor size.
    // leafText() ensures it serializes correctly.
    return ['span', { 'data-type': 'hardbreak', 'class': 'hardbreak-marker' }, '\n']
  },
  leafText() { return '\n' },
}

const html_block: NodeSpec = {
  content: 'text*',
  group: 'block',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [{
    tag: 'div[data-type="html"]',
    preserveWhitespace: 'full' as const,
  }],
  toDOM() {
    return ['div', { 'data-type': 'html' }, ['pre', 0]]
  },
}

// ── Table NodeSpecs ─────────────────────────────────────────────

const table: NodeSpec = {
  content: 'table_header_row table_row+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
  parseDOM: [{ tag: 'table' }],
  toDOM() { return ['table', ['tbody', 0]] },
}

const table_header_row: NodeSpec = {
  content: '(table_header)*',
  tableRole: 'row',
  parseDOM: [
    { tag: 'tr[data-is-header]' },
    {
      tag: 'tr',
      getAttrs(dom: HTMLElement) {
        const hasHeader = dom.querySelector('th')
        return hasHeader ? {} : false
      },
    },
  ],
  toDOM() { return ['tr', { 'data-is-header': 'true' }, 0] },
}

const table_row: NodeSpec = {
  content: '(table_cell)*',
  tableRole: 'row',
  parseDOM: [{ tag: 'tr' }],
  toDOM() { return ['tr', 0] },
}

const table_header: NodeSpec = {
  content: 'paragraph+',
  tableRole: 'header_cell',
  attrs: {
    alignment: { default: 'left' },
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  },
  isolating: true,
  parseDOM: [{
    tag: 'th',
    getAttrs(dom: HTMLElement) {
      return {
        alignment: dom.style.textAlign || 'left',
        colspan: Number(dom.getAttribute('colspan') || 1),
        rowspan: Number(dom.getAttribute('rowspan') || 1),
        colwidth: null,
      }
    },
  }],
  toDOM(node) {
    return ['th', { style: `text-align: ${(node.attrs.alignment as string) || 'left'}` }, 0]
  },
}

const table_cell: NodeSpec = {
  content: 'paragraph+',
  tableRole: 'cell',
  attrs: {
    alignment: { default: 'left' },
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  },
  isolating: true,
  parseDOM: [{
    tag: 'td',
    getAttrs(dom: HTMLElement) {
      return {
        alignment: dom.style.textAlign || 'left',
        colspan: Number(dom.getAttribute('colspan') || 1),
        rowspan: Number(dom.getAttribute('rowspan') || 1),
        colwidth: null,
      }
    },
  }],
  toDOM(node) {
    return ['td', { style: `text-align: ${(node.attrs.alignment as string) || 'left'}` }, 0]
  },
}

// ── Math NodeSpecs (KaTeX) ──────────────────────────────────────

const math_inline: NodeSpec = {
  group: 'inline',
  content: 'text*',
  inline: true,
  atom: true,
  parseDOM: [{
    tag: 'span[data-type="math_inline"]',
    getContent(dom: globalThis.Node, schema: Schema) {
      if (!(dom instanceof HTMLElement)) return Fragment.empty
      const value = dom.dataset.value ?? ''
      if (!value) return Fragment.empty
      return Fragment.from(schema.text(value))
    },
  }],
  toDOM(node) {
    const code = node.textContent
    const dom = document.createElement('span')
    dom.dataset.type = 'math_inline'
    dom.dataset.value = code
    try {
      katex.render(code, dom)
    } catch {
      // §4.4 KaTeX error contract: render fallback marker; serializer reads data-tex attr.
      dom.textContent = code
      dom.classList.add('math-error')
      dom.setAttribute('data-math-type', 'inline')
    }
    return dom
  },
}

const math_block: NodeSpec = {
  content: 'text*',
  group: 'block',
  marks: '',
  defining: true,
  atom: true,
  isolating: true,
  attrs: {
    value: { default: '' },
  },
  parseDOM: [{
    tag: 'div[data-type="math_block"]',
    preserveWhitespace: 'full' as const,
    getAttrs(dom: HTMLElement) {
      return { value: dom.dataset.value ?? '' }
    },
  }],
  toDOM(node) {
    const code = node.attrs.value as string
    const dom = document.createElement('div')
    dom.dataset.type = 'math_block'
    dom.dataset.value = code
    try {
      katex.render(code, dom, { displayMode: true })
    } catch {
      dom.textContent = code
      dom.classList.add('math-error')
      dom.setAttribute('data-math-type', 'block')
    }
    return dom
  },
}

// ── Definition List NodeSpecs ───────────────────────────────────

const defList: NodeSpec = {
  content: '(defListTerm | defListDescription)+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'dl' }],
  toDOM() { return ['dl', { class: 'definition-list' }, 0] },
}

const defListTerm: NodeSpec = {
  content: 'inline*',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'dt' }],
  toDOM() { return ['dt', 0] },
}

const defListDescription: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'dd' }],
  toDOM() { return ['dd', 0] },
}

// ── Marks ───────────────────────────────────────────────────────

const strong: MarkSpec = {
  parseDOM: [
    {
      tag: 'b',
      getAttrs(dom: HTMLElement) {
        return dom.style.fontWeight !== 'normal' && null
      },
    },
    { tag: 'strong' },
    {
      style: 'font-weight',
      getAttrs(value: string) {
        return /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null
      },
    },
  ],
  toDOM() { return ['strong', 0] },
}

const em: MarkSpec = {
  parseDOM: [
    { tag: 'i' },
    { tag: 'em' },
    {
      style: 'font-style',
      getAttrs(value: string) {
        return value === 'italic' && null
      },
    },
  ],
  toDOM() { return ['em', 0] },
}

const code: MarkSpec = {
  priority: 100,
  code: true,
  inclusive: false,
  parseDOM: [{ tag: 'code' }],
  toDOM() { return ['code', 0] },
}

const link: MarkSpec = {
  attrs: {
    href: {},
    title: { default: null },
  },
  inclusive: false,
  parseDOM: [{
    tag: 'a[href]',
    getAttrs(dom: HTMLElement) {
      return {
        href: dom.getAttribute('href'),
        title: dom.getAttribute('title'),
      }
    },
  }],
  toDOM(mark) {
    const attrs: Record<string, string> = { href: mark.attrs.href as string }
    if (mark.attrs.title) attrs.title = mark.attrs.title as string
    return ['a', attrs, 0]
  },
}

const strike_through: MarkSpec = {
  parseDOM: [
    { tag: 'del' },
    { tag: 's' },
    {
      style: 'text-decoration',
      getAttrs(value: string) {
        return value === 'line-through' && null
      },
    },
  ],
  toDOM() { return ['del', 0] },
}

const html_mark: MarkSpec = {
  attrs: {
    openTag: { default: '' },
    closeTag: { default: '' },
  },
  excludes: '', // Allow nesting multiple html_marks (e.g., <font><u>text</u></font>)
  parseDOM: [{
    tag: '[data-type="html-mark"]',
    getAttrs(dom: HTMLElement) {
      return {
        openTag: dom.dataset.openTag ?? '',
        closeTag: dom.dataset.closeTag ?? '',
      }
    },
  }],
  toDOM(mark) {
    const openTag = mark.attrs.openTag as string
    const tagMatch = openTag.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)
    const tagName = tagMatch && tagMatch[1] ? tagMatch[1].toLowerCase() : 'span'

    const attrs: Record<string, string> = {
      'data-type': 'html-mark',
      'data-open-tag': openTag,
      'data-close-tag': mark.attrs.closeTag as string,
    }

    const semanticTags = ['sub', 'sup', 'u', 'ins', 'mark', 'small', 'big', 'kbd', 'abbr']
    if (semanticTags.includes(tagName)) {
      return [tagName, attrs, 0]
    }

    const style = htmlTagToStyle(openTag)
    if (style) attrs.style = style
    return ['span', attrs, 0]
  },
}

// ── Resolver-coupled NodeSpec builders (image, html_inline) ─────

/**
 * Build the `image` NodeSpec with a closed-over MediaResolver. Local-path
 * images are loaded via `mediaResolver.loadLocalImage`; remote URLs are
 * applied directly so the browser can stream / cache normally.
 */
function buildImageNodeSpec(mediaResolver: MediaResolver): NodeSpec {
  return {
    inline: true,
    group: 'inline',
    selectable: true,
    draggable: true,
    marks: '',
    atom: true,
    defining: true,
    isolating: true,
    attrs: {
      src: { default: '' },
      alt: { default: '' },
      title: { default: '' },
    },
    parseDOM: [{
      tag: 'img[src]',
      getAttrs(dom: HTMLElement) {
        return {
          src: dom.getAttribute('src') || '',
          alt: dom.getAttribute('alt') || '',
          title: dom.getAttribute('title') || dom.getAttribute('alt') || '',
        }
      },
    }],
    toDOM(node) {
      const container = document.createElement('span')
      container.className = 'image-node'

      const img = document.createElement('img')
      if (node.attrs.alt) img.alt = node.attrs.alt as string
      if (node.attrs.title) img.title = node.attrs.title as string

      // Apply width from title attr (e.g. title="width=70%")
      const titleStr = (node.attrs.title || '') as string
      const widthMatch = titleStr.match(/^width=(\d+%?)$/)
      const widthVal = widthMatch?.[1]
      if (widthVal) {
        img.style.width = widthVal.includes('%') ? widthVal : `${widthVal}px`
        img.style.maxWidth = 'none'
      }

      img.onerror = () => {
        const alt = node.attrs.alt ? `![${node.attrs.alt}]` : '![]'
        const title = node.attrs.title ? ` "${node.attrs.title}"` : ''
        showBrokenImage(container, `${alt}(${node.attrs.src}${title})`)
      }

      const src = node.attrs.src as string
      if (isAbsoluteFilePath(src)) {
        loadLocalImageSrc(img, src, mediaResolver)
      } else if (isRelativePath(src)) {
        loadLocalImageSrc(img, resolveRelativePath(src), mediaResolver)
      } else {
        img.src = src
      }

      container.appendChild(img)
      return container
    },
  }
}

/**
 * Build the `html_inline` NodeSpec with a closed-over MediaResolver. Inline
 * <img> / <video> / <audio> tags route their src through the resolver; other
 * inline HTML (<font>, <br>, etc.) renders as a plain span carrying its
 * verbatim source for byte-stable roundtrip.
 */
function buildHtmlInlineNodeSpec(mediaResolver: MediaResolver): NodeSpec {
  return {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
      value: { default: '' },
    },
    parseDOM: [{
      tag: 'span[data-type="html-inline"]',
      getAttrs(dom: HTMLElement) {
        return { value: dom.dataset.value ?? '' }
      },
    }],
    toDOM(node) {
      const value = node.attrs.value as string

      if (/^<img\s/i.test(value)) {
        const wrapper = document.createElement('span')
        wrapper.dataset.type = 'html-inline'
        wrapper.dataset.value = value
        wrapper.className = 'html-img-wrapper'

        const attrs = extractAllHtmlAttrs(value)
        const src = attrs.src || ''
        if (src) {
          const img = document.createElement('img')
          for (const [key, val] of Object.entries(attrs)) {
            if (key === 'src') continue
            if (key === 'onerror' || key === 'onload' || key.startsWith('on')) continue
            img.setAttribute(key, val)
          }
          img.onerror = () => {
            showBrokenImage(wrapper, value)
          }
          if (isAbsoluteFilePath(src)) {
            loadLocalImageSrc(img, src, mediaResolver)
          } else if (isRelativePath(src)) {
            loadLocalImageSrc(img, resolveRelativePath(src), mediaResolver)
          } else {
            img.src = src
          }
          wrapper.appendChild(img)
        } else {
          showBrokenImage(wrapper, value)
        }
        return wrapper
      }

      if (/^<video\b/i.test(value)) return createMediaElement('video', value, mediaResolver)
      if (/^<audio\b/i.test(value)) return createMediaElement('audio', value, mediaResolver)

      // Default: invisible span for other inline HTML (<font>, <br>, etc.)
      return ['span', { 'data-type': 'html-inline', 'data-value': value }]
    },
  }
}

// ── Schema assembly ─────────────────────────────────────────────

function buildNodes(mediaResolver: MediaResolver): Record<string, NodeSpec> {
  return {
    doc,
    text,
    paragraph,
    heading,
    blockquote,
    code_block,
    horizontal_rule,
    bullet_list,
    ordered_list,
    list_item,
    image: buildImageNodeSpec(mediaResolver),
    hardbreak,
    html_block,
    html_inline: buildHtmlInlineNodeSpec(mediaResolver),
    table,
    table_header_row,
    table_row,
    table_header,
    table_cell,
    math_inline,
    math_block,
    defList,
    defListTerm,
    defListDescription,
  }
}

const marks: Record<string, MarkSpec> = {
  html_mark,
  strong,
  em,
  code,
  link,
  strike_through,
}

// ── Internal default schema (parser/serializer fallback) ────────

const nullMediaResolver: NullMediaResolver = {
  [NULL_MEDIA_RESOLVER_SENTINEL]: true,
  async loadLocalImage() { return '' },
  async loadLocalMedia() { return '' },
  async loadRemoteMedia(url: string) { return url },
}

/**
 * Internal default schema (uses {@link nullMediaResolver}).
 * Used by parseMarkdown / serializeMarkdown when no real consumer schema
 * is available. Per §6.1.1 NOT exported via index.ts — consumers must call
 * createSchema(config) with a real MediaResolver.
 */
export const defaultSchema = new Schema({
  nodes: buildNodes(nullMediaResolver),
  marks,
})

// ── Public factory ──────────────────────────────────────────────

/** Cached config-keyed schemas. Reuses Schema instances when consumers call createSchema with the same config. */
const schemaCache = new WeakMap<MediaResolver, Schema>()

/**
 * Create a ProseMirror Schema with consumer-injected dependencies.
 *
 * @throws TypeError if `config.mediaResolver` is missing or is the internal
 *   nullMediaResolver sentinel.
 */
export function createSchema(config: SchemaConfig): Schema {
  if (!config || typeof config !== 'object') {
    throw new TypeError('@moraya/markdown-core: createSchema() requires a config object with a MediaResolver')
  }
  if (!config.mediaResolver) {
    throw new TypeError('@moraya/markdown-core: createSchema() requires a MediaResolver')
  }
  if (isNullMediaResolver(config.mediaResolver)) {
    throw new TypeError(
      "@moraya/markdown-core: do not pass nullMediaResolver to createSchema(). That instance is reserved for parseMarkdown/serializeMarkdown internal use only. Provide a real MediaResolver implementation (e.g. BrowserMediaResolver from '@moraya/markdown-core/adapters/browser-media-resolver')."
    )
  }
  const cached = schemaCache.get(config.mediaResolver)
  if (cached) return cached
  const schema = new Schema({
    nodes: buildNodes(config.mediaResolver),
    marks,
  })
  schemaCache.set(config.mediaResolver, schema)
  return schema
}

export type { SchemaConfig, PmNode }
