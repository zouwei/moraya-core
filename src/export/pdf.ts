// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Assemble captured page canvases into an A4 PDF. jsPDF is passed in (injected
 * or lazily imported by the engine) so this module never forces the dependency.
 */

import {
  PDF_MARGIN_MM,
  PDF_CONTENT_WIDTH_MM,
  PDF_CONTENT_HEIGHT_MM,
  PAGE_CSS_PX_HEIGHT,
  type JsPdfCtor,
} from './types'

/**
 * Compose page canvases into a compressed A4-portrait PDF, returning the bytes.
 * `onPage(i, total)` fires before each page is drawn (progress). Each canvas was
 * captured from up to `PAGE_CSS_PX_HEIGHT` CSS px; its pixel height maps back to
 * mm so a short final page isn't stretched.
 */
export function composePdf(
  pages: { canvases: HTMLCanvasElement[]; scale: number },
  JsPDF: JsPdfCtor,
  onPage?: (index: number, total: number) => void,
): Uint8Array {
  if (pages.canvases.length === 0) throw new Error('No pages were rendered for PDF export.')

  const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const total = pages.canvases.length
  for (let i = 0; i < total; i++) {
    const canvas = pages.canvases[i]!
    if (i > 0) pdf.addPage()
    onPage?.(i + 1, total)

    const cssPxHeight = canvas.height / pages.scale
    const drawHeightMm = (cssPxHeight / PAGE_CSS_PX_HEIGHT) * PDF_CONTENT_HEIGHT_MM
    const dataUrl = canvas.toDataURL('image/png')
    pdf.addImage(dataUrl, 'PNG', PDF_MARGIN_MM, PDF_MARGIN_MM, PDF_CONTENT_WIDTH_MM, drawHeightMm)
  }
  return new Uint8Array(pdf.output('arraybuffer'))
}
