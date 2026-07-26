// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * HTML → Markdown, the second half of Typst → Markdown.
 *
 * Typst source cannot be converted by parsing: it is a programming language
 * (`#let`, functions, `#import`, show/set rules), so recovering a document
 * needs an *evaluator*. The evaluator we already ship is the Typst compiler
 * itself — so the pipeline compiles to HTML and converts that here.
 *
 * Hand-rolled rather than pulling in turndown: the input is not arbitrary web
 * HTML but the narrow, structural subset Typst's HTML writer emits, and core's
 * bundles avoid new runtime dependencies. Anything unrecognized degrades to its
 * text content, never to an exception.
 *
 * Requires a DOM (`DOMParser`) — available in every browser and in the
 * desktop/mobile webviews this runs in.
 */

/** Conversion result plus anything that could not be represented. */
export interface HtmlToMarkdownOutput {
  markdown: string
  warnings: string[]
}

interface Ctx {
  warnings: string[]
  /**
   * Levels to subtract from every heading.
   *
   * Typst's HTML writer starts the document at `<h2>` — `= Title` becomes a
   * level-2 heading, since it reserves `<h1>` for the document title. Emitting
   * that verbatim would demote every heading by one on each conversion.
   */
  headingShift: number
}

/** Characters that would otherwise be read as markdown syntax. */
function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]#])/g, '\\$1')
}

/** Collapse runs of whitespace the way inline HTML rendering does. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ')
}

/**
 * Convert an HTML document (as produced by Typst's HTML export) to Markdown.
 *
 * Never throws — a document it cannot parse comes back as an empty result with
 * a warning, so the caller can report it beside the editor.
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownOutput {
  const ctx: Ctx = { warnings: [], headingShift: 0 }

  if (typeof DOMParser === 'undefined') {
    return {
      markdown: '',
      warnings: ['Converting from Typst needs a browser environment.'],
    }
  }

  let body: HTMLElement | null = null
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    body = doc.body
  } catch {
    return { markdown: '', warnings: ['The compiled document could not be read.'] }
  }
  if (!body) return { markdown: '', warnings: ['The compiled document was empty.'] }

  ctx.headingShift = headingShift(body)
  const md = blocks(body, ctx).replace(/\n{3,}/g, '\n\n').trim()
  return { markdown: md ? `${md}\n` : '', warnings: [...new Set(ctx.warnings)] }
}

/**
 * How many levels to lift headings so the document starts at `#`.
 *
 * A document whose shallowest heading is `<h2>` — what Typst emits for `=` —
 * is promoted by one. Anything already starting at `<h1>` is left alone.
 */
function headingShift(body: HTMLElement): number {
  const levels = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
    Number(h.tagName[1]),
  )
  return levels.length === 0 ? 0 : Math.min(...levels) - 1
}

/** Serialize every child of `el` as block-level markdown. */
function blocks(el: Element, ctx: Ctx, indent = ''): string {
  const out: string[] = []
  for (const node of Array.from(el.childNodes)) {
    const chunk = block(node, ctx, indent)
    if (chunk.trim()) out.push(chunk)
  }
  return out.join('\n\n')
}

function block(node: ChildNode, ctx: Ctx, indent: string): string {
  if (node.nodeType === 3 /* text */) {
    const text = collapse(node.textContent ?? '')
    return text.trim() ? indent + escapeMd(text) : ''
  }
  if (node.nodeType !== 1 /* element */) return ''

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = Math.max(1, Number(tag[1]) - ctx.headingShift)
      return `${indent}${'#'.repeat(level)} ${inline(el, ctx)}`
    }

    case 'p':
      return indent + inline(el, ctx)

    case 'br':
      return ''

    case 'hr':
      return `${indent}---`

    case 'blockquote':
      return blocks(el, ctx)
        .split('\n')
        .map((l) => `${indent}> ${l}`)
        .join('\n')

    case 'pre': {
      // Typst emits <pre><code data-lang="…">.
      const code = el.querySelector('code')
      const lang = code?.getAttribute('data-lang') ?? ''
      const text = (code ?? el).textContent ?? ''
      return `${indent}\`\`\`${lang}\n${text.replace(/\n$/, '')}\n${indent}\`\`\``
    }

    case 'ul': case 'ol':
      return list(el, ctx, indent, tag === 'ol')

    case 'table':
      return table(el, ctx, indent)

    case 'figure': {
      const img = el.querySelector('img')
      const caption = el.querySelector('figcaption')
      if (img) {
        const alt = caption ? collapse(caption.textContent ?? '') : (img.getAttribute('alt') ?? '')
        return `${indent}![${escapeMd(alt)}](${img.getAttribute('src') ?? ''})`
      }
      return blocks(el, ctx, indent)
    }

    case 'img':
      return `${indent}![${escapeMd(el.getAttribute('alt') ?? '')}](${el.getAttribute('src') ?? ''})`

    case 'math':
      return `${indent}$$${mathText(el, ctx)}$$`

    case 'div': case 'section': case 'article': case 'main': case 'body':
      return blocks(el, ctx, indent)

    default:
      // Unknown block-level element: keep its content rather than dropping it.
      return el.children.length > 0 ? blocks(el, ctx, indent) : indent + inline(el, ctx)
  }
}

