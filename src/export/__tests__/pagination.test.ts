// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import { computeBreakOffsets, type BlockExtent } from '../pagination'

describe('computeBreakOffsets', () => {
  it('returns well-formed breaks: starts at 0, ends at totalHeight, strictly increasing', () => {
    const atoms: BlockExtent[] = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 250 },
      { top: 250, bottom: 500 },
    ]
    const breaks = computeBreakOffsets(atoms, 500, 200)
    expect(breaks[0]).toBe(0)
    expect(breaks[breaks.length - 1]).toBe(500)
    for (let i = 1; i < breaks.length; i++) expect(breaks[i]!).toBeGreaterThan(breaks[i - 1]!)
  })

  it('never slices through a block that starts on the page', () => {
    // A block spans 180..260, natural cut at 200 → break moves up to 180.
    const atoms: BlockExtent[] = [
      { top: 0, bottom: 180 },
      { top: 180, bottom: 260 },
      { top: 260, bottom: 400 },
    ]
    const breaks = computeBreakOffsets(atoms, 400, 200)
    expect(breaks).toContain(180)
    // No break lands strictly inside 180..260.
    for (const b of breaks) expect(b > 180 && b < 260).toBe(false)
  })

  it('splits a block taller than a page at the natural cut (last resort)', () => {
    const atoms: BlockExtent[] = [{ top: 0, bottom: 500 }] // one 500px block, page 200
    const breaks = computeBreakOffsets(atoms, 500, 200)
    expect(breaks).toEqual([0, 200, 400, 500])
  })

  it('handles zero / negative dimensions safely', () => {
    expect(computeBreakOffsets([], 0, 200)).toEqual([0, 0])
    expect(computeBreakOffsets([], 300, 0)).toEqual([0, 300])
  })

  it('single short page', () => {
    expect(computeBreakOffsets([{ top: 0, bottom: 50 }], 50, 200)).toEqual([0, 50])
  })
})
