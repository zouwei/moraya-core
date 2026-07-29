// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Typst Universe template index.
 *
 * The official registry publishes one JSON index of every published package
 * (https://packages.typst.org/preview/index.json). Templates are the entries
 * carrying a `template` block — 749 of 4404 packages at the time of writing.
 *
 * Parsing and filtering live here because desktop and web both need the same
 * answer to "which templates exist and what are they called"; only *fetching*
 * and *scaffolding* differ per platform (desktop shells out to `typst init`,
 * the browser downloads and unpacks the archive itself).
 *
 * Everything below is pure: no fetch, no DOM, no platform assumptions.
 */

/** A template as the picker needs it — the index's fields, normalized. */
export interface TypstTemplate {
  name: string
  version: string
  description: string
  /** e.g. `paper`, `thesis`, `cv`. Registry-assigned; never empty in practice. */
  categories: string[]
  keywords: string[]
  /** Directory inside the package holding the scaffold, without a trailing slash. */
  path: string
  /** File inside `path` the user opens. NOT always `main.typ`. */
  entrypoint: string
  /** Thumbnail file name inside the package, when the template ships one. */
  thumbnail?: string
}

/** Raw index entry, as published. Only the fields this module reads. */
interface RawEntry {
  name?: unknown
  version?: unknown
  description?: unknown
  categories?: unknown
  keywords?: unknown
  template?: { path?: unknown; entrypoint?: unknown; thumbnail?: unknown }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Compare two `x.y.z` versions numerically. `0.10.0` is newer than `0.9.0`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Read the registry index into the templates a picker can show.
 *
 * Keeps only the newest version of each package: the index lists every version
 * ever published (2156 template entries for 749 packages), and a picker showing
 * five versions of the same template is noise.
 *
 * Never throws — a malformed index yields an empty list rather than breaking
 * the picker. Individual entries missing a name or entrypoint are skipped for
 * the same reason: one bad publish should not hide the other 748.
 */
export function parseTemplateIndex(json: unknown): TypstTemplate[] {
  if (!Array.isArray(json)) return []

  const newest = new Map<string, TypstTemplate>()
  for (const raw of json as RawEntry[]) {
    if (!raw || typeof raw !== 'object' || !raw.template) continue

    const name = str(raw.name)
    const version = str(raw.version)
    // `path` appears both as `template` and `template/` in the real index.
    const path = str(raw.template.path).replace(/\/+$/, '')
    const entrypoint = str(raw.template.entrypoint)
    if (!name || !version || !path || !entrypoint) continue

    const existing = newest.get(name)
    if (existing && compareVersions(existing.version, version) >= 0) continue

    const thumbnail = str(raw.template.thumbnail)
    newest.set(name, {
      name,
      version,
      description: str(raw.description),
      categories: strList(raw.categories),
      keywords: strList(raw.keywords),
      path,
      entrypoint,
      ...(thumbnail ? { thumbnail } : {}),
    })
  }

  return [...newest.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** How many templates each category holds, most populous first. */
export function templateCategories(templates: TypstTemplate[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of templates) {
    for (const c of t.categories) counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export interface TemplateFilter {
  /** Free text, matched against name, description and keywords. */
  query?: string
  /** Exact category, as returned by `templateCategories`. */
  category?: string
}

/**
 * Narrow the list for the picker.
 *
 * Name matches rank above description/keyword matches: someone typing "ieee"
 * wants the IEEE templates first, not every paper template that mentions IEEE
 * in prose.
 */
export function filterTemplates(
  templates: TypstTemplate[],
  filter: TemplateFilter = {},
): TypstTemplate[] {
  const query = (filter.query ?? '').trim().toLowerCase()
  const category = filter.category

  const matched = templates.filter((t) => {
    if (category && !t.categories.includes(category)) return false
    if (!query) return true
    return (
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query) ||
      t.keywords.some((k) => k.toLowerCase().includes(query))
    )
  })

  if (!query) return matched
  return matched.sort((a, b) => {
    const an = a.name.toLowerCase().includes(query) ? 0 : 1
    const bn = b.name.toLowerCase().includes(query) ? 0 : 1
    return an - bn || a.name.localeCompare(b.name)
  })
}

/* -------------------------------------------------------------------- urls */

const REGISTRY = 'https://packages.typst.org/preview'

/** Package archive (`.tar.gz`). Same URL the compiler's own registry uses. */
export function templatePackageUrl(t: Pick<TypstTemplate, 'name' | 'version'>): string {
  return `${REGISTRY}/${t.name}-${t.version}.tar.gz`
}

/** Preview image the registry renders for the template, if it has one. */
export function templateThumbnailUrl(t: TypstTemplate): string | null {
  return t.thumbnail ? `${REGISTRY}/thumbnails/${t.name}-${t.version}.webp` : null
}

/** The `@preview` spec a scaffold imports, e.g. `@preview/charged-ieee:0.1.4`. */
export function templateImportSpec(t: Pick<TypstTemplate, 'name' | 'version'>): string {
  return `@preview/${t.name}:${t.version}`
}
