// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/sync — shared document-sync data contracts.
 *
 * The pure, platform-agnostic subset of Moraya's KB-sync engine: manifest
 * entries, the three-way diff decision result, and the line-level merge shapes.
 * Extracted verbatim (names unchanged) from the desktop `kb-sync/types.ts` so
 * PC / Web / Mobile share one merge + conflict contract. Host-specific
 * orchestration types (sync mode, KB bindings, sync reports) stay in each
 * consumer.
 *
 * Pure: no Node API, no host imports, no runtime deps.
 */

// ── Manifest ─────────────────────────────────────────────────────────────────

/** A remote/last-synced manifest entry: enough to detect divergence by hash. */
export interface ManifestEntry {
  relativePath: string
  sourceHash: string
  sizeBytes: number
  updatedAt: string
}

/** A local manifest entry (adds mtime; hash is still the divergence key). */
export interface LocalManifestEntry {
  relativePath: string
  sourceHash: string
  sizeBytes: number
  mtime: number
}

export type LocalManifest = Map<string, LocalManifestEntry>
export type RemoteManifest = Map<string, ManifestEntry>

// ── Three-way diff ───────────────────────────────────────────────────────────

/**
 * First-sync authority: when there is NO merge base (empty lastManifest) and a
 * file exists on both sides with different content, we can't tell which side is
 * newer. `initialAuthority` decides the outcome instead of crudely conflicting:
 *   - 'local'  → treat as an upload (this machine is the initial source of truth)
 *   - 'remote' → treat as a download
 *   - 'prompt' → surface as a conflict for manual resolution
 * Only affects the no-base both-exist-divergent case. Default 'local' matches
 * the read-only-cloud model.
 */
export type InitialAuthority = 'local' | 'remote' | 'prompt'

export type DiffAction =
  | { kind: 'upload'; relativePath: string }
  | { kind: 'download'; relativePath: string }
  | { kind: 'delete-remote'; relativePath: string }
  | { kind: 'delete-local'; relativePath: string }
  | { kind: 'conflict'; relativePath: string }
  | { kind: 'skip-large'; relativePath: string; sizeBytes: number }
  | { kind: 'aligned' }

export interface DiffResult {
  actions: DiffAction[]
  uploadPaths: string[]
  downloadPaths: string[]
  deleteRemotePaths: string[]
  deleteLocalPaths: string[]
  conflictPaths: string[]
  skippedLarge: Array<{ relativePath: string; sizeBytes: number }>
}

// ── Line-level merge (git-style) ─────────────────────────────────────────────

/**
 * One region of a line-level merge. `stable` regions are agreed-upon lines;
 * `conflict` regions carry the diverging local/remote (and base) line arrays.
 */
export interface MergeChunk {
  type: 'stable' | 'conflict'
  /** For stable chunks: the agreed lines. */
  lines?: string[]
  /** For conflict chunks: local side ("mine"). */
  local?: string[]
  /** For conflict chunks: remote side ("theirs"). */
  remote?: string[]
  /** For conflict chunks: base side (common ancestor); absent when no base. */
  base?: string[]
}

export interface MergeResult {
  chunks: MergeChunk[]
  hasConflict: boolean
  /** Fully auto-merged text when `hasConflict` is false; otherwise null. */
  mergedText: string | null
}

/** Per-conflict-chunk pick in the resolution UI. */
export type ChunkPick = 'local' | 'remote' | 'both-local-first' | 'both-remote-first'

// ── Conflict (batch/KB clean-up model) ───────────────────────────────────────

/**
 * A per-file conflict carrying the three-way content needed for the resolution
 * UI. Used by the desktop batch-sync path; the single-document DocSyncEngine
 * emits its own lighter `DocConflict` (see doc-sync-engine.ts).
 */
export interface ConflictEntry {
  relativePath: string
  localUpdatedAt: string
  remoteUpdatedAt: string
  localSizeBytes: number
  remoteSizeBytes: number
  localPreview: string
  remotePreview: string
  localHash: string
  remoteHash: string
  /** Full local file content (for line-level merge in the resolution UI). */
  localContent: string
  /** Full remote file content. */
  remoteContent: string
  /** Last-synced common ancestor content, or null if no merge base is known
   *  (e.g. first sync, or file predates base-content caching). */
  baseContent: string | null
}

export type ConflictResolution = 'prefer-local' | 'prefer-remote' | 'keep-both'
