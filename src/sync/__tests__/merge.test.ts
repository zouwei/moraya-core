// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  threeWayMergeLines,
  twoWayMergeLines,
  assembleMerged,
  conflictChunkCount,
} from '../merge'
import type { ChunkPick } from '../types'

const doc = (...lines: string[]) => lines.join('\n')

describe('threeWayMergeLines', () => {
  it('auto-merges non-overlapping edits on both sides', () => {
    const base = 'line1\nline2\nline3'
    const local = 'LINE1\nline2\nline3' // changed first line
    const remote = 'line1\nline2\nLINE3' // changed last line
    const r = threeWayMergeLines(local, base, remote)
    expect(r.hasConflict).toBe(false)
    expect(r.mergedText).toBe('LINE1\nline2\nLINE3')
  })

  it('reports a conflict when both sides change the same line differently', () => {
    const base = 'a\nb\nc'
    const local = 'a\nLOCAL\nc'
    const remote = 'a\nREMOTE\nc'
    const r = threeWayMergeLines(local, base, remote)
    expect(r.hasConflict).toBe(true)
    expect(r.mergedText).toBeNull()
    expect(conflictChunkCount(r)).toBe(1)
    const conflict = r.chunks.find((c) => c.type === 'conflict')
    expect(conflict?.local).toEqual(['LOCAL'])
    expect(conflict?.remote).toEqual(['REMOTE'])
    expect(conflict?.base).toEqual(['b'])
  })

  it('is not a conflict when both sides make the identical change', () => {
    const base = 'a\nb\nc'
    const local = 'a\nSAME\nc'
    const remote = 'a\nSAME\nc'
    const r = threeWayMergeLines(local, base, remote)
    expect(r.hasConflict).toBe(false)
    expect(r.mergedText).toBe('a\nSAME\nc')
  })

  it('takes the changed side when the other side is unchanged', () => {
    const base = 'a\nb\nc'
    const local = 'a\nb\nc' // unchanged
    const remote = 'a\nb\nc\nd' // appended
    const r = threeWayMergeLines(local, base, remote)
    expect(r.hasConflict).toBe(false)
    expect(r.mergedText).toBe('a\nb\nc\nd')
  })
})

describe('twoWayMergeLines (no base)', () => {
  it('passes identical content through with no conflict', () => {
    const r = twoWayMergeLines('x\ny\nz', 'x\ny\nz')
    expect(r.hasConflict).toBe(false)
    expect(r.mergedText).toBe('x\ny\nz')
  })

  it('surfaces differing regions as base-less conflicts', () => {
    const local = 'a\nLOCAL\nc'
    const remote = 'a\nREMOTE\nc'
    const r = twoWayMergeLines(local, remote)
    expect(r.hasConflict).toBe(true)
    const conflict = r.chunks.find((c) => c.type === 'conflict')
    expect(conflict?.local).toEqual(['LOCAL'])
    expect(conflict?.remote).toEqual(['REMOTE'])
    expect(conflict?.base).toBeUndefined()
  })
})

describe('assembleMerged', () => {
  const base = 'a\nb\nc'
  const local = 'a\nLOCAL\nc'
  const remote = 'a\nREMOTE\nc'

  it('assembles with per-chunk picks', () => {
    const r = threeWayMergeLines(local, base, remote)
    const takeLocal = assembleMerged(r, new Map<number, ChunkPick>([[0, 'local']]))
    expect(takeLocal).toBe('a\nLOCAL\nc')
    const takeRemote = assembleMerged(r, new Map<number, ChunkPick>([[0, 'remote']]))
    expect(takeRemote).toBe('a\nREMOTE\nc')
    const both = assembleMerged(r, new Map<number, ChunkPick>([[0, 'both-local-first']]))
    expect(both).toBe('a\nLOCAL\nREMOTE\nc')
  })

  it('falls back to the default pick for unresolved chunks', () => {
    const r = threeWayMergeLines(local, base, remote)
    expect(assembleMerged(r, new Map(), 'remote')).toBe('a\nREMOTE\nc')
  })
})

