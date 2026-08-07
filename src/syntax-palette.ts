// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * The shared code-block syntax palette — one source of truth for every surface
 * that renders highlighted code: the editor (desktop / web / mobile), AI chat
 * bubbles, PDF & print, long-image export and standalone HTML export.
 *
 * Before this module each consumer owned its own colours, with the result that
 * only the desktop editor was actually coloured at all: web defined eight
 * `--color-code-*` variables that no rule ever read, mobile inherited that, and
 * chat / print / image export emitted `hljs-*` classes with no stylesheet
 * behind them. HTML export pulled a theme off a CDN.
 *
 * Two deliberate constraints:
 *
 *   1. **Semantic groups, not per-token knobs.** Thirteen variables named for
 *      what they mean, rather than one per hljs class. The old desktop palette
 *      had 34 and several were unreachable; a smaller vocabulary is easier to
 *      keep coherent and to override.
 *   2. **Fixed light/dark, independent of the host's UI theme.** Legible code
 *      depends on calibrated intervals between these colours; deriving them
 *      from whatever accent the user picked collapses those intervals, and
 *      makes cross-platform parity impossible to guarantee.
 *
 * `styles/plugins/syntax.css` is GENERATED from this file — run
 * `node scripts/gen-syntax-css.mjs` after editing, and `syntax-palette.spec.ts`
 * fails if the checked-in file has drifted.
 */

/** The colour roles a diagram of tokens maps onto. */
export interface SyntaxPalette {
  /** Comments and block quotes. Rendered italic. */
  comment: string
  /** Keywords, type-selectors, operators. */
  keyword: string
  /** Strings, regexes, doc tags, attribute values. */
  string: string
  /** Numbers, literals, types, escapes — anything with a fixed value. */
  constant: string
  /** Things the author named: functions, classes, decorators, annotations. */
  identifier: string
  /** Things the language named: built-ins, variables, interpolation. */
  builtin: string
  /** Markup tags and CSS selectors. */
  tag: string
  /** Code that carries no token colour: parameters, punctuation, plain text. */
  body: string
  /** Links in markup languages. Rendered underlined. */
  link: string
  added: string
  addedBg: string
  removed: string
  removedBg: string
}

/** GitHub Primer, light. */
export const SYNTAX_LIGHT: SyntaxPalette = {
  comment: '#59636e',
  keyword: '#cf222e',
  string: '#0a3069',
  constant: '#0550ae',
  identifier: '#8250df',
  builtin: '#953800',
  tag: '#116329',
  body: '#1f2328',
  link: '#0969da',
  added: '#116329',
  addedBg: 'rgba(17, 99, 41, 0.08)',
  removed: '#82071e',
  removedBg: 'rgba(130, 7, 30, 0.08)',
}

/** GitHub Primer, dark. */
export const SYNTAX_DARK: SyntaxPalette = {
  comment: '#9198a1',
  keyword: '#ff7b72',
  string: '#a5d6ff',
  constant: '#79c0ff',
  identifier: '#d2a8ff',
  builtin: '#ffa657',
  tag: '#7ee787',
  body: '#e6edf3',
  link: '#4493f8',
  added: '#7ee787',
  addedBg: 'rgba(46, 160, 67, 0.15)',
  removed: '#ffa198',
  removedBg: 'rgba(248, 81, 73, 0.15)',
}

/** CSS custom property name for each role. */
const VAR: Record<keyof SyntaxPalette, string> = {
  comment: '--hljs-comment',
  keyword: '--hljs-keyword',
  string: '--hljs-string',
  constant: '--hljs-constant',
  identifier: '--hljs-identifier',
  builtin: '--hljs-builtin',
  tag: '--hljs-tag',
  body: '--hljs-body',
  link: '--hljs-link',
  added: '--hljs-added',
  addedBg: '--hljs-added-bg',
  removed: '--hljs-removed',
  removedBg: '--hljs-removed-bg',
}

