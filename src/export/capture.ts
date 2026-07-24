// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * DOM capture pipeline — clone the rendered `.moraya-editor` into an offscreen,
 * forced-light, fixed-width container and screenshot it with html2canvas, either
 * as one canvas (long-image PNG) or as content-aware page slices (PDF).
 *
 * html2canvas is passed in (injected or lazily imported by the engine) so this
 * module never forces the dependency at load time.
 */

import {
  EXPORT_CONTAINER_WIDTH,
  BROWSER_CANVAS_MAX,
  PAGE_CSS_PX_HEIGHT,
  LIGHT_THEME_VARS,
  type CanvasCaps,
  type Html2CanvasFn,
} from './types'
import { computeBreakOffsets } from './pagination'
import { sanitizeHtml } from './html'

function containerWidth(caps?: CanvasCaps): number {
  return caps?.containerWidth ?? EXPORT_CONTAINER_WIDTH
}
function maxDim(caps?: CanvasCaps): number {
  return caps?.maxCanvasDimPx ?? BROWSER_CANVAS_MAX
}
function lightVars(caps?: CanvasCaps): string {
  return caps?.lightThemeVars ?? LIGHT_THEME_VARS
}

/**
 * Build an offscreen container hosting a clone of the live `.moraya-editor`, or
 * null if the editor isn't mounted. Caller detaches it from document.body.
 */
export function buildEditorContainer(
  getContainer: () => HTMLElement | null,
  caps?: CanvasCaps,
): HTMLElement | null {
  const editorEl = getContainer()
  if (!editorEl) return null

  const width = containerWidth(caps)
  const container = document.createElement('div')
  container.style.cssText =
    `position:fixed;left:-9999px;top:0;width:${width}px;background:#fff;padding:2rem 1rem;${lightVars(caps)}`

  const clone = editorEl.cloneNode(true) as HTMLElement
  clone.removeAttribute('contenteditable')
  clone.style.outline = 'none'
  clone.style.caretColor = 'transparent'
  clone.querySelectorAll('.ProseMirror-selectednode, .ProseMirror-gapcursor').forEach((el) => el.remove())

  container.appendChild(clone)
  document.body.appendChild(container)
  return container
}

/** Build an offscreen container from rendered HTML (source-mode / no-editor fallback). */
export function buildHtmlContainer(htmlContent: string, caps?: CanvasCaps): HTMLElement {
  const width = containerWidth(caps)
  const container = document.createElement('div')
  container.style.cssText =
    `position:fixed;left:-9999px;top:0;width:${width}px;background:#fff;padding:2rem 1rem;${lightVars(caps)}`

  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlContent, 'text/html')
  doc.querySelectorAll('style').forEach((style) => container.appendChild(style.cloneNode(true)))

  const contentDiv = document.createElement('div')
  contentDiv.innerHTML = sanitizeHtml(doc.body.innerHTML)
  container.appendChild(contentDiv)

  document.body.appendChild(container)
  return container
}

/** Hard-error if a canvas would exceed the browser's renderable dimension cap. */
export function assertCanvasFits(
  width: number,
  height: number,
  where: string,
  caps?: CanvasCaps,
): void {
  const cap = maxDim(caps)
  if (width > cap || height > cap) {
    throw new Error(
      `Canvas too large for ${where} (${Math.round(width)}×${Math.round(height)}). ` +
        `Browsers cap canvas dimensions near ${cap}px per axis; ` +
        'try splitting the document or lowering the export scale.',
    )
  }
}

/**
 * Pick a render scale from document length so long docs stay within the canvas
 * cap. Single-canvas is the tightest constraint (the whole doc is one canvas).
 */
export function pickAdaptiveScale(
  totalCssHeight: number,
  mode: 'single' | 'paged',
  caps?: CanvasCaps,
): number {
  const cap = maxDim(caps)
  const maxScale = caps?.maxSingleScale ?? 2
  if (mode === 'single') {
    const maxByCanvas = cap / Math.max(1, totalCssHeight)
    if (maxByCanvas >= maxScale) return maxScale
    if (maxByCanvas >= 1.5) return 1.5
    if (maxByCanvas >= 1) return 1
    return Math.max(0.5, maxByCanvas)
  }
  const totalPages = Math.ceil(totalCssHeight / PAGE_CSS_PX_HEIGHT)
  if (totalPages > 300) return 1
  if (totalPages > 100) return 1.5
  return Math.min(2, maxScale)
}

/**
 * Content-aware vertical page-break offsets (CSS px) that never slice through an
 * atomic block (table rows, headings, list items, paragraphs, images, code /
 * quote blocks). Measures the DOM then delegates to the pure solver.
 */
export function computePageBreaks(container: HTMLElement, totalHeight: number): number[] {
  const containerTop = container.getBoundingClientRect().top
  const atoms = Array.from(
    container.querySelectorAll<HTMLElement>('tr, h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, img, figure'),
  )
    .map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top - containerTop, bottom: r.bottom - containerTop }
    })
    .filter((a) => a.bottom > a.top + 0.5)

  return computeBreakOffsets(atoms, totalHeight, PAGE_CSS_PX_HEIGHT)
}

/** Capture the container as a single canvas (long-image PNG). */
export async function captureContainerAsSingleCanvas(
  container: HTMLElement,
  html2canvas: Html2CanvasFn,
  caps?: CanvasCaps,
): Promise<HTMLCanvasElement> {
  const width = containerWidth(caps)
  const totalHeight = container.offsetHeight
  const scale = pickAdaptiveScale(totalHeight, 'single', caps)
  assertCanvasFits(width * scale, totalHeight * scale, 'image export', caps)
  return await html2canvas(container, {
    backgroundColor: '#ffffff',
    scale,
    useCORS: true,
    logging: false,
    windowWidth: width,
  })
}

/**
 * Capture the container as N page-sized canvases via html2canvas `y` + `height`
 * clipping. Avoids one giant canvas (root cause of blank multi-page PDFs when
 * the per-axis cap is silently hit).
 */
export async function captureContainerAsPages(
  container: HTMLElement,
  html2canvas: Html2CanvasFn,
  caps?: CanvasCaps,
): Promise<{ canvases: HTMLCanvasElement[]; scale: number }> {
  const width = containerWidth(caps)
  const totalHeight = container.offsetHeight
  if (totalHeight <= 0) throw new Error('Document container has zero height; nothing to export.')

  const scale = pickAdaptiveScale(totalHeight, 'paged', caps)
  assertCanvasFits(width * scale, PAGE_CSS_PX_HEIGHT * scale, 'PDF page', caps)

  const breaks = computePageBreaks(container, totalHeight)
  const pageCount = breaks.length - 1
  const canvases: HTMLCanvasElement[] = []
  for (let i = 0; i < pageCount; i++) {
    const y = breaks[i]!
    const h = breaks[i + 1]! - y
    if (h <= 0) continue
    const pageCanvas = await html2canvas(container, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      logging: false,
      y,
      height: h,
      windowWidth: width,
    })
    if (pageCanvas.width === 0 || pageCanvas.height === 0) {
      throw new Error(`Page ${i + 1}/${pageCount} captured as empty canvas.`)
    }
    canvases.push(pageCanvas)
  }
  return { canvases, scale }
}

/** Encode a canvas to PNG bytes via Blob (avoids the dataURL base64 hop). */
export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}
