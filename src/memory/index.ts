// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/memory — shared AI long-term-memory data contract + serialization.
 *
 * Platform-agnostic: the `MemoryDoc` shape and its Markdown serialization are
 * the single source of truth synced across web / mobile / PC, aligned with
 * Picora's dot-directory memory hosting (`.moraya/memories/*.md`).
 *
 * v0.7.0 covers the data contract + serialization only. The pure ranking/decay/
 * conflict logic currently in web's `src/lib/memory/` migrates here in a later
 * iteration (when PC becomes a second consumer).
 */

export type {
  MemoryDoc,
  MemoryDocPreference,
  MemoryDocProject,
  MemoryDocFact,
  MemoryKind,
  MemoryStatus,
  SensitivityLevel,
  FactType,
} from './types'
export {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  SENSITIVITY_LEVELS,
  FACT_TYPES,
} from './types'
export {
  MEMORY_DIR,
  memoryDocPath,
  isMemoryDocPath,
  memoryIdFromPath,
  serializeMemoryDoc,
  parseMemoryDoc,
} from './serialize'
