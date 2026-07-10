// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Three-way diff between local state, last-known manifest, and remote manifest.
 * The decision engine behind directory sync — pure, zero-IO. Extracted verbatim
 * from the desktop KB-sync engine (v1.6.0, 298-test regression matrix) so every
 * consumer shares one decision table.
 */

import type {
  LocalManifest,
  RemoteManifest,
  ManifestEntry,
  LocalManifestEntry,
  DiffResult,
  DiffAction,
  InitialAuthority,
} from './types'

/**
 * Decision table:
 *   local-new/modified  + remote-unchanged  → upload
 *   local-deleted       + remote-unchanged  → delete-remote
 *   local-unchanged     + remote-new/mod    → download
 *   local-unchanged     + remote-deleted    → delete-local
 *   both changed        + same hash         → aligned (skip)
 *   both changed        + different hash    → conflict (but see initialAuthority
 *                                             when there is no base)
 */
export function threeWayDiff(
  lastManifest: RemoteManifest,
  localManifest: LocalManifest,
  remoteManifest: RemoteManifest,
  maxFileSizeBytes: number,
  initialAuthority: InitialAuthority = 'local',
): DiffResult {
  const actions: DiffAction[] = []
  const uploadPaths: string[] = []
  const downloadPaths: string[] = []
  const deleteRemotePaths: string[] = []
  const deleteLocalPaths: string[] = []
  const conflictPaths: string[] = []
  const skippedLarge: Array<{ relativePath: string; sizeBytes: number }> = []

  const allPaths = new Set([
    ...lastManifest.keys(),
    ...localManifest.keys(),
    ...remoteManifest.keys(),
  ])

  for (const path of allPaths) {
    const last = lastManifest.get(path)
    const local = localManifest.get(path)
    const remote = remoteManifest.get(path)

    if (local && local.sizeBytes > maxFileSizeBytes) {
      skippedLarge.push({ relativePath: path, sizeBytes: local.sizeBytes })
      actions.push({ kind: 'skip-large', relativePath: path, sizeBytes: local.sizeBytes })
      continue
    }

    const localChanged = localChangedFromLast(local, last)
    const remoteChanged = remoteChangedFromLast(remote, last)

    if (local && !remote) {
      if (!last) {
        // New file on local, not on remote → upload
        uploadPaths.push(path)
        actions.push({ kind: 'upload', relativePath: path })
      } else {
        // Was in last, remote deleted it
        if (localChanged) {
          // Local modified + remote deleted → conflict
          conflictPaths.push(path)
          actions.push({ kind: 'conflict', relativePath: path })
        } else {
          // Local unchanged, remote deleted → delete local
          deleteLocalPaths.push(path)
          actions.push({ kind: 'delete-local', relativePath: path })
        }
      }
    } else if (!local && remote) {
      if (!last) {
        // New file on remote, not local → download
        downloadPaths.push(path)
        actions.push({ kind: 'download', relativePath: path })
      } else {
        // Was in last, local deleted it
        if (remoteChanged) {
          // Remote modified + local deleted → conflict
          conflictPaths.push(path)
          actions.push({ kind: 'conflict', relativePath: path })
        } else {
          // Remote unchanged, local deleted → delete remote
          deleteRemotePaths.push(path)
          actions.push({ kind: 'delete-remote', relativePath: path })
        }
      }
    } else if (local && remote) {
      if (!localChanged && !remoteChanged) {
        // Both unchanged — no action needed
        actions.push({ kind: 'aligned' })
      } else if (localChanged && !remoteChanged) {
        // Local modified, remote unchanged → upload
        uploadPaths.push(path)
        actions.push({ kind: 'upload', relativePath: path })
      } else if (!localChanged && remoteChanged) {
        // Remote modified, local unchanged → download
        downloadPaths.push(path)
        actions.push({ kind: 'download', relativePath: path })
      } else {
        // Both changed
        if (local.sourceHash === remote.sourceHash) {
          // Same content → aligned
          actions.push({ kind: 'aligned' })
        } else if (!last) {
          // No merge base (first sync): can't tell which side is newer. Resolve
          // by the configured initial authority instead of a crude conflict.
          if (initialAuthority === 'local') {
            uploadPaths.push(path)
            actions.push({ kind: 'upload', relativePath: path })
          } else if (initialAuthority === 'remote') {
            downloadPaths.push(path)
            actions.push({ kind: 'download', relativePath: path })
          } else {
            conflictPaths.push(path)
            actions.push({ kind: 'conflict', relativePath: path })
          }
        } else {
          // True conflict: both diverged from a known common base.
          conflictPaths.push(path)
          actions.push({ kind: 'conflict', relativePath: path })
        }
      }
    }
    // (!local && !remote) case: file existed in last but gone from both → nothing to do
  }

  return {
    actions,
    uploadPaths,
    downloadPaths,
    deleteRemotePaths,
    deleteLocalPaths,
    conflictPaths,
    skippedLarge,
  }
}

function localChangedFromLast(
  local: LocalManifestEntry | undefined,
  last: ManifestEntry | undefined,
): boolean {
  if (!local && !last) return false
  if (!local || !last) return true
  return local.sourceHash !== last.sourceHash
}

function remoteChangedFromLast(
  remote: ManifestEntry | undefined,
  last: ManifestEntry | undefined,
): boolean {
  if (!remote && !last) return false
  if (!remote || !last) return true
  return remote.sourceHash !== last.sourceHash
}