const ROLES = Object.keys(VAR) as (keyof SyntaxPalette)[]

/** `--hljs-x: value;` declarations for a palette, one per line. */
export function syntaxVars(palette: SyntaxPalette, indent = '  '): string {
  return ROLES.map((r) => `${indent}${VAR[r]}: ${palette[r]};`).join('\n')
}

/**
 * The same declarations as one line, for a `style` attribute.
 *
 * Export containers pin light values so a document authored in dark mode does
 * not screenshot as dark tokens on a forced-white page.
 */
export function syntaxVarsInline(palette: SyntaxPalette): string {
  return ROLES.map((r) => `${VAR[r]}:${palette[r]};`).join('')
}

/**
 * Which hljs classes take which role.
 *
 * Selectors are GLOBAL on purpose. The desktop rules used to be scoped to
 * `.moraya-editor pre`, which is precisely why chat bubbles, the print route
 * and image export rendered monochrome — they emit the same classes outside
 * that container. `hljs-` is already a namespace; upstream themes scope this
 * way too.
 *
 * Compound classes come from hljs's scope splitting (`core.js` scopeToCSSClass):
 * `title.function` → `hljs-title function_`, and each further piece gains one
 * more underscore, so `title.class.inherited` → `hljs-title class_ inherited__`.
 * The desktop stylesheet wrote `inherited_` and therefore never matched.
 *
 * ORDER IS LOAD-BEARING — containers first, leaves last.
 *
 * The stylesheet has to serve two different markups. Export, print and chat get
 * hljs's real HTML, where scopes NEST: `<span class="hljs-params">…<span
 * class="hljs-built_in">int</span></span>`, so each element matches one rule and
 * order is irrelevant. The editor gets ProseMirror decorations, which FLATTEN
 * that nesting onto a single element: `class="hljs-params hljs-built_in"`. Both
 * rules then hit the same element at equal specificity, and the one written
 * later wins.
 *
 * So a role that can CONTAIN another must be declared before it. `meta` wraps
 * `params` wraps `literal` (a decorator's arguments); `string` wraps `subst` and
 * `char.escape`. Getting this backwards is not a subtle tint difference — it
 * paints Python's `int` parameter-coloured instead of built-in-coloured.
 */
const GROUPS: { role: keyof SyntaxPalette; selectors: string[]; extra?: string }[] = [
  {
    role: 'comment',
    selectors: ['.hljs-comment', '.hljs-quote'],
    extra: 'font-style: italic;',
  },
  {
    // Container: a decorator wraps its own parentheses and arguments.
    // Decorators, annotations and preprocessor directives used to take the
    // comment colour, which made a Python decorator read as a comment.
    role: 'identifier',
    selectors: [
      '.hljs-title',
      '.hljs-title.function_',
      '.hljs-title.class_',
      '.hljs-title.class_.inherited__',
      '.hljs-function',
      '.hljs-class',
      '.hljs-meta',
    ],
  },
  {
    // Container: a signature wraps the types and defaults inside it.
    // Parameters are deliberately uncoloured — GitHub does not tint them, and
    // the old orange made every signature the loudest line on screen.
    role: 'body',
    selectors: ['.hljs-params', '.hljs-punctuation'],
  },
  {
    // Container: a string wraps its interpolations and escapes.
    role: 'string',
    selectors: [
      '.hljs-string',
      '.hljs-attribute',
      '.hljs-regexp',
      // Clojure and Elixir name the scope `regex`, not `regexp`. The desktop
      // stylesheet only had the latter, so their regexes were plain text.
      '.hljs-regex',
      '.hljs-doctag',
      '.hljs-template-tag',
      '.hljs-template-variable',
    ],
  },
  {
    role: 'tag',
    selectors: [
      '.hljs-tag',
      '.hljs-name',
      '.hljs-selector-class',
      '.hljs-selector-id',
      '.hljs-selector-pseudo',
      '.hljs-selector-attr',
    ],
  },
  {
    role: 'keyword',
    selectors: ['.hljs-keyword', '.hljs-selector-tag', '.hljs-operator'],
  },
  {
    // Leaves.
    role: 'constant',
    selectors: [
      '.hljs-number',
      '.hljs-literal',
      '.hljs-symbol',
      '.hljs-type',
      '.hljs-attr',
      '.hljs-property',
      '.hljs-variable.constant_',
      '.hljs-section',
      // Nested inside `.hljs-string`, so without a rule of its own an escape
      // sequence is invisible against the string around it.
      '.hljs-char.escape_',
    ],
  },
  {
    // Leaves.
    role: 'builtin',
    selectors: [
      '.hljs-built_in',
      '.hljs-variable',
      '.hljs-variable.language_',
      '.hljs-subst',
      '.hljs-bullet',
      '.hljs-code',
      '.hljs-character',
    ],
  },
  {
    role: 'link',
    selectors: ['.hljs-link'],
    extra: 'text-decoration: underline;',
  },
]

