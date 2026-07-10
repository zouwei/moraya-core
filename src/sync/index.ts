// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/sync — shared document synchronization engine.
 *
 * Two layers, both platform-agnostic:
 *
 *   1. Pure merge primitives — `threeWayDiff` (directory-level decision table)
 *      and `threeWayMergeLines` / `twoWayMergeLines` / `assembleMerged` (git-
 *      style line merge). Extracted verbatim from Moraya desktop's battle-tested
 *      KB-sync engine so PC / Web / Mobile share one merge semantics.
 *
 *   2. `DocSyncEngine` — single-document optimistic-concurrency state machine
 *      (single-flight + atomic base advance + 3-way auto-merge) that replaces
 *      the ad-hoc autosave loops which leaked false "conflict detected" prompts.
 *
 * IO is dependency-injected (`DocSyncIO`), mirroring the AITransport pattern:
 * core builds the sync logic; the consumer executes reads/writes against its
 * object store (Picora, S3, …). Requires the `node-diff3` and `diff` optional
 * peers — only consumers importing `/sync` install them.
 */

export type {
  ManifestEntry,
  LocalManifestEntry,
  LocalManifest,
  RemoteManifest,
  InitialAuthority,
  DiffAction,
  DiffResult,
  MergeChunk,
  MergeResult,
  ChunkPick,
  ConflictEntry,
  ConflictResolution,
} from './types'

export { threeWayDiff } from './diff'

export {
  splitLines,
  joinLines,
  threeWayMergeLines,
  twoWayMergeLines,
  assembleMerged,
  conflictChunkCount,
} from './merge'

export { DocSyncEngine } from './doc-sync-engine'
export type {
  DocSyncIO,
  DocSyncStatus,
  DocConflict,
  DocSyncEngineOptions,
} from './doc-sync-engine'
