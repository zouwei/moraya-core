// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Shared, platform-agnostic AI long-term-memory data contract.
 *
 * This is the wire/disk shape synced across web / mobile / PC and aligned
 * byte-for-byte with Picora's "dot-directory" memory hosting (`.moraya/memories/*.md`,
 * v0.70.0). Keeping it here — the single source of truth — prevents the three
 * clients from drifting their serialization apart.
 *
 * Deliberately NOT in this contract:
 *  - embeddings: large and platform-local; each client re-embeds on read.
 *  - Date objects: dates are ISO-8601 strings so the contract stays JSON/text
 *    pure with no host Date semantics.
 *
 * Pure: no Node API, no host/native imports, no runtime deps.
 */

export type MemoryKind = 'preference' | 'project' | 'fact'
export type MemoryStatus = 'active' | 'deleted' | 'conflict'
export type SensitivityLevel = 'low' | 'medium' | 'high'
export type FactType = 'role' | 'expertise' | 'habit' | 'tool' | 'other'

export interface MemoryDocPreference {
  domain: string
}

export interface MemoryDocProject {
  projectName: string
  activeUntil?: string // ISO-8601
}

export interface MemoryDocFact {
  factType: FactType
}

/**
 * Serializable memory doc. Mirrors web's `MemoryRecord` minus `embeddingArr`.
 */
export interface MemoryDoc {
  id: string
  kind: MemoryKind
  content: string
  weight: number
  sensitivity: SensitivityLevel
  status: MemoryStatus
  createdAt: string // ISO-8601
  lastUsedAt: string // ISO-8601
  sources: string[]
  fixedWeight?: boolean

  preference?: MemoryDocPreference
  project?: MemoryDocProject
  fact?: MemoryDocFact
}

export const MEMORY_KINDS: readonly MemoryKind[] = ['preference', 'project', 'fact']
export const MEMORY_STATUSES: readonly MemoryStatus[] = ['active', 'deleted', 'conflict']
export const SENSITIVITY_LEVELS: readonly SensitivityLevel[] = ['low', 'medium', 'high']
export const FACT_TYPES: readonly FactType[] = ['role', 'expertise', 'habit', 'tool', 'other']
