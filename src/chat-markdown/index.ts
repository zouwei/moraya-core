/**
 * @moraya/core/chat-markdown — streaming-safe markdown → HTML for AI chat bubbles.
 *
 * Pure-function, framework-agnostic. Runs in browsers, Node SSR, Edge runtimes,
 * and Workers. Zero dependencies on KaTeX or highlight.js — consumers wire those
 * in via `math` / `highlight` callbacks, which lets bundlers tree-shake them out
 * for chat apps that don't need math (e.g. mobile chat saves ~280 KB).
 *
 * Streaming safety: every call is idempotent. Half-written code fences, math, or
 * links produced by LLM SSE chunking degrade to readable HTML — never throws.
 *
 * Security posture (matches the locked-down config Moraya mobile shipped to
 * production):
 *  - `html: false` — raw HTML in the model's reply is escaped, not rendered
 *  - `linkify: true` — bare URLs become anchors
 *  - All `<a>` tags get `target="_blank"` + `rel="noopener noreferrer"` by
 *    default (overridable via `linkAttrs`)
 *  - URL protocol whitelist: only http/https/mailto/tel (markdown-it default
 *    `validateLink` + our explicit deny of javascript:/data:text/html/vbscript:)
 *
 * Design note (v0.4.0): the public surface is one function + one options
 * object. The locked plan called for `math: boolean` ergonomics, but pivoted
 * to callback-form during implementation because tsup's `splitting: false`
 * means any internal `import 'katex'` would land in every consumer's bundle,
 * defeating the tree-shake intent. Callbacks let consumers BYO renderer (or
 * skip math entirely on mobile) with zero loss of ergonomics — the README
 * shows the 5-line wiring pattern.
 */

import MarkdownIt from 'markdown-it'

export interface ChatMarkdownLinkAttrs {
  /** Default `'_blank'`. Pass `'_self'` for in-app navigation contexts. */
  target?: string
  /** Default `'noopener noreferrer'`. */
  rel?: string
}

export interface ChatMarkdownOptions {
  /**
   * Math renderer. When provided, `$inline$` and `$$display$$` math is parsed
   * and passed to this callback. When omitted, math syntax renders as plain
   * text (the dollar signs are kept verbatim).
   *
   * Typical wiring with KaTeX:
   *   import katex from 'katex'
   *   { math: (latex, display) => katex.renderToString(latex, { displayMode: display, throwOnError: false }) }
   */
  math?: (latex: string, displayMode: boolean) => string

  /**
   * Code block highlighter. When provided, fenced code blocks are passed to
   * this callback (raw source + language tag). Return rendered inner HTML
   * (NOT including <pre><code>); the caller wraps it. Return `null` to fall
   * back to the default escaped <code>.
   *
   * Typical wiring with highlight.js:
   *   import hljs from 'highlight.js'
   *   { highlight: (code, lang) => {
   *       if (lang && hljs.getLanguage(lang)) {
   *         return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
   *       }
   *       return null
   *     } }
   */
  highlight?: (code: string, lang: string) => string | null

  /** Override default link attributes. */
  linkAttrs?: ChatMarkdownLinkAttrs

  /**
   * Pre-process the markdown input before parsing. Use for app-specific
   * tokens like @mentions, custom slash commands, or local i18n expansion.
   * Whatever you return is fed straight to markdown-it.
   *
   * Mobile uses this to expand `@<id>` into a bold `**@Title**` pill.
   */
  preprocess?: (raw: string) => string
}

const DEFAULT_TARGET = '_blank'
const DEFAULT_REL = 'noopener noreferrer'

// One markdown-it instance per distinct (linkAttrs × highlight) tuple. Keeps
// the hot path allocation-free for the overwhelmingly common case (caller
// always passes the same opts).
const cache = new WeakMap<ChatMarkdownOptions, MarkdownIt>()
let defaultInstance: MarkdownIt | null = null

function buildInstance(opts: ChatMarkdownOptions | undefined): MarkdownIt {
  const target = opts?.linkAttrs?.target ?? DEFAULT_TARGET
  const rel = opts?.linkAttrs?.rel ?? DEFAULT_REL

  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: true,
    // markdown-it's `highlight` callback wraps the result in <pre><code>
    // itself if we return a string; we let it pass through verbatim and
    // wrap on its own when the user-provided highlighter handles a lang.
    highlight: opts?.highlight
      ? (code: string, lang: string) => {
          try {
            const out = opts.highlight!(code, lang)
            if (out == null) return ''
            return out
          } catch {
            // Highlighter errors must never break the bubble — fall back
            // to escaped default rendering by returning empty string.
            return ''
          }
        }
      : undefined,
  })

  // Deny javascript:/vbscript:/data:text/html URLs at the parser level. Belt
  // & suspenders alongside `html: false` — markdown-it already validates
  // URLs by default, but we make the policy explicit and unbypassable.
  const defaultValidateLink = md.validateLink.bind(md)
  md.validateLink = (url: string): boolean => {
    const trimmed = url.trim().toLowerCase()
    if (trimmed.startsWith('javascript:')) return false
    if (trimmed.startsWith('vbscript:')) return false
    if (trimmed.startsWith('data:text/html')) return false
    return defaultValidateLink(url)
  }

  // Force target + rel on every <a> emitted by markdown-it.
  const defaultLinkOpen = md.renderer.rules.link_open
    ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    token.attrSet('target', target)
    token.attrSet('rel', rel)
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  // Math: inline + block. We register custom inline + block rules so the
  // KaTeX callback only runs when math syntax is actually present.
  if (opts?.math) {
    installMathRules(md, opts.math)
  }

  return md
}

