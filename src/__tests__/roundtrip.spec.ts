// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Roundtrip CI gate (v0.60.0-pre §4.2):
 *   serialize(parse(serialize(parse(x)))) === serialize(parse(x))
 *
 * Allows first-pass normalization (e.g. `_em_` → `*em*`) but the second
 * roundtrip must be byte-identical.
 */
import { describe, test, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '../markdown'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Test helper: __dirname equivalent for ESM. This file runs under vitest+node,
// not in browser bundle (which is the primary target).
const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, 'fixtures')

const fixtureFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.md'))
  .sort()

describe('roundtrip stability', () => {
  for (const file of fixtureFiles) {
    test(`${file}: second roundtrip is byte-stable`, () => {
      const content = readFileSync(join(fixturesDir, file), 'utf-8')

      const doc1 = parseMarkdown(content)
      const md1 = serializeMarkdown(doc1)

      const doc2 = parseMarkdown(md1)
      const md2 = serializeMarkdown(doc2)

      expect(md2).toBe(md1)
    })
  }
})

describe('roundtrip data traps (§4.4)', () => {
  test('inline code preserves `backticks` correctly', () => {
    const input = 'Use `const x = 1` syntax.\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('`const x = 1`')
  })

  test('image with alt and src is preserved', () => {
    const input = '![alt](https://example.com/img.png)\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('![alt](https://example.com/img.png)')
  })

  test('link with title is preserved including title', () => {
    const input = '[Moraya](https://moraya.app "Moraya site")\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('https://moraya.app')
    expect(out).toContain('Moraya site')
  })

  test('fenced code block language identifier is preserved (no case mutation)', () => {
    const input = '```Go\npackage main\n```\n'
    const out = serializeMarkdown(parseMarkdown(input))
    // §4.6 absolute prohibition: no case mutation of language identifier
    expect(out).toMatch(/```Go\b/)
  })

  test('headings of all 6 levels round-trip', () => {
    const input = '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toMatch(/^# H1$/m)
    expect(out).toMatch(/^## H2$/m)
    expect(out).toMatch(/^### H3$/m)
    expect(out).toMatch(/^#### H4$/m)
    expect(out).toMatch(/^##### H5$/m)
    expect(out).toMatch(/^###### H6$/m)
  })

  test('horizontal rule is preserved', () => {
    const input = 'Above\n\n---\n\nBelow\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('---')
  })

  test('blockquote round-trips', () => {
    const input = '> Quoted text\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toMatch(/^> /m)
  })

  test('strikethrough round-trips', () => {
    const input = '~~deleted~~\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('~~deleted~~')
  })
})

describe('§4.4 schema-critical data traps', () => {
  test('block math $$..$$ must not degrade to inline $..$', () => {
    const input = '$$\nE = mc^2\n$$\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('$$')
    // After roundtrip, the energy formula should remain in a $$ block, not collapse
    // to a single $E = mc^2$ inline expression on a single line.
    expect(out).not.toMatch(/^[^$\n]*\$E = mc\^2\$[^$\n]*$/)
  })

  test('raw HTML <font> tag preserved verbatim (not converted to markdown)', () => {
    const input = '<font color="red">important</font>\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('<font color="red">')
    expect(out).toContain('</font>')
    expect(out).toContain('important')
  })

  test('paired raw HTML inline tags round-trip with html_mark', () => {
    const input = 'Text with <sub>subscript</sub> in line.\n'
    const out = serializeMarkdown(parseMarkdown(input))
    // Second pass must be byte-stable
    const out2 = serializeMarkdown(parseMarkdown(out))
    expect(out2).toBe(out)
    expect(out2).toContain('<sub>')
    expect(out2).toContain('</sub>')
  })

  test('GFM table preserves header row separately from data rows (table_header_row fix)', () => {
    const input = '| H1 | H2 |\n| --- | --- |\n| a | b |\n'
    const doc = parseMarkdown(input)
    // Find the table node and confirm first child is table_header_row, second is table_row
    let table: import('prosemirror-model').Node | undefined
    doc.descendants((n) => {
      if (n.type.name === 'table') { table = n; return false }
      return undefined
    })
    expect(table).toBeDefined()
    expect(table!.firstChild!.type.name).toBe('table_header_row')
    expect(table!.firstChild!.childCount).toBe(2) // 2 header cells
    expect(table!.child(1).type.name).toBe('table_row')
  })

  test('GFM table cells use paragraph-wrapped content (not bare text)', () => {
    const input = '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    const doc = parseMarkdown(input)
    let firstHeaderCell: import('prosemirror-model').Node | undefined
    doc.descendants((n) => {
      if (n.type.name === 'table_header' && !firstHeaderCell) {
        firstHeaderCell = n
        return false
      }
      return undefined
    })
    expect(firstHeaderCell).toBeDefined()
    // Schema requires `paragraph+` in cells; a successful parse means the cell isn't empty
    expect(firstHeaderCell!.firstChild!.type.name).toBe('paragraph')
    expect(firstHeaderCell!.firstChild!.textContent).toBe('A')
  })

  test('task list checkbox attrs are recovered from inline content', () => {
    const input = '- [x] done\n- [ ] todo\n'
    const doc = parseMarkdown(input)
    const items: import('prosemirror-model').Node[] = []
    doc.descendants((n) => {
      if (n.type.name === 'list_item') items.push(n)
      return undefined
    })
    expect(items.length).toBe(2)
    expect(items[0]!.attrs.checked).toBe(true)
    expect(items[1]!.attrs.checked).toBe(false)
    // The `[x]` / `[ ]` literal should have been stripped from the rendered text
    expect(items[0]!.textContent).toBe('done')
    expect(items[1]!.textContent).toBe('todo')
  })

  test('definition list parses to defList / defListTerm / defListDescription', () => {
    const input = 'Term\n:   Definition.\n'
    const doc = parseMarkdown(input)
    let defList: import('prosemirror-model').Node | undefined
    doc.descendants((n) => {
      if (n.type.name === 'defList') { defList = n; return false }
      return undefined
    })
    expect(defList).toBeDefined()
    expect(defList!.firstChild!.type.name).toBe('defListTerm')
  })
})

describe('§4.6 first-pass normalization whitelist', () => {
  test('`_em_` is normalized to `*em*` on first roundtrip', () => {
    const input = '_italic_\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('*italic*')
    // Second roundtrip must be byte-stable
    const out2 = serializeMarkdown(parseMarkdown(out))
    expect(out2).toBe(out)
  })

  test('`__strong__` is normalized to `**strong**` on first roundtrip', () => {
    const input = '__bold__\n'
    const out = serializeMarkdown(parseMarkdown(input))
    expect(out).toContain('**bold**')
    const out2 = serializeMarkdown(parseMarkdown(out))
    expect(out2).toBe(out)
  })
})
