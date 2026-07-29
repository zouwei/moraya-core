// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  parseTemplateIndex,
  templateCategories,
  filterTemplates,
  compareVersions,
  templatePackageUrl,
  templateThumbnailUrl,
  templateImportSpec,
} from '../templates'

/** An index entry shaped exactly like the published registry's. */
function entry(over: Record<string, unknown> = {}) {
  return {
    name: 'charged-ieee',
    version: '0.1.4',
    description: 'An IEEE-style paper template',
    categories: ['paper'],
    keywords: ['IEEE', 'conference'],
    template: { path: 'template', entrypoint: 'main.typ', thumbnail: 'thumbnail.png' },
    ...over,
  }
}

describe('parseTemplateIndex', () => {
  it('reads a template entry', () => {
    const [t] = parseTemplateIndex([entry()])
    expect(t).toMatchObject({
      name: 'charged-ieee',
      version: '0.1.4',
      path: 'template',
      entrypoint: 'main.typ',
      thumbnail: 'thumbnail.png',
    })
  })

  it('ignores packages that are not templates', () => {
    // Most of the registry is libraries — 4404 packages, 749 templates.
    expect(parseTemplateIndex([{ name: 'cetz', version: '0.2.2' }])).toEqual([])
  })

  it('keeps only the newest version of a package', () => {
    // The index lists every version ever published.
    const list = parseTemplateIndex([
      entry({ version: '0.1.0' }),
      entry({ version: '0.1.4' }),
      entry({ version: '0.1.2' }),
    ])
    expect(list).toHaveLength(1)
    expect(list[0]?.version).toBe('0.1.4')
  })

  it('compares versions numerically, not as strings', () => {
    const list = parseTemplateIndex([entry({ version: '0.9.0' }), entry({ version: '0.10.0' })])
    expect(list[0]?.version).toBe('0.10.0')
  })

  it('strips a trailing slash from the template path', () => {
    // Both `template` and `template/` appear in the real index.
    const [t] = parseTemplateIndex([entry({ template: { path: 'template/', entrypoint: 'main.typ' } })])
    expect(t?.path).toBe('template')
  })

  it('keeps an entrypoint that is not main.typ', () => {
    // 561 of 749 use main.typ; the rest use thesis.typ, cv.typ, slides.typ…
    const [t] = parseTemplateIndex([entry({ template: { path: 'src', entrypoint: 'thesis.typ' } })])
    expect(t).toMatchObject({ path: 'src', entrypoint: 'thesis.typ' })
  })

  it('omits the thumbnail when the template has none', () => {
    const [t] = parseTemplateIndex([entry({ template: { path: 'template', entrypoint: 'main.typ' } })])
    expect(t?.thumbnail).toBeUndefined()
  })

  it('skips a malformed entry instead of dropping the whole index', () => {
    // One bad publish must not hide the other 748.
    const list = parseTemplateIndex([
      { template: { path: 'template', entrypoint: 'main.typ' } }, // no name
      entry({ template: { path: 'template' } }), // no entrypoint
      entry({ name: 'good' }),
    ])
    expect(list.map((t) => t.name)).toEqual(['good'])
  })

  it('returns an empty list for input that is not an index', () => {
    expect(parseTemplateIndex(null)).toEqual([])
    expect(parseTemplateIndex({ data: [] })).toEqual([])
  })

  it('sorts by name so the picker order is stable', () => {
    const list = parseTemplateIndex([entry({ name: 'zeta' }), entry({ name: 'alpha' })])
    expect(list.map((t) => t.name)).toEqual(['alpha', 'zeta'])
  })
})

describe('compareVersions', () => {
  it('orders by numeric component', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0)
  })

  it('treats a missing component as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})

describe('templateCategories', () => {
  it('counts and orders by population', () => {
    const list = parseTemplateIndex([
      entry({ name: 'a', categories: ['paper'] }),
      entry({ name: 'b', categories: ['thesis'] }),
      entry({ name: 'c', categories: ['thesis'] }),
    ])
    expect(templateCategories(list)).toEqual([
      { name: 'thesis', count: 2 },
      { name: 'paper', count: 1 },
    ])
  })

  it('counts a template in each of its categories', () => {
    const list = parseTemplateIndex([entry({ categories: ['paper', 'report'] })])
    expect(templateCategories(list).map((c) => c.name).sort()).toEqual(['paper', 'report'])
  })
})

describe('filterTemplates', () => {
  const list = parseTemplateIndex([
    entry({ name: 'charged-ieee', categories: ['paper'], keywords: ['IEEE'], description: 'IEEE paper' }),
    entry({ name: 'modern-cv', categories: ['cv'], keywords: ['resume'], description: 'A CV' }),
    entry({ name: 'thesis-book', categories: ['thesis'], keywords: [], description: 'Mentions ieee in prose' }),
  ])

  it('returns everything with no filter', () => {
    expect(filterTemplates(list)).toHaveLength(3)
  })

  it('filters by category', () => {
    expect(filterTemplates(list, { category: 'cv' }).map((t) => t.name)).toEqual(['modern-cv'])
  })

  it('searches name, description and keywords', () => {
    expect(filterTemplates(list, { query: 'resume' }).map((t) => t.name)).toEqual(['modern-cv'])
  })

  it('is case-insensitive', () => {
    expect(filterTemplates(list, { query: 'IEEE' }).length).toBe(2)
  })

  it('ranks a name match above a prose match', () => {
    // Typing "ieee" wants the IEEE template, not everything mentioning it.
    expect(filterTemplates(list, { query: 'ieee' })[0]?.name).toBe('charged-ieee')
  })

  it('combines query and category', () => {
    expect(filterTemplates(list, { query: 'ieee', category: 'thesis' }).map((t) => t.name)).toEqual([
      'thesis-book',
    ])
  })
})

describe('urls', () => {
  const [t] = parseTemplateIndex([entry()])

  it('builds the package archive url the compiler also uses', () => {
    expect(templatePackageUrl(t!)).toBe(
      'https://packages.typst.org/preview/charged-ieee-0.1.4.tar.gz',
    )
  })

  it('builds the thumbnail url', () => {
    expect(templateThumbnailUrl(t!)).toBe(
      'https://packages.typst.org/preview/thumbnails/charged-ieee-0.1.4.webp',
    )
  })

  it('has no thumbnail url when the template ships none', () => {
    const [bare] = parseTemplateIndex([entry({ template: { path: 'template', entrypoint: 'main.typ' } })])
    expect(templateThumbnailUrl(bare!)).toBeNull()
  })

  it('builds the import spec a scaffold uses', () => {
    expect(templateImportSpec(t!)).toBe('@preview/charged-ieee:0.1.4')
  })
})