function getInstance(opts?: ChatMarkdownOptions): MarkdownIt {
  if (!opts) {
    if (!defaultInstance) defaultInstance = buildInstance(undefined)
    return defaultInstance
  }
  let inst = cache.get(opts)
  if (!inst) {
    inst = buildInstance(opts)
    cache.set(opts, inst)
  }
  return inst
}

/**
 * Render a markdown string to safe HTML for chat-bubble display.
 *
 * Safe to inject via `dangerouslySetInnerHTML` (React), `{@html}` (Svelte),
 * `v-html` (Vue), or `.innerHTML` (vanilla). No <script>, no event handlers,
 * no javascript: / data:text/html URLs.
 */
export function renderChatMarkdown(
  input: string,
  opts?: ChatMarkdownOptions,
): string {
  if (!input) return ''
  const processed = opts?.preprocess ? opts.preprocess(input) : input
  // markdown-it itself never throws on malformed input — the catch here is
  // a belt-and-suspenders measure for downstream plugin failures (e.g. a
  // user-supplied highlighter that throws synchronously). On error we fall
  // back to the input escaped as plain text so the bubble still renders.
  try {
    return getInstance(opts).render(processed)
  } catch {
    return escapeHtml(processed).replace(/\n/g, '<br>\n')
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Install $...$ (inline) and $$...$$ (block) math rules on a markdown-it
 * instance. The rules are intentionally lightweight: we look for raw `$`
 * delimiters and let the consumer's callback do the actual LaTeX → HTML
 * conversion. On callback failure (invalid LaTeX, KaTeX throw, etc.) we
 * fall back to the original `$...$` text rendered as a <code> span — this
 * is what PC desktop has shipped for years.
 */
function installMathRules(
  md: MarkdownIt,
  render: (latex: string, displayMode: boolean) => string,
): void {
  // Inline: $...$ where the closing $ is not preceded by whitespace, and the
  // delimiters aren't escaped. We're deliberately strict to avoid matching
  // dollar-amount usages like "$5 and $10" — the closing $ must be followed
  // by a non-digit or end-of-string.
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    if (state.src[state.pos] !== '$') return false
    // Reject escaped \$
    if (state.pos > 0 && state.src[state.pos - 1] === '\\') return false
    // Reject $$ (handled by block rule)
    if (state.src[state.pos + 1] === '$') return false

    const start = state.pos + 1
    let end = start
    while (end < state.posMax) {
      if (state.src[end] === '$' && state.src[end - 1] !== '\\') break
      end++
    }
    if (end >= state.posMax) return false
    // Require the char after closing $ to NOT be a digit (so "$5" doesn't match)
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

  // Block: $$...$$ on its own line(s).
  md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine]! + state.tShift[startLine]!
    const max = state.eMarks[startLine]!
    if (startPos + 2 > max) return false
    if (state.src.slice(startPos, startPos + 2) !== '$$') return false

    // Find closing $$ on a subsequent line (could be same line for single-line displays)
    let nextLine = startLine
    let found = false
    // First check if closing is on the same line: $$ formula $$
    const sameLineRest = state.src.slice(startPos + 2, max)
    const sameLineClose = sameLineRest.indexOf('$$')
    if (sameLineClose !== -1) {
      found = true
      // Confirm nothing after the closing $$ except whitespace
      const trailing = sameLineRest.slice(sameLineClose + 2).trim()
      if (trailing !== '') {
        return false
      }
    } else {
      // Multi-line — scan forward.
      for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
        const lineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!
        const lineEnd = state.eMarks[nextLine]!
        const line = state.src.slice(lineStart, lineEnd)
        if (line.trim().endsWith('$$')) {
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
      const closeLineEnd = state.eMarks[nextLine]!
      const closeLineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!
      const closingLine = state.src.slice(closeLineStart, closeLineEnd)
      const closingPos = closingLine.lastIndexOf('$$')
      const startOfBody = startPos + 2
      const endOfBody = state.bMarks[nextLine]! + state.tShift[nextLine]! + closingPos
      latex = state.src.slice(startOfBody, endOfBody).trim()
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
      return render(latex, false)
    } catch {
      return `<code>$${escapeHtml(latex)}$</code>`
    }
  }

  md.renderer.rules.math_block = (tokens, idx) => {
    const latex = tokens[idx]!.content
    try {
      return render(latex, true) + '\n'
    } catch {
      return `<pre><code>$$${escapeHtml(latex)}$$</code></pre>\n`
    }
  }
}
