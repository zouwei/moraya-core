// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Markdown → export HTML, plus the text-format helpers (sanitize, LaTeX, title).
 *
 * Unlike `@moraya/core/chat-markdown` (which locks `html:false` to escape model
 * output) this renderer is EXPORT-oriented:
 *   - `html: true` — the user's raw HTML is preserved verbatim (Moraya's
 *     no-forced-syntax-conversion rule); `sanitizeHtml` strips only scripts /
 *     event handlers / dangerous URLs afterward.
 *   - GFM tables, ordered lists, definition lists, strikethrough, task lists.
 *   - Code highlighting via highlight.js (closes the desktop regex renderer's
 *     no-tables / no-ordered-lists / no-highlight fidelity gap).
 *   - Math via KaTeX (`$…$` / `$$…$$`, mhchem `\ce`/`\pu` registered) rendered
 *     inline to predictable `<span>` / `<div class="math-block">` output.
 *   - Mermaid fences emit a `<div class="mermaid-export">` placeholder that the
 *     injected `MermaidRenderer` fills with SVG (capture path doesn't need it —
 *     it screenshots the already-rendered DOM).
 *
 * Peers used: markdown-it, markdown-it-deflist, katex, highlight.js (all already
 * @moraya/core peers).
 */

import MarkdownIt from 'markdown-it'
import deflistPlugin from 'markdown-it-deflist'
import katex from 'katex'
// Register \ce/\pu so exported chemistry formulas render. Idempotent with the
// editor's registration; external in tsup so it resolves to the one katex.
import 'katex/contrib/mhchem'
import hljs from 'highlight.js'
import type { MermaidRenderer } from './types'

// ── Escaping ─────────────────────────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function unescapeHtml(str: string): string {
  return str
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

/** Dangerous URL protocols rejected in href/src. */
const DANGEROUS_PROTOCOLS = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i
const EVENT_ATTRS = /^on/i

// ── markdown-it export instance ──────────────────────────────────────────────

function renderMath(latex: string, displayMode: boolean): string {
  const rendered = katex.renderToString(latex.trim(), { displayMode, throwOnError: false })
  return displayMode ? `<div class="math-block">${rendered}</div>` : rendered
}

function buildExportMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({
    html: true, // preserve the user's raw HTML (no forced conversion)
    linkify: true,
    typographer: false,
  })
    .enable(['table', 'strikethrough'])
    .use(deflistPlugin)

  // Reject dangerous URL schemes at the parser level.
  const defaultValidateLink = md.validateLink.bind(md)
  md.validateLink = (url: string): boolean => {
    if (DANGEROUS_PROTOCOLS.test(url)) return false
    return defaultValidateLink(url)
  }

  // Code fences: mermaid → placeholder div (SVG injected later); else highlight.
  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    const lang = (token.info || '').trim().split(/\s+/)[0] ?? ''
    if (lang === 'mermaid') {
      return `<div class="mermaid-export"><pre><code class="language-mermaid">${escapeHtml(
        token.content.replace(/\n$/, ''),
      )}</code></pre></div>`
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        const out = hljs.highlight(token.content, { language: lang, ignoreIllegals: true }).value
        return `<pre><code class="hljs language-${lang}">${out}</code></pre>`
      } catch {
        /* fall through to default rendering */
      }
    }
    return defaultFence(tokens, idx, options, env, self)
  }

  installMathRules(md)
  return md
}

/**
 * Install $…$ (inline) and $$…$$ (block) math rules. Adapted from
 * @moraya/core/chat-markdown; renders via KaTeX to predictable export output.
 */
function installMathRules(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$') return false
    if (state.pos > 0 && state.src[state.pos - 1] === '\\') return false
    if (state.src[state.pos + 1] === '$') return false

    const start = state.pos + 1
    let end = start
    while (end < state.posMax) {
      if (state.src[end] === '$' && state.src[end - 1] !== '\\') break
      end++
    }
    if (end >= state.posMax) return false
    const after = state.src[end + 1]
    if (after && /\d/.test(after)) return false

    const latex = state.src.slice(start, end)
    if (!latex.trim()) return false
    if (!silent) {
      const token = state.push('math_inline', 'span', 0)
      token.content = latex
      token.markup = '$'
    }
    state.pos = end + 1
    return true
  })

  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine]! + state.tShift[startLine]!
    const max = state.eMarks[startLine]!
    if (startPos + 2 > max) return false
    if (state.src.slice(startPos, startPos + 2) !== '$$') return false

    let nextLine = startLine
    let found = false
    const sameLineRest = state.src.slice(startPos + 2, max)
    const sameLineClose = sameLineRest.indexOf('$$')
    if (sameLineClose !== -1) {
      found = true
      if (sameLineRest.slice(sameLineClose + 2).trim() !== '') return false
    } else {
      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        const lineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!
        const lineEnd = state.eMarks[nextLine]!
        if (state.src.slice(lineStart, lineEnd).trim().endsWith('$$')) {
          found = true
          break
        }
      }
    }
    if (!found) return false
    if (silent) return true

    let latex: string
    if (sameLineClose !== -1) {
      latex = sameLineRest.slice(0, sameLineClose).trim()
    } else {
      const closeLineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!
      const closeLineEnd = state.eMarks[nextLine]!
      const closingPos = state.src.slice(closeLineStart, closeLineEnd).lastIndexOf('$$')
      latex = state.src.slice(startPos + 2, closeLineStart + closingPos).trim()
    }

    const token = state.push('math_block', 'div', 0)
    token.block = true
    token.content = latex
    token.markup = '$$'
    token.map = [startLine, nextLine + 1]
    state.line = nextLine + 1
    return true
  })

  md.renderer.rules.math_inline = (tokens, idx) => {
    const latex = tokens[idx]!.content
    try {
      return renderMath(latex, false)
    } catch {
      return `<code>$${escapeHtml(latex)}$</code>`
    }
  }
  md.renderer.rules.math_block = (tokens, idx) => {
    const latex = tokens[idx]!.content
    try {
      return renderMath(latex, true) + '\n'
    } catch {
      return `<pre><code>$$${escapeHtml(latex)}$$</code></pre>\n`
    }
  }
}

