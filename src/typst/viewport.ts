// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Preview viewport math — zoom and cursor-anchored scrolling.
 *
 * The Typst preview behaves like a document viewer: ⌘/Ctrl + wheel zooms, and
 * dragging pans. Each platform wires its own DOM events (the same split used
 * for block-drag), but the arithmetic lives here because getting it wrong is
 * both easy and invisible in a type-checker:
 *
 *   - a wheel delta must map to a *multiplicative* step, or zooming feels
 *     linear-then-explosive at the extremes;
 *   - after zooming, the scroll offset must be corrected so the point under
 *     the cursor stays under the cursor — otherwise the page lurches away from
 *     whatever the user was pointing at.
 */

/**
 * Scale bounds, relative to the fit-to-pane size — 1 = "one whole page fits
 * the pane", so the range is expressed in terms of what the reader actually
 * sees rather than in absolute page units.
 *
 * 5x is enough to inspect a glyph or a rule at close range; 0.25x fits roughly
 * a 4x4 grid of pages for a document-level overview.
 */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 5
/** Multiplicative step per wheel notch — keeps zoom perceptually even. */
export const ZOOM_STEP = 1.1

/** Clamp a scale into the supported range. */
export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/** A width/height pair, in whatever unit the caller is working in. */
export interface Box {
  width: number
  height: number
}

/**
 * Size one preview page: fit it to the pane, then apply zoom.
 *
 * At `zoom === 1` exactly one whole page is visible — the scale is whichever
 * axis is tighter, so the page never overflows and the next page never peeks
 * in below.
 *
 * The result must be applied as a **definite** width/height. Two earlier
 * attempts failed by handing bounds to CSS instead:
 *
 *   - fitting only the height let a wide page overflow sideways;
 *   - using `max-width` / `max-height` only ever *shrinks*, so a page whose
 *     intrinsic size is smaller than the pane (an A5 document, say) rendered at
 *     natural size and every zoom step above it did nothing at all.
 *
 * Returns a zero box for a degenerate pane or page rather than `NaN`/`Infinity`
 * pixel values, which would blank the preview.
 */
export function fitPageBox(available: Box, page: Box, zoom: number): Box {
  const finite = [available.width, available.height, page.width, page.height, zoom]
  if (!finite.every((n) => Number.isFinite(n) && n > 0)) return { width: 0, height: 0 }
  const fit = Math.min(available.width / page.width, available.height / page.height)
  return { width: page.width * fit * zoom, height: page.height * fit * zoom }
}

/**
 * Apply one wheel event to the current scale.
 *
 * `deltaY` follows the DOM convention: negative scrolls up / zooms in.
 * Magnitude is intentionally ignored beyond its sign — trackpads and mice
 * report wildly different deltas, and a proportional response makes a trackpad
 * pinch overshoot to the limit in one gesture.
 */
export function zoomByWheel(scale: number, deltaY: number): number {
  if (deltaY === 0) return clampZoom(scale)
  return clampZoom(deltaY < 0 ? scale * ZOOM_STEP : scale / ZOOM_STEP)
}

export interface AnchoredScrollInput {
  /** Current scroll offset of the pane, in px. */
  scroll: number
  /** Cursor position relative to the pane's visible box, in px. */
  cursor: number
  oldScale: number
  newScale: number
}

/**
 * Scroll offset that keeps the content under the cursor fixed across a zoom.
 *
 * The content coordinate under the cursor is `(scroll + cursor) / oldScale`;
 * for it to stay under the cursor at the new scale, the new offset must satisfy
 * `newScroll + cursor = contentCoord * newScale`.
 */
export function anchoredScroll({
  scroll,
  cursor,
  oldScale,
  newScale,
}: AnchoredScrollInput): number {
  if (oldScale <= 0) return scroll
  const ratio = newScale / oldScale
  return Math.max(0, (scroll + cursor) * ratio - cursor)
}

/** True when the event should zoom rather than scroll (⌘ on macOS, Ctrl elsewhere). */
export function isZoomGesture(e: {
  ctrlKey: boolean
  metaKey: boolean
}): boolean {
  // Browsers also synthesize ctrlKey for trackpad pinch, which is exactly the
  // gesture users expect to zoom — so both modifiers count on every platform.
  return e.ctrlKey || e.metaKey
}