/**
 * The token rules.
 *
 * @param resolve maps a role to the value written into the rule — a
 * `var(--hljs-…)` reference for the stylesheet, a literal hex for exported
 * HTML that ships without our variables.
 */
export function syntaxRules(resolve: (role: keyof SyntaxPalette) => string): string {
  const blocks = GROUPS.map((g) => {
    const body = [`color: ${resolve(g.role)};`, g.extra].filter(Boolean).join(' ')
    return `${g.selectors.join(',\n')} { ${body} }`
  })
  // A decorator stays one colour even where the grammar marks its head as a
  // keyword (`#include`, `@interface`). Two selectors for the two markups:
  // the descendant form for hljs's nested HTML, the compound form for the
  // editor's flattened decorations. Both outrank the bare `.hljs-keyword`.
  blocks.push(
    `.hljs-meta .hljs-keyword,\n.hljs-meta.hljs-keyword { color: ${resolve('identifier')}; }`,
  )
  blocks.push(`.hljs-section { font-weight: 600; }`)
  blocks.push(
    `.hljs-addition { color: ${resolve('added')}; background: ${resolve('addedBg')}; }`,
  )
  blocks.push(
    `.hljs-deletion { color: ${resolve('removed')}; background: ${resolve('removedBg')}; }`,
  )
  blocks.push(`.hljs-emphasis { font-style: italic; }`)
  blocks.push(`.hljs-strong { font-weight: 600; }`)
  return blocks.join('\n\n')
}

/** Self-contained CSS for exported documents, which have no `--hljs-*` set. */
export function syntaxCssLiteral(palette: SyntaxPalette): string {
  return syntaxRules((role) => palette[role])
}

/** The full generated contents of `styles/plugins/syntax.css`. */
export function syntaxStylesheet(): string {
  return `/*
 * @moraya/core — code-block syntax palette (GitHub Primer).
 *
 * GENERATED from src/syntax-palette.ts by scripts/gen-syntax-css.mjs.
 * Do not edit by hand; syntax-palette.spec.ts fails when this drifts.
 *
 *     import '@moraya/core/plugins/syntax.css'
 *
 * Import it wherever highlighted code is rendered — not only the editor. The
 * selectors below are global because the same \`hljs-*\` classes appear in AI
 * chat bubbles, the print route and export containers; scoping them to the
 * editor is what left those surfaces monochrome.
 *
 * Colours are fixed per appearance and do NOT follow the host's UI theme, so
 * desktop, web and mobile render code identically. Override a semantic role
 * (not individual tokens) if a host really must differ.
 */

:root {
${syntaxVars(SYNTAX_LIGHT)}
}

[data-theme='dark'] {
${syntaxVars(SYNTAX_DARK)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${syntaxVars(SYNTAX_DARK, '    ')}
  }
}

${syntaxRules((role) => `var(${VAR[role]})`)}
`
}