function list(el: Element, ctx: Ctx, indent: string, ordered: boolean): string {
  const rows: string[] = []
  let n = 1
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue
    const marker = ordered ? `${n++}. ` : '- '
    // Nested lists render as their own block, indented under the item.
    const nested = Array.from(li.children).filter((c) =>
      ['ul', 'ol'].includes(c.tagName.toLowerCase()),
    )
    const own = inline(li, ctx, nested)
    rows.push(`${indent}${marker}${own}`)
    for (const sub of nested) {
      rows.push(list(sub, ctx, `${indent}  `, sub.tagName.toLowerCase() === 'ol'))
    }
  }
  return rows.join('\n')
}

function table(el: Element, ctx: Ctx, indent: string): string {
  const rows = Array.from(el.querySelectorAll('tr'))
  if (rows.length === 0) return ''

  const cells = rows.map((tr) =>
    Array.from(tr.children).map((c) => inline(c, ctx).replace(/\|/g, '\\|')),
  )
  const columns = Math.max(...cells.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(columns - r.length).fill('')]

  const [head = [], ...body] = cells
  const lines = [
    `${indent}| ${pad(head).join(' | ')} |`,
    `${indent}| ${Array(columns).fill('---').join(' | ')} |`,
    ...body.map((r) => `${indent}| ${pad(r).join(' | ')} |`),
  ]
  return lines.join('\n')
}

/** Serialize inline content, optionally skipping nodes handled elsewhere. */
function inline(el: Element, ctx: Ctx, skip: Element[] = []): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1 && skip.includes(node as Element)) continue
    out += inlineNode(node, ctx)
  }
  return out.trim()
}

function inlineNode(node: ChildNode, ctx: Ctx): string {
  if (node.nodeType === 3) return escapeMd(collapse(node.textContent ?? ''))
  if (node.nodeType !== 1) return ''

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  switch (tag) {
    case 'strong': case 'b':
      return `**${inline(el, ctx)}**`
    case 'em': case 'i':
      return `*${inline(el, ctx)}*`
    case 'del': case 's':
      return `~~${inline(el, ctx)}~~`
    case 'code':
      return `\`${el.textContent ?? ''}\``
    case 'a': {
      const href = el.getAttribute('href') ?? ''
      const text = inline(el, ctx)
      return href ? `[${text}](${href})` : text
    }
    case 'br':
      return '  \n'
    case 'img':
      return `![${escapeMd(el.getAttribute('alt') ?? '')}](${el.getAttribute('src') ?? ''})`
    case 'math':
      return `$${mathText(el, ctx)}$`
    default:
      return inline(el, ctx)
  }
}

/**
 * Recover a formula from Typst's MathML output.
 *
 * MathML carries presentation, not LaTeX, so this rebuilds the structure that
 * markdown's `$…$` needs: the common presentation elements map cleanly onto TeX
 * (`msup` → `^{}`, `mfrac` → `\frac{}{}`, …). Anything outside that set falls
 * back to its text content — readable and editable, but not faithful, so the
 * caller is told.
 */
function mathText(el: Element, ctx: Ctx): string {
  ctx.warnings.push('Equations were converted from MathML and may need review.')
  const annotation = el.querySelector('annotation')
  // Some writers attach the original TeX as an annotation — use it when present.
  if (annotation?.textContent) return annotation.textContent.trim()
  return mathML(el).trim()
}

/** Serialize a MathML subtree as LaTeX. */
function mathML(el: Element): string {
  const kids = Array.from(el.children)
  const arg = (n: number) => `{${kids[n] ? mathML(kids[n]!).trim() : ''}}`
  // After `^` / `_` a single token needs no braces: `x^2` reads better than
  // `{x}^{2}`. After a command name they are mandatory — `\fracab` is a
  // different (undefined) command, not `\frac{a}{b}`.
  const tight = (n: number) => {
    const s = kids[n] ? mathML(kids[n]!).trim() : ''
    return s.length === 1 ? s : `{${s}}`
  }

  switch (el.tagName.toLowerCase()) {
    case 'mi': case 'mn': case 'mo': case 'mtext': {
      // Typst writes variables as Mathematical Alphanumeric Symbols (𝑥, not x);
      // NFKC folds them back to the ASCII a LaTeX author would have typed.
      const text = collapse(el.textContent ?? '').normalize('NFKC').trim()
      return el.tagName.toLowerCase() === 'mo' ? ` ${text} ` : text
    }
    case 'msup': return `${tight(0)}^${tight(1)}`
    case 'msub': return `${tight(0)}_${tight(1)}`
    case 'msubsup': return `${tight(0)}_${tight(1)}^${tight(2)}`
    case 'munder': return `\\underset${arg(1)}${arg(0)}`
    case 'mover': return `\\overset${arg(1)}${arg(0)}`
    case 'mfrac': return `\\frac${arg(0)}${arg(1)}`
    case 'msqrt': return `\\sqrt{${kids.map(mathML).join('')}}`
    case 'mroot': return `\\sqrt[${mathML(kids[1] ?? el)}]${arg(0)}`
    default:
      // math / mrow / mstyle / semantics and friends: pure grouping.
      return kids.length > 0
        ? kids.map(mathML).join('').replace(/\s+/g, ' ').trim()
        : collapse(el.textContent ?? '').normalize('NFKC')
  }
}
