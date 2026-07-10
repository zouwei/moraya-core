// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Line-level merge — the git-style engine behind auto-merge and the conflict
 * resolution UI. Extracted verbatim from the desktop KB-sync engine so PC / Web
 * / Mobile share one merge semantics.
 *
 *  - `threeWayMergeLines(local, base, remote)` — real 3-way merge using the last
 *    synced content as the common ancestor. Non-overlapping edits on either side
 *    are applied automatically; only lines changed on BOTH sides (relative to
 *    base) become conflict chunks. This is what lets an incremental local edit
 *    upload cleanly even when the remote also moved, without a crude whole-file
 *    conflict.
 *
 *  - `twoWayMergeLines(local, remote)` — fallback when there is no merge base
 *    (first sync, or a file that predates base-content caching). Every differing
 *    line region is surfaced as a conflict chunk (base absent) for the user to
 *    pick; identical regions pass through as stable.
 *
 * Both return the same {chunks, hasConflict, mergedText} shape so the UI treats
 * them uniformly. Line splitting is on '\n' and join is on '\n'; a trailing
 * newline is preserved because the final split element (possibly '') is kept.
 *
 * Peer deps: `node-diff3` (diff3Merge) and `diff` (diffLines) — declared as
 * OPTIONAL peers of @moraya/core; only consumers importing `/sync` install them.
 */

import { diff3Merge } from 'node-diff3'
import { diffLines } from 'diff'
import type { MergeChunk, MergeResult, ChunkPick } from './types'

export function splitLines(s: string): string[] {
  return (s ?? '').split('\n')
}

export function joinLines(lines: string[]): string {
  return lines.join('\n')
}

/** Real 3-way merge. Requires the common-ancestor (base) content. */
export function threeWayMergeLines(local: string, base: string, remote: string): MergeResult {
  const a = splitLines(local)
  const o = splitLines(base)
  const b = splitLines(remote)

  // excludeFalseConflicts: if both sides made the SAME change, it's not a conflict.
  const regions = diff3Merge(a, o, b, { excludeFalseConflicts: true })

  const chunks: MergeChunk[] = []
  let hasConflict = false
  for (const r of regions as Array<Record<string, unknown>>) {
    if (r.ok) {
      chunks.push({ type: 'stable', lines: r.ok as string[] })
    } else if (r.conflict) {
      hasConflict = true
      const c = r.conflict as { a: string[]; o: string[]; b: string[] }
      chunks.push({ type: 'conflict', local: c.a, base: c.o, remote: c.b })
    }
  }

  const mergedText = hasConflict
    ? null
    : joinLines(chunks.flatMap((c) => c.lines ?? []))
  return { chunks, hasConflict, mergedText }
}

/** 2-way fallback (no base). Differing regions become base-less conflict chunks. */
export function twoWayMergeLines(local: string, remote: string): MergeResult {
  // diffLines(oldStr, newStr): parts flagged `removed` (in remote only) and
  // `added` (in local only); unflagged parts are common.
  const parts = diffLines(remote, local)
  const chunks: MergeChunk[] = []
  let hasConflict = false

  let pendingRemote: string[] = []
  let pendingLocal: string[] = []

  const flushConflict = () => {
    if (pendingRemote.length === 0 && pendingLocal.length === 0) return
    hasConflict = true
    chunks.push({
      type: 'conflict',
      local: pendingLocal.slice(),
      remote: pendingRemote.slice(),
      // no base
    })
    pendingRemote = []
    pendingLocal = []
  }

  for (const part of parts) {
    const lines = splitLines(part.value)
    // diffLines emits values ending in '\n'; the split yields a trailing ''
    // for a terminal newline — drop it so line counts stay accurate, except
    // when the value is exactly '' (keep nothing).
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

    if (part.added) {
      pendingLocal.push(...lines)
    } else if (part.removed) {
      pendingRemote.push(...lines)
    } else {
      flushConflict()
      if (lines.length > 0) chunks.push({ type: 'stable', lines })
    }
  }
  flushConflict()

  const mergedText = hasConflict ? null : joinLines(chunks.flatMap((c) => c.lines ?? []))
  return { chunks, hasConflict, mergedText }
}

/**
 * Assemble final text from a merge result given a per-conflict-chunk pick.
 * `picks` is keyed by conflict-chunk index (0-based among conflict chunks only).
 * Unresolved conflict chunks (no pick) default to `defaultPick`.
 */
export function assembleMerged(
  result: MergeResult,
  picks: Map<number, ChunkPick>,
  defaultPick: ChunkPick = 'local',
): string {
  const out: string[] = []
  let conflictIdx = 0
  for (const chunk of result.chunks) {
    if (chunk.type === 'stable') {
      out.push(...(chunk.lines ?? []))
      continue
    }
    const pick = picks.get(conflictIdx) ?? defaultPick
    const local = chunk.local ?? []
    const remote = chunk.remote ?? []
    switch (pick) {
      case 'local': out.push(...local); break
      case 'remote': out.push(...remote); break
      case 'both-local-first': out.push(...local, ...remote); break
      case 'both-remote-first': out.push(...remote, ...local); break
    }
    conflictIdx++
  }
  return joinLines(out)
}

/** Number of conflict chunks in a merge result. */
export function conflictChunkCount(result: MergeResult): number {
  return result.chunks.filter((c) => c.type === 'conflict').length
}
