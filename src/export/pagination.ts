// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Pure, DOM-free page-break solver for the canvas PDF export pipeline.
 *
 * Kept in its own module (no html2canvas / jsPDF import) so it can be unit-
 * tested in isolation. Extracted verbatim from Moraya desktop's
 * `pdf-pagination.ts` so PC / Web / Mobile share one pagination semantics.
 */

/** Vertical extent of one atomic (never-split) block, in CSS px. */
export interface BlockExtent {
  top: number
  bottom: number
}

/**
 * Given the vertical extents of atomic blocks (table rows, headings, images,
 * paragraphs …) and the page height, return strictly-increasing integer break
 * offsets spanning [0 … totalHeight]. Each adjacent pair is one page. No page
 * slices through a block that STARTS on that page; a block taller than a full
 * page is split at the natural cut as a last resort.
 */
export function computeBreakOffsets(
  atoms: ReadonlyArray<BlockExtent>,
  totalHeight: number,
  pageHeight: number,
): number[] {
  if (totalHeight <= 0 || pageHeight <= 0) {
    return [0, Math.max(0, Math.round(totalHeight))]
  }

  const breaks: number[] = [0]
  let pageTop = 0
  // Backstop against pathological input so the loop can never spin forever.
  let safety = Math.ceil(totalHeight / pageHeight) + atoms.length + 8

  while (pageTop < totalHeight - 0.5 && safety-- > 0) {
    let cut = pageTop + pageHeight
    if (cut >= totalHeight) {
      cut = totalHeight
    } else {
      // Move the cut up to the top of the earliest block that straddles it and
      // starts on this page (so it — and any nested block — moves down whole).
      let moved = cut
      for (const a of atoms) {
        if (a.top > pageTop && a.top < cut && a.bottom > cut && a.top < moved) {
          moved = a.top
        }
      }
      // Only honour it if the page stays non-empty; otherwise the block is
      // taller than a page and we accept splitting it at the natural cut.
      if (moved > pageTop + 1) cut = moved
    }

    cut = Math.round(cut)
    if (cut <= pageTop) cut = Math.min(totalHeight, pageTop + pageHeight) // never stall
    breaks.push(cut)
    pageTop = cut
  }

  if (breaks[breaks.length - 1]! < totalHeight) breaks.push(Math.round(totalHeight))
  return breaks
}