// One shared instance (config is stateless across renders).
let exportMd: MarkdownIt | null = null
function getExportMd(): MarkdownIt {
  if (!exportMd) exportMd = buildExportMarkdownIt()
  return exportMd
}

// ── Public renderers ─────────────────────────────────────────────────────────

/**
 * Render markdown to an HTML body fragment (no `<html>`/`<head>`). Tables,
 * ordered/unordered/definition/task lists, highlighted code, KaTeX math, and
 * mermaid placeholders. Raw HTML in the source is preserved.
 */
export function markdownToHtmlBody(md: string): string {
  if (!md) return ''
  try {
    return getExportMd().render(md)
  } catch {
    return `<pre>${escapeHtml(md)}</pre>`
  }
}

/**
 * Replace `<div class="mermaid-export">` placeholders with rendered SVG using
 * the injected renderer. Fails gracefully — an unrenderable block keeps its
 * `<pre><code>` fallback. No-op when no renderer is supplied.
 */
export async function renderMermaidInHtml(
  html: string,
  mermaid?: MermaidRenderer,
): Promise<string> {
  if (!mermaid || !html.includes('mermaid-export')) return html
  const regex =
    /<div class="mermaid-export"><pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre><\/div>/g
  const renders: { full: string; code: string }[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    renders.push({ full: match[0], code: unescapeHtml(match[1]!) })
  }
  for (const r of renders) {
    try {
      const result = await mermaid(r.code)
      if ('svg' in result) {
        html = html.replace(r.full, `<div class="mermaid-export">${result.svg}</div>`)
      }
    } catch {
      /* keep the <pre><code> fallback */
    }
  }
  return html
}

/**
 * Sanitize export HTML: strip scripts/iframes, event-handler attributes, and
 * dangerous src/href protocols. Uses the global DOMParser (present in every
 * target WebView + happy-dom).
 */
export function sanitizeHtml(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc.querySelectorAll('script, iframe, object, embed, applet').forEach((el) => el.remove())
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (EVENT_ATTRS.test(attr.name)) el.removeAttribute(attr.name)
    }
    for (const attrName of ['src', 'href']) {
      const val = el.getAttribute(attrName)
      if (val && DANGEROUS_PROTOCOLS.test(val)) el.removeAttribute(attrName)
    }
  }
  return doc.body.innerHTML
}

const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.28/dist/katex.min.css'
const HLJS_CSS = 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github.min.css'

const EXPORT_STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.75; color: #1a1a1a; }
  h1 { font-size: 2em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
  code { background: #f4f4f4; padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #4a90d9; padding-left: 1em; color: #666; margin: 1em 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 0.5em 0.8em; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #eee; margin: 1.5em 0; }
  a { color: #4a90d9; }
  ul, ol { padding-left: 2em; } li { margin: 0.25em 0; }
  dl { margin: 1em 0; } dt { font-weight: 600; } dd { margin: 0 0 0.5em 1.5em; }
  .math-block { text-align: center; margin: 1em 0; overflow-x: auto; }
  .mermaid-export { text-align: center; margin: 1em 0; }`

/**
 * Render markdown to a full standalone HTML document. With `includeStyles`, an
 * inline stylesheet plus KaTeX + highlight.js CDN themes are embedded. Mermaid
 * blocks are rendered to SVG if a `MermaidRenderer` is provided.
 */
export async function markdownToHtml(
  md: string,
  includeStyles = true,
  mermaid?: MermaidRenderer,
): Promise<string> {
  const body = sanitizeHtml(await renderMermaidInHtml(markdownToHtmlBody(md), mermaid))
  if (!includeStyles) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Exported from Moraya</title></head>
<body>${body}</body>
</html>`
  }
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Exported from Moraya</title>
<link rel="stylesheet" href="${KATEX_CSS}">
<link rel="stylesheet" href="${HLJS_CSS}">
<style>${EXPORT_STYLE}</style>
</head>
<body>${body}</body>
</html>`
}

// ── LaTeX + title ────────────────────────────────────────────────────────────

/** Basic Markdown → LaTeX converter. */
export function markdownToLatex(md: string): string {
  let tex = md
  tex = tex.replace(/^#\s+(.+)$/gm, '\\section{$1}')
  tex = tex.replace(/^##\s+(.+)$/gm, '\\subsection{$1}')
  tex = tex.replace(/^###\s+(.+)$/gm, '\\subsubsection{$1}')
  tex = tex.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}')
  tex = tex.replace(/\*(.+?)\*/g, '\\textit{$1}')
  tex = tex.replace(/`([^`]+)`/g, '\\texttt{$1}')
  tex = tex.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\\href{$2}{$1}')
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{hyperref}
\\usepackage{amsmath}
\\begin{document}

${tex}

\\end{document}`
}

/** Extract a document title from the first H1, else the first non-blank line. */
export function inferDocumentTitle(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h1 = line.match(/^#\s+(.+)$/)
    if (h1) return h1[1]!.trim()
    if (!line.startsWith('#')) return line.slice(0, 80)
  }
  return 'Document'
}
