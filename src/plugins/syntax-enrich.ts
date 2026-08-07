// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Second-pass scoping for text highlight.js leaves unclassified.
 *
 * hljs grammars have a thin vocabulary. Python's, for instance, emits no
 * `operator`, `punctuation` or `property` scope at all, so a line like
 *
 *     password += [random.choice(all_characters) for _ in range(length - 4)]
 *
 * arrives with only `for`, `in`, `range` and `4` scoped — everything else is
 * plain body text. Measured on a real user document, 23% of non-whitespace
 * characters carried any colour. Switching to TextMate grammars (Shiki) was
 * evaluated and rejected: its stock GitHub theme reaches 27%, and even VS
 * Code's own default theme only 24%, because the density people associate with
 * VS Code comes from a language server's semantic tokens, not from the grammar.
 *
 * SAFETY PROPERTY, and the reason this is not as risky as it sounds: this pass
 * only ever runs on runs of text that hljs scoped as NOTHING. Strings,
 * comments, keywords and every other real token are already claimed by the
 * grammar and are never handed here, so no heuristic can repaint them.
 *
 * What it will NOT do: colour bare variable names. `password` and `lowercase`
 * are indistinguishable from any other identifier without type information, and
 * tinting every one of them turns a file into noise. They stay body-coloured —
 * which is also what GitHub does.
 */

/** One run of text plus the hljs classes it should carry ([] = leave plain). */
export interface EnrichedSegment {
  text: string
  classes: string[]
}

/**
 * Formats where the heuristics below are wrong more often than right.
 *
 * Prose and patch formats carry `-`, `+`, `*` and `.` as literal content rather
 * than as operators, and hljs already scopes the parts that matter (bullets,
 * added/removed lines), so there is nothing to gain and plenty to break.
 */
const SKIP_LANGUAGES = new Set(['markdown', 'md', 'diff', 'patch', 'plaintext', 'text', 'txt'])

/**
 * HTML entities first, then identifiers, then runs of operator characters.
 *
 * The entity alternative is not optional. This same function runs over hljs's
 * escaped HTML, where `a < b` arrives as `a &lt; b`; without matching `&lt;`
 * as one unit the `&` would be taken for an operator and the entity torn in
 * half (`<span>&</span>lt;`), corrupting the output. Matching it whole also
 * keeps the export path colouring `<` and `>` exactly like the editor, which
 * sees them unescaped.
 *
 * `:` and the brackets are deliberately absent: they are punctuation, which
 * this palette paints body-coloured anyway, so matching them would be churn
 * with no visible effect and a real chance of hitting YAML keys or slices.
 */
const TOKEN = /&(?:lt|gt|amp|quot|#\d+);|[A-Za-z_$][A-Za-z0-9_$]*|[=+\-*/%<>!&|^~]+/g

/** Entities that stand for an operator character. */
const OPERATOR_ENTITIES = new Set(['&lt;', '&gt;', '&amp;'])

/** ≥2 chars, all caps/digits/underscore, at least one letter. */
const SCREAMING_CASE = /^(?=.*[A-Z])[A-Z][A-Z0-9_]+$/

/** The identifier is the first thing on its line. */
const LINE_START = /(^|\n)[ \t]*$/
/**
 * …and an assignment follows it. `=` but not `==`, plus the compound forms.
 *
 * This is the one place a bare identifier does get colour, and it is not a
 * guess: a name being assigned to IS a variable binding. Keyword arguments
 * (`f(frozen=True)`) cannot reach here — grammars scope those as `params`, and
 * this pass only ever sees unscoped text.
 */
const ASSIGNED = /^[ \t]*(?:\*\*|\/\/|>>|<<|[+\-*/%&|^])?=(?!=)/

export function shouldEnrich(language: string | undefined): boolean {
  return !!language && !SKIP_LANGUAGES.has(language.toLowerCase())
}

/**
 * Split unscoped `text` into segments, classifying what can be recognised from
 * shape alone.
 *
 *   `foo(`   → a call        → title.function.invoke
 *   `.foo`   → a member      → property
 *   `FOO_BAR`→ a constant    → variable.constant
 *   `+= -> ` → an operator   → operator
 *
 * Class names follow hljs's own tiered-scope spelling (underscores counting up
 * with depth) so the shared stylesheet matches these exactly as it matches
 * hljs's own output.
 */
export function enrichUnscoped(text: string): EnrichedSegment[] {
  const out: EnrichedSegment[] = []
  let last = 0
  TOKEN.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(text)) !== null) {
    const tok = m[0]
    const start = m.index
    let classes: string[] | null = null

    if (tok.startsWith('&')) {
      // An escaped operator, or an entity we pass through untouched.
      classes = OPERATOR_ENTITIES.has(tok) ? ['hljs-operator'] : null
    } else if (/^[A-Za-z_$]/.test(tok)) {
      const after = text.slice(start + tok.length)
      const before = text.slice(0, start)
      if (/^\s*\(/.test(after)) {
        classes = ['hljs-title', 'function_', 'invoke__']
      } else if (/\.\s*$/.test(before) && !/\d\s*\.\s*$/.test(before)) {
        // A member access — but not the fractional part of a number, which
        // some grammars leave unscoped.
        classes = ['hljs-property']
      } else if (SCREAMING_CASE.test(tok)) {
        classes = ['hljs-variable', 'constant_']
      } else if (LINE_START.test(before) && ASSIGNED.test(after)) {
        classes = ['hljs-variable']
      }
    } else {
      classes = ['hljs-operator']
    }

    if (classes) {
      if (start > last) out.push({ text: text.slice(last, start), classes: [] })
      out.push({ text: tok, classes })
      last = start + tok.length
    }
  }

  if (last < text.length) out.push({ text: text.slice(last), classes: [] })
  return out.length > 0 ? out : [{ text, classes: [] }]
}

/**
 * Apply the same pass to hljs's HTML output.
 *
 * Export, print and AI chat render through `hljs.highlight().value` instead of
 * decorations. Enriching only the editor would put the two surfaces back out of
 * step — the same class of divergence that let a rule match the editor but not
 * an exported document — so both go through `enrichUnscoped`.
 *
 * Depth tracking is what makes this safe: text at depth 0 is outside every
 * `<span class="hljs-…">`, i.e. exactly the text the grammar declined to scope.
 * The HTML is hljs's own, so it is well-formed and already entity-escaped;
 * segments are re-emitted verbatim without re-escaping.
 */
export function enrichHighlightedHtml(html: string): string {
  let out = ''
  let depth = 0
  let i = 0

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i)
      if (end === -1) {
        out += html.slice(i)
        break
      }
      const tag = html.slice(i, end + 1)
      depth += tag.startsWith('</') ? -1 : 1
      out += tag
      i = end + 1
      continue
    }

    let j = i
    while (j < html.length && html[j] !== '<') j++
    const text = html.slice(i, j)
    i = j

    if (depth > 0 || !text.trim()) {
      out += text
      continue
    }
    for (const seg of enrichUnscoped(text)) {
      out += seg.classes.length
        ? `<span class="${seg.classes.join(' ')}">${seg.text}</span>`
        : seg.text
    }
  }

  return out
}
