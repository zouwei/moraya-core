// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  clampZoom,
  zoomByWheel,
  anchoredScroll,
  isZoomGesture,
  fitPageBox,
} from '../viewport'

describe('clampZoom', () => {
  it('keeps a scale inside the supported range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(100)).toBe(ZOOM_MAX)
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    // Bounds are relative to the fit-to-pane size: 500% in, 25% out.
    expect(ZOOM_MAX).toBe(5)
    expect(ZOOM_MIN).toBe(0.25)
  })

  it('falls back to 1 for non-finite input', () => {
    // A NaN scale would silently blank the preview (width: NaNpx).
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(Infinity)).toBe(1)
  })
})

describe('zoomByWheel', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(zoomByWheel(1, -1)).toBeCloseTo(ZOOM_STEP)
    expect(zoomByWheel(1, 1)).toBeCloseTo(1 / ZOOM_STEP)
  })

  it('ignores delta magnitude', () => {
    // Trackpads report deltas orders of magnitude larger than mice; scaling by
    // magnitude makes one pinch jump straight to the limit.
    expect(zoomByWheel(1, -1)).toBeCloseTo(zoomByWheel(1, -400))
  })

  it('never escapes the range', () => {
    let s = 1
    for (let i = 0; i < 200; i++) s = zoomByWheel(s, -1)
    expect(s).toBe(ZOOM_MAX)
    for (let i = 0; i < 400; i++) s = zoomByWheel(s, 1)
    expect(s).toBe(ZOOM_MIN)
  })

  it('is a no-op for a zero delta', () => {
    expect(zoomByWheel(1.2, 0)).toBe(1.2)
  })
})

describe('anchoredScroll', () => {
  it('keeps the point under the cursor fixed when zooming in', () => {
    // Content coord under cursor = (100 + 50) / 1 = 150.
    // At 2x it sits at 300, so the pane must scroll to 300 - 50 = 250.
    expect(anchoredScroll({ scroll: 100, cursor: 50, oldScale: 1, newScale: 2 })).toBe(250)
  })

  it('keeps it fixed when zooming out', () => {
    expect(anchoredScroll({ scroll: 250, cursor: 50, oldScale: 2, newScale: 1 })).toBe(100)
  })

  it('never returns a negative offset', () => {
    // Zooming out near the top would otherwise ask for a negative scrollTop.
    expect(anchoredScroll({ scroll: 0, cursor: 10, oldScale: 4, newScale: 1 })).toBe(0)
  })

  it('is a no-op when the scale does not change', () => {
    expect(anchoredScroll({ scroll: 80, cursor: 20, oldScale: 1.5, newScale: 1.5 })).toBe(80)
  })

  it('guards against a zero or negative old scale', () => {
    expect(anchoredScroll({ scroll: 42, cursor: 10, oldScale: 0, newScale: 2 })).toBe(42)
  })
})

describe('isZoomGesture', () => {
  it('treats ⌘ and Ctrl as zoom on every platform', () => {
    // Browsers synthesize ctrlKey for a trackpad pinch, which users expect to
    // zoom — so both modifiers must count regardless of OS.
    expect(isZoomGesture({ ctrlKey: true, metaKey: false })).toBe(true)
    expect(isZoomGesture({ ctrlKey: false, metaKey: true })).toBe(true)
  })

  it('leaves a plain wheel scrolling', () => {
    expect(isZoomGesture({ ctrlKey: false, metaKey: false })).toBe(false)
  })
})

describe('fitPageBox', () => {
  // A5 at 72dpi — the paper a `#set page(paper: "a5")` document uses — inside a
  // pane bigger than it. This is the case that exposed the bug twice.
  const A5 = { width: 420, height: 595 }
  const PANE = { width: 655, height: 629 }

  it('scales a page SMALLER than the pane up to fill it', () => {
    // The previous `max-height`-only rule left it at its natural 595px, so the
    // page looked stuck at a fraction of the pane and zoom appeared dead.
    const box = fitPageBox(PANE, A5, 1)
    expect(box.height).toBeCloseTo(PANE.height)
    expect(box.height).toBeGreaterThan(A5.height)
  })

  it('shrinks a page LARGER than the pane', () => {
    const a4 = { width: 595, height: 842 }
    expect(fitPageBox(PANE, a4, 1).height).toBeCloseTo(PANE.height)
  })

  it('fits the tighter axis so no second page peeks in', () => {
    const wide = { width: 1000, height: 300 }
    const box = fitPageBox(PANE, wide, 1)
    expect(box.width).toBeCloseTo(PANE.width)
    expect(box.height).toBeLessThanOrEqual(PANE.height)
  })

  it('preserves the page aspect ratio', () => {
    const box = fitPageBox(PANE, A5, 1)
    expect(box.width / box.height).toBeCloseTo(A5.width / A5.height)
  })

  it('multiplies the fitted size by zoom', () => {
    const base = fitPageBox(PANE, A5, 1)
    const max = fitPageBox(PANE, A5, ZOOM_MAX)
    expect(max.height / base.height).toBeCloseTo(ZOOM_MAX)
    // Overflowing the pane is what gives the preview something to pan through.
    expect(max.height).toBeGreaterThan(PANE.height)
  })

  it('returns a zero box instead of NaN for a degenerate input', () => {
    // A NaN width would blank the preview (width: NaNpx).
    expect(fitPageBox({ width: 0, height: 0 }, A5, 1)).toEqual({ width: 0, height: 0 })
    expect(fitPageBox(PANE, { width: 0, height: 595 }, 1)).toEqual({ width: 0, height: 0 })
  })
})
