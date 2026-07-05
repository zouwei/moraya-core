// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Markdown ⇄ MemoryDoc serialization, aligned with Picora's dot-directory
 * memory hosting (`.moraya/memories/{id}.md`, v0.70.0).
 *
 * A memory file is a small Markdown doc: a YAML-ish frontmatter block carrying
 * the metadata, followed by the natural-language memory as the body.
 *
 * The frontmatter is hand-written (core forbids runtime deps, so no js-yaml /
 * gray-matter). It's a deliberately restricted encoding — one `key: value` per
 * line, scalars JSON-encoded when ambiguous, arrays/objects as inline JSON — so
 * that `parse(serialize(doc))` round-trips exactly, while still being readable
 * and hand-editable (the whole point of the dot-directory design).
 *
 * Pure: no Node API, no host imports, no runtime deps.
 */

import type {
  MemoryDoc,
  MemoryDocFact,
  MemoryDocPreference,
  MemoryDocProject,
} from './types'
import {
  FACT_TYPES,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  SENSITIVITY_LEVELS,
} from './types'

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Directory prefix (relative to KB root) that holds Moraya memory files. */
export const MEMORY_DIR = '.moraya/memories'

/** Build the Picora relative path for a memory id. */
export function memoryDocPath(id: string): string {
  return `${MEMORY_DIR}/${id}.md`
}

/** True iff `path` is a Moraya memory doc (dot-directory + .md). */
export function isMemoryDocPath(path: string): boolean {
  return path.startsWith(`${MEMORY_DIR}/`) && path.endsWith('.md')
}

/** Extract the memory id from a `.moraya/memories/{id}.md` path, or null. */
export function memoryIdFromPath(path: string): string | null {
  if (!isMemoryDocPath(path)) return null
  const rest = path.slice(MEMORY_DIR.length + 1) // strip ".moraya/memories/"
  return rest.slice(0, -'.md'.length) || null
}

// ── Scalar encode / decode ───────────────────────────────────────────────────

// A string is safe to write bare when it has no leading/trailing whitespace,
// no newline, and doesn't look like it needs quoting (starts with a quote/
// bracket/brace, or contains a colon-space that would confuse the parser).
function needsQuoting(v: string): boolean {
  if (v === '') return true
  if (v !== v.trim()) return true
  if (/[\n\r]/.test(v)) return true
  if (/^["'[{]/.test(v)) return true
  if (v.includes(': ')) return true
  return false
}

function encodeScalar(v: string): string {
  return needsQuoting(v) ? JSON.stringify(v) : v
}

function decodeScalar(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('"')) {
    try {
      const parsed = JSON.parse(t)
      if (typeof parsed === 'string') return parsed
    } catch {
      /* fall through to raw */
    }
  }
  return t
}

// ── Serialize ────────────────────────────────────────────────────────────────

/** Serialize a MemoryDoc to a Markdown file (frontmatter + body). */
export function serializeMemoryDoc(doc: MemoryDoc): string {
  const lines: string[] = ['---']
  lines.push(`id: ${encodeScalar(doc.id)}`)
  lines.push(`kind: ${doc.kind}`)
  lines.push(`weight: ${Number.isFinite(doc.weight) ? doc.weight : 1}`)
  lines.push(`sensitivity: ${doc.sensitivity}`)
  lines.push(`status: ${doc.status}`)
  lines.push(`createdAt: ${encodeScalar(doc.createdAt)}`)
  lines.push(`lastUsedAt: ${encodeScalar(doc.lastUsedAt)}`)
  if (doc.fixedWeight) lines.push('fixedWeight: true')
  lines.push(`sources: ${JSON.stringify(doc.sources ?? [])}`)
  if (doc.preference) lines.push(`preference: ${JSON.stringify(doc.preference)}`)
  if (doc.project) lines.push(`project: ${JSON.stringify(doc.project)}`)
  if (doc.fact) lines.push(`fact: ${JSON.stringify(doc.fact)}`)
  lines.push('---')

  // Body: the memory content verbatim.
  return `${lines.join('\n')}\n${doc.content}`
}

// ── Parse ────────────────────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

interface RawFields {
  [key: string]: string
}

function parseFrontmatterLines(block: string): RawFields {
  const fields: RawFields = {}
  for (const line of block.split('\n')) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) fields[key] = value
  }
  return fields
}

function parseJsonObject<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T
    }
  } catch {
    /* ignore malformed */
  }
  return undefined
}

function coerceKind(raw: string | undefined): MemoryDoc['kind'] {
  return (MEMORY_KINDS as readonly string[]).includes(raw ?? '')
    ? (raw as MemoryDoc['kind'])
    : 'preference'
}

function coerceStatus(raw: string | undefined): MemoryDoc['status'] {
  return (MEMORY_STATUSES as readonly string[]).includes(raw ?? '')
    ? (raw as MemoryDoc['status'])
    : 'active'
}

function coerceSensitivity(raw: string | undefined): MemoryDoc['sensitivity'] {
  return (SENSITIVITY_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as MemoryDoc['sensitivity'])
    : 'low'
}

function coerceSources(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    /* ignore */
  }
  return []
}

function sanitizeFact(fact: MemoryDocFact | undefined): MemoryDocFact | undefined {
  if (!fact) return undefined
  const factType = (FACT_TYPES as readonly string[]).includes(fact.factType)
    ? fact.factType
    : 'other'
  return { factType }
}

/**
 * Parse a memory Markdown file back into a MemoryDoc.
 *
 * Tolerant by design: missing/invalid fields fall back to sane defaults so
 * externally hand-written or older files still load. A file with no valid
 * frontmatter is treated as pure content (with `fallbackId` as the id) rather
 * than rejected — returns null only when there's no id to anchor it to.
 */
export function parseMemoryDoc(markdown: string, fallbackId?: string): MemoryDoc | null {
  const nowIso = '1970-01-01T00:00:00.000Z'
  const match = FRONTMATTER_RE.exec(markdown)

  if (!match) {
    // No frontmatter — treat the whole text as content if we have an id.
    if (!fallbackId) return null
    return {
      id: fallbackId,
      kind: 'preference',
      content: markdown.trim(),
      weight: 1,
      sensitivity: 'low',
      status: 'active',
      createdAt: nowIso,
      lastUsedAt: nowIso,
      sources: [],
    }
  }

  const fields = parseFrontmatterLines(match[1] ?? '')
  const content = match[2] ?? ''

  const id = fields['id'] ? decodeScalar(fields['id']) : fallbackId
  if (!id) return null

  const weightNum = Number(fields['weight'])
  const doc: MemoryDoc = {
    id,
    kind: coerceKind(fields['kind']),
    content,
    weight: Number.isFinite(weightNum) ? weightNum : 1,
    sensitivity: coerceSensitivity(fields['sensitivity']),
    status: coerceStatus(fields['status']),
    createdAt: fields['createdAt'] ? decodeScalar(fields['createdAt']) : nowIso,
    lastUsedAt: fields['lastUsedAt'] ? decodeScalar(fields['lastUsedAt']) : nowIso,
    sources: coerceSources(fields['sources']),
  }

  if (fields['fixedWeight'] === 'true') doc.fixedWeight = true

  const preference = parseJsonObject<MemoryDocPreference>(fields['preference'])
  if (preference && typeof preference.domain === 'string') doc.preference = preference

  const project = parseJsonObject<MemoryDocProject>(fields['project'])
  if (project && typeof project.projectName === 'string') doc.project = project

  const fact = sanitizeFact(parseJsonObject<MemoryDocFact>(fields['fact']))
  if (fact) doc.fact = fact

  return doc
}
