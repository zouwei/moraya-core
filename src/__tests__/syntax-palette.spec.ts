// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  SYNTAX_LIGHT,
  SYNTAX_DARK,
  syntaxStylesheet,
  syntaxCssLiteral,
  syntaxRules,
  syntaxVarsInline,
} from '../syntax-palette'
import { LIGHT_THEME_VARS } from '../export/types'
import { scopeToClasses } from '../plugins/highlight'

const here = dirname(fileURLToPath(import.meta.url))
const CSS_PATH = resolve(here, '../styles/plugins/syntax.css')
const css = readFileSync(CSS_PATH, 'utf8')

describe('syntax.css', () => {
  it('matches what the palette generates', () => {
    // Regenerate with `node scripts/gen-syntax-css.mjs` when this fails.
    expect(css).toBe(syntaxStylesheet())
  })

  it('scopes nothing to the editor', () => {
    // The desktop rules used to live under `.moraya-editor pre`, which is why
    // chat bubbles, the print route and export containers rendered monochrome.
    expect(css).not.toContain('.moraya-editor')
    expect(css).not.toContain('pre .hljs-')
  })

  it('ships both appearances', () => {
    expect(css).toContain(`--hljs-keyword: ${SYNTAX_LIGHT.keyword}`)
    expect(css).toContain(`--hljs-keyword: ${SYNTAX_DARK.keyword}`)
    expect(css).toContain("[data-theme='dark']")
    expect(css).toContain('prefers-color-scheme: dark')
  })
})

describe('token coverage', () => {
  const rules = syntaxRules((r) => r)

  it('matches inherited base classes, with both underscores', () => {
    // `title.class.inherited` spells out as `hljs-title class_ inherited__`.
    // One underscore is the old decoration-path spelling, which no longer
    // exists now that both paths follow hljs — a rule for it would be dead.
    expect(rules).toContain('.hljs-title.class_.inherited__')
    expect(rules).not.toMatch(/inherited_(?!_)/)
  })

  it('colors escape sequences apart from their string', () => {
    // Nested inside .hljs-string, so with no rule an escape is invisible.
    expect(rules).toContain('.hljs-char.escape_')
  })

  it('colors both spellings of the regex scope', () => {
    // Clojure and Elixir emit `regex`; everything else emits `regexp`.
    expect(rules).toContain('.hljs-regexp')
    expect(rules).toContain('.hljs-regex,')
  })

  it('gives decorators the identifier color, not the comment color', () => {
    const meta = rules.split('\n\n').find((b) => b.includes('.hljs-meta'))
    expect(meta).toContain('identifier')
    expect(meta).not.toContain('comment')
  })

  it('keeps a decorator one color even when its head is a keyword', () => {
    // Descendant form for hljs's nested HTML, compound form for the editor's
    // flattened decorations.
    expect(rules).toContain('.hljs-meta .hljs-keyword')
    expect(rules).toContain('.hljs-meta.hljs-keyword')
  })

  describe('container roles are declared before the roles they can wrap', () => {
    // The editor renders highlighting as ProseMirror decorations, which flatten
    // hljs's nesting onto one element (`class="hljs-params hljs-built_in"`).
    // Equal specificity then makes source order decide, so a container written
    // after its contents repaints them — this ordering is behaviour, not style.
    const at = (needle: string) => rules.indexOf(needle)
    const wraps: [string, string][] = [
      ['.hljs-meta', '.hljs-params'],
      ['.hljs-params', '.hljs-built_in'],
      ['.hljs-params', '.hljs-literal'],
      ['.hljs-string', '.hljs-subst'],
      ['.hljs-string', '.hljs-char.escape_'],
    ]
    for (const [container, inner] of wraps) {
      it(`${container} before ${inner}`, () => {
        expect(at(container)).toBeGreaterThanOrEqual(0)
        expect(at(inner)).toBeGreaterThan(at(container))
      })
    }
  })

  it('leaves parameters at body color', () => {
    const params = rules.split('\n\n').find((b) => b.includes('.hljs-params'))
    expect(params).toContain('body')
  })

  it('covers every class the highlight plugin can emit for our languages', () => {
    for (const cls of [
      'comment', 'quote', 'keyword', 'selector-tag', 'operator', 'string',
      'attribute', 'doctag', 'number', 'literal', 'symbol', 'type', 'attr',
      'property', 'section', 'title', 'function', 'class', 'meta', 'built_in',
      'variable', 'subst', 'bullet', 'code', 'character', 'tag', 'name',
      'selector-class', 'selector-id', 'selector-pseudo', 'selector-attr',
      'params', 'punctuation', 'link', 'addition', 'deletion', 'emphasis', 'strong',
    ]) {
      expect(rules, `missing .hljs-${cls}`).toContain(`.hljs-${cls}`)
    }
  })
})

describe('the editor and hljs agree on class names', () => {
  // The editor highlights with ProseMirror decorations; export, print and chat
  // use hljs's own HTML. One stylesheet serves both, so both must spell a
  // tiered scope the same way. They did not: hljs counts underscores up with
  // depth, the decoration path used to emit exactly one at every depth, so a
  // rule for a three-part scope could only ever match one of the two surfaces.
  const hljsWay = (scope: string) => {
    const pieces = scope.split('.')
    return [`hljs-${pieces.shift()}`, ...pieces.map((x, i) => x + '_'.repeat(i + 1))]
  }

  for (const scope of [
    'keyword',
    'title.function',
    'title.class',
    'variable.language',
    'variable.constant',
    'char.escape',
    'meta.prompt',
    'title.class.inherited',
    'title.function.invoke',
  ]) {
    it(`${scope}`, () => {
      expect(scopeToClasses(scope)).toEqual(hljsWay(scope))
    })
  }
})

describe('export path', () => {
  const exported = syntaxCssLiteral(SYNTAX_LIGHT)

  it('inlines literal colors, never a CDN or a variable', () => {
    // An exported document carries none of our custom properties, and used to
    // link highlight.js's own theme off jsdelivr — so it needed the network.
    expect(exported).toContain(SYNTAX_LIGHT.keyword)
    expect(exported).not.toContain('var(--')
    expect(exported).not.toContain('http')
  })

  it('pins light tokens on capture containers', () => {
    // Otherwise a dark-mode document screenshots as dark tokens on white.
    expect(LIGHT_THEME_VARS).toContain(syntaxVarsInline(SYNTAX_LIGHT))
    expect(LIGHT_THEME_VARS).toContain(`--hljs-comment:${SYNTAX_LIGHT.comment}`)
  })
})

describe('palette shape', () => {
  it('defines the same roles in both appearances', () => {
    expect(Object.keys(SYNTAX_DARK).sort()).toEqual(Object.keys(SYNTAX_LIGHT).sort())
  })

  it('differs on every role, so neither appearance is a partial copy', () => {
    for (const role of Object.keys(SYNTAX_LIGHT) as (keyof typeof SYNTAX_LIGHT)[]) {
      expect(SYNTAX_DARK[role], role).not.toBe(SYNTAX_LIGHT[role])
    }
  })
})