/**
 * Equivalence with web's retired self-rolled `merge3` — the clean-merge/conflict
 * boundary must match so replacing it with this engine doesn't change Web's
 * auto-merge behavior. Ported from moraya-web/src/lib/sync/merge3.test.ts. Where
 * node-diff3 and the old algorithm agree, we assert the merged text; the classic-
 * diff3 adjacent-edit boundary (per R2) is asserted explicitly.
 */
describe('merge3 equivalence (threeWayMergeLines clean path)', () => {
  const clean = (base: string, local: string, remote: string) => {
    const r = threeWayMergeLines(local, base, remote)
    return r.hasConflict ? null : r.mergedText
  }

  it('ours == theirs', () => {
    expect(clean('a', 'same', 'same')).toBe('same')
  })
  it('ours unchanged → take theirs', () => {
    expect(clean('base', 'base', 'server edit')).toBe('server edit')
  })
  it('theirs unchanged → take ours', () => {
    expect(clean('base', 'local edit', 'base')).toBe('local edit')
  })
  it('edits to different regions merge', () => {
    const base = doc('# Title', '', 'para one', '', 'para two', '', 'para three')
    const ours = doc('# Title', '', 'para one LOCAL', '', 'para two', '', 'para three')
    const theirs = doc('# Title', '', 'para one', '', 'para two', '', 'para three REMOTE')
    expect(clean(base, ours, theirs)).toBe(
      doc('# Title', '', 'para one LOCAL', '', 'para two', '', 'para three REMOTE'),
    )
  })
  it('insertion by ours + edit by theirs elsewhere', () => {
    expect(clean(doc('one', 'two', 'three'), doc('one', 'inserted', 'two', 'three'), doc('one', 'two', 'three CHANGED')))
      .toBe(doc('one', 'inserted', 'two', 'three CHANGED'))
  })
  it('deletion on one side + edit on the other elsewhere', () => {
    expect(clean(doc('a', 'b', 'c', 'd', 'e'), doc('a', 'c', 'd', 'e'), doc('a', 'b', 'c', 'd', 'e EDIT')))
      .toBe(doc('a', 'c', 'd', 'e EDIT'))
  })
  it('append by theirs + prepend by ours', () => {
    expect(clean(doc('middle'), doc('top', 'middle'), doc('middle', 'bottom')))
      .toBe(doc('top', 'middle', 'bottom'))
  })
  it('same-line divergent edit → conflict', () => {
    expect(clean(doc('one', 'two', 'three'), doc('one', 'two LOCAL', 'three'), doc('one', 'two REMOTE', 'three')))
      .toBeNull()
  })
  it('edit vs delete of same line → conflict', () => {
    expect(clean(doc('one', 'two', 'three'), doc('one', 'three'), doc('one', 'two REMOTE', 'three')))
      .toBeNull()
  })
  it('identical edits from both sides → clean', () => {
    expect(clean(doc('one', 'two', 'three'), doc('one', 'two SAME', 'three'), doc('one', 'two SAME', 'three')))
      .toBe(doc('one', 'two SAME', 'three'))
  })
  it('adjacent single-line edits → conflict (classic diff3 boundary, R2)', () => {
    // No stable line between the two edited lines → one unstable chunk.
    expect(clean(doc('one', 'two', 'three', 'four'), doc('one', 'two LOCAL', 'three', 'four'), doc('one', 'two', 'three REMOTE', 'four')))
      .toBeNull()
  })
  it('edits separated by a stable line → clean', () => {
    expect(clean(doc('one', 'two', 'sep', 'three', 'four'), doc('one', 'two LOCAL', 'sep', 'three', 'four'), doc('one', 'two', 'sep', 'three REMOTE', 'four')))
      .toBe(doc('one', 'two LOCAL', 'sep', 'three REMOTE', 'four'))
  })
  it('empty documents', () => {
    expect(clean('', '', '')).toBe('')
  })
})
