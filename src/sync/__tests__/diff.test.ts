// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { threeWayDiff } from '../diff'
import type { LocalManifest, RemoteManifest, LocalManifestEntry, ManifestEntry } from '../types'

const MAX = 2 * 1024 * 1024 // 2MB

function localEntry(hash: string, size = 100): LocalManifestEntry {
  return { relativePath: '', sourceHash: hash, sizeBytes: size, mtime: 1 }
}

function remoteEntry(hash: string, size = 100): ManifestEntry {
  return { relativePath: '', sourceHash: hash, sizeBytes: size, updatedAt: '2026-01-01T00:00:00Z' }
}

function makeLocal(entries: [string, LocalManifestEntry][]): LocalManifest {
  return new Map(entries)
}

function makeRemote(entries: [string, ManifestEntry][]): RemoteManifest {
  return new Map(entries)
}

describe('threeWayDiff', () => {
  it('local-new: new file exists only locally → upload', () => {
    const last: RemoteManifest = new Map()
    const local = makeLocal([['note.md', localEntry('aaa')]])
    const remote: RemoteManifest = new Map()

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.uploadPaths).toEqual(['note.md'])
    expect(result.downloadPaths).toHaveLength(0)
    expect(result.conflictPaths).toHaveLength(0)
    expect(result.actions.some((a) => a.kind === 'upload')).toBe(true)
  })

  it('remote-new: new file exists only on remote → download', () => {
    const last: RemoteManifest = new Map()
    const local: LocalManifest = new Map()
    const remote = makeRemote([['note.md', remoteEntry('bbb')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.downloadPaths).toEqual(['note.md'])
    expect(result.uploadPaths).toHaveLength(0)
    expect(result.conflictPaths).toHaveLength(0)
  })

  it('local-deleted + remote-unchanged → delete-remote', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local: LocalManifest = new Map()
    const remote = makeRemote([['note.md', remoteEntry('aaa')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.deleteRemotePaths).toEqual(['note.md'])
    expect(result.deleteLocalPaths).toHaveLength(0)
    expect(result.conflictPaths).toHaveLength(0)
  })

  it('local-unchanged + remote-deleted → delete-local', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('aaa')]])
    const remote: RemoteManifest = new Map()

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.deleteLocalPaths).toEqual(['note.md'])
    expect(result.deleteRemotePaths).toHaveLength(0)
    expect(result.conflictPaths).toHaveLength(0)
  })

  it('local-modified + remote-unchanged → upload', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('bbb')]])
    const remote = makeRemote([['note.md', remoteEntry('aaa')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.uploadPaths).toEqual(['note.md'])
    expect(result.conflictPaths).toHaveLength(0)
  })

  it('local-unchanged + remote-modified → download', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('aaa')]])
    const remote = makeRemote([['note.md', remoteEntry('bbb')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.downloadPaths).toEqual(['note.md'])
    expect(result.conflictPaths).toHaveLength(0)
  })

  it('both changed + same hash → aligned (skip)', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('bbb')]])
    const remote = makeRemote([['note.md', remoteEntry('bbb')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.conflictPaths).toHaveLength(0)
    expect(result.uploadPaths).toHaveLength(0)
    expect(result.downloadPaths).toHaveLength(0)
    expect(result.actions.some((a) => a.kind === 'aligned')).toBe(true)
  })

  it('both changed + different hash → conflict', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('bbb')]])
    const remote = makeRemote([['note.md', remoteEntry('ccc')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.conflictPaths).toEqual(['note.md'])
    expect(result.uploadPaths).toHaveLength(0)
    expect(result.downloadPaths).toHaveLength(0)
  })

  it('file gone from both local and remote → no action', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local: LocalManifest = new Map()
    const remote: RemoteManifest = new Map()

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.uploadPaths).toHaveLength(0)
    expect(result.downloadPaths).toHaveLength(0)
    expect(result.deleteLocalPaths).toHaveLength(0)
    expect(result.deleteRemotePaths).toHaveLength(0)
    expect(result.conflictPaths).toHaveLength(0)
    expect(result.actions).toHaveLength(0)
  })

  it('file oversized → skip-large', () => {
    const max = 1024
    const last: RemoteManifest = new Map()
    const local = makeLocal([['big.md', localEntry('aaa', 2048)]])
    const remote: RemoteManifest = new Map()

    const result = threeWayDiff(last, local, remote, max)

    expect(result.skippedLarge).toHaveLength(1)
    expect(result.skippedLarge[0].relativePath).toBe('big.md')
    expect(result.uploadPaths).toHaveLength(0)
    expect(result.actions.some((a) => a.kind === 'skip-large')).toBe(true)
  })

  it('local-modified + remote-deleted → conflict', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('bbb')]])
    const remote: RemoteManifest = new Map()

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.conflictPaths).toEqual(['note.md'])
    expect(result.deleteLocalPaths).toHaveLength(0)
  })

  it('local-deleted + remote-modified → conflict', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local: LocalManifest = new Map()
    const remote = makeRemote([['note.md', remoteEntry('bbb')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.conflictPaths).toEqual(['note.md'])
    expect(result.deleteRemotePaths).toHaveLength(0)
  })

  it('both unchanged → aligned, no operations', () => {
    const last = makeRemote([['note.md', remoteEntry('aaa')]])
    const local = makeLocal([['note.md', localEntry('aaa')]])
    const remote = makeRemote([['note.md', remoteEntry('aaa')]])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.uploadPaths).toHaveLength(0)
    expect(result.downloadPaths).toHaveLength(0)
    expect(result.conflictPaths).toHaveLength(0)
    expect(result.actions.every((a) => a.kind === 'aligned')).toBe(true)
  })

  it('mixed: upload + download + conflict in single diff', () => {
    const last = makeRemote([
      ['keep.md', remoteEntry('aaa')],
      ['conflict.md', remoteEntry('aaa')],
    ])
    const local = makeLocal([
      ['keep.md', localEntry('aaa')], // unchanged
      ['new.md', localEntry('zzz')], // new local → upload
      ['conflict.md', localEntry('bbb')], // both changed → conflict
    ])
    const remote = makeRemote([
      ['keep.md', remoteEntry('aaa')], // unchanged
      ['remote-new.md', remoteEntry('yyy')], // new remote → download
      ['conflict.md', remoteEntry('ccc')], // both changed → conflict
    ])

    const result = threeWayDiff(last, local, remote, MAX)

    expect(result.uploadPaths).toContain('new.md')
    expect(result.downloadPaths).toContain('remote-new.md')
    expect(result.conflictPaths).toContain('conflict.md')
    expect(result.uploadPaths).not.toContain('keep.md')
  })

  describe('first-sync initialAuthority (no base manifest)', () => {
    const emptyBase: RemoteManifest = new Map()
    const local = makeLocal([['both.md', localEntry('bbb')]])
    const remote = makeRemote([['both.md', remoteEntry('ccc')]])

    it("defaults to 'local' — divergent both-exist file uploads, not conflicts", () => {
      const result = threeWayDiff(emptyBase, local, remote, MAX)
      expect(result.uploadPaths).toContain('both.md')
      expect(result.conflictPaths).toHaveLength(0)
    })

    it("'remote' downloads instead", () => {
      const result = threeWayDiff(emptyBase, local, remote, MAX, 'remote')
      expect(result.downloadPaths).toContain('both.md')
      expect(result.conflictPaths).toHaveLength(0)
    })

    it("'prompt' preserves the conflict", () => {
      const result = threeWayDiff(emptyBase, local, remote, MAX, 'prompt')
      expect(result.conflictPaths).toContain('both.md')
      expect(result.uploadPaths).toHaveLength(0)
    })

    it('identical both-exist file aligns regardless of authority', () => {
      const sameLocal = makeLocal([['both.md', localEntry('aaa')]])
      const sameRemote = makeRemote([['both.md', remoteEntry('aaa')]])
      const result = threeWayDiff(new Map(), sameLocal, sameRemote, MAX, 'local')
      expect(result.uploadPaths).toHaveLength(0)
      expect(result.conflictPaths).toHaveLength(0)
      expect(result.actions.some((a) => a.kind === 'aligned')).toBe(true)
    })

    it('with a base present, genuine divergence still conflicts', () => {
      const base = makeRemote([['both.md', remoteEntry('aaa')]])
      const result = threeWayDiff(base, local, remote, MAX, 'local')
      expect(result.conflictPaths).toContain('both.md')
      expect(result.uploadPaths).not.toContain('both.md')
    })
  })
})
