// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Typst document export — HTML / Word / long-image PNG.
 *
 * A `.typ` document cannot go through the markdown export pipeline: there is no
 * `.moraya-editor` DOM to screenshot and no markdown to render. What there is,
 * on every platform, is the compiler — so export is built from its output.
 *
 * **Everything here derives from SVG**, because SVG is the one format both
 * compilers produce in memory: the desktop's native `typst` CLI and typst.ts's
 * WASM build (whose `CompileFormatEnum` is only `vector | pdf` — it has no HTML
 * writer at all). Deriving from the rendered pages also means the export looks
 * exactly like the preview, which for a typesetting system is the point.
 *
 * **PDF is deliberately NOT here.** Both platforms have a real PDF writer, and
 * re-encoding pages through a canvas would replace vector text with pixels —
 * strictly worse. Callers route `pdf` to `compiler.compile(source, 'pdf')`.
 */

import type { ExportProgress, ExportResult, FileSink } from './types'
import { BROWSER_CANVAS_MAX, mimeForFormat, extensionForFormat } from './types'
import type { TypstCompiler } from '../typst/types'

/**
 * Local, deliberately NOT imported from `./html`.
 *
 * That module pulls in markdown-it, which this path has no use for — importing
 * it would drag the whole markdown parser into any bundle that only exports a
 * Typst document.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Formats this module renders. Mirrors the markdown export menu minus PDF and
 * LaTeX (see the module note).
 */
export type TypstExportFormat = 'html' | 'doc' | 'image'

/** Every format a Typst document can be exported as, in menu order. */
export const TYPST_EXPORT_FORMATS = ['pdf', 'image', 'html', 'doc'] as const

export interface TypstExportDeps {
  /** Same injected compiler used for preview — only `'svg'` is required. */
  compiler: TypstCompiler
  sink: FileSink
  /** Base filename, without extension. */
  documentTitle?: string
  onProgress?: (progress: ExportProgress) => void
  /**
   * Raster scale for `image` / `doc`. 2 keeps text crisp on HiDPI displays
   * without quadrupling the file for no visible gain.
   */
  pixelRatio?: number
  /** Hard cap per canvas axis. Past this a browser silently returns blank. */
  maxCanvasDimPx?: number
}

const encoder = new TextEncoder()

/**
 * Export a Typst document.
 *
 * Never throws: failures come back as `{ ok: false }` so the caller can surface
 * them beside the editor, matching `exportDocument`'s contract.
 */
export async function exportTypstDocument(
  format: TypstExportFormat,
  source: string,
  deps: TypstExportDeps,
): Promise<ExportResult> {
  if (!source.trim()) return { ok: false, reason: 'empty', message: 'The document is empty.' }

  deps.onProgress?.({ phase: 'preparing' })
  try {
    // May download the engine on first use (desktop) or load WASM (web).
    await deps.compiler.prepare?.()

    deps.onProgress?.({ phase: 'rendering' })
    const artifact = await deps.compiler.compile(source, 'svg')
    const pages = artifact.pages.filter((p) => p.trim())
    if (pages.length === 0) {
      return { ok: false, reason: 'empty', message: 'The Typst compiler produced no pages.' }
    }

    let bytes: Uint8Array
    let mime: string
    switch (format) {
      case 'html':
        bytes = encoder.encode(typstPagesToHtml(pages, deps.documentTitle))
        mime = mimeForFormat('html')
        break
      case 'doc': {
        // Word's HTML import does not render SVG reliably, so pages go in as
        // raster <img>. This is why `doc` rasterizes and `html` does not.
        deps.onProgress?.({ phase: 'paginating', total: pages.length })
        const images = await rasterizePages(pages, deps)
        bytes = encoder.encode(typstImagesToHtml(images, deps.documentTitle))
        mime = mimeForFormat('doc')
        break
      }
      case 'image': {
        deps.onProgress?.({ phase: 'paginating', total: pages.length })
        bytes = await renderTypstLongImage(pages, deps)
        mime = mimeForFormat('image')
        break
      }
    }

    deps.onProgress?.({ phase: 'writing' })
    const name = `${sanitizeFilename(deps.documentTitle ?? 'document')}.${extensionForFormat(format)}`
    await deps.sink.save(name, bytes, mime)
    deps.onProgress?.({ phase: 'done' })
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    deps.onProgress?.({ phase: 'error', message })
    const reason = /Canvas too large/.test(message) ? 'canvas-too-large' : 'error'
    return { ok: false, reason, message }
  }
}

/* ------------------------------------------------------------------- HTML */

const PAGE_CSS = `
  body { margin: 0; padding: 24px; background: #f4f4f5;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .typst-doc { display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .typst-page { background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.14); line-height: 0;
                max-width: 100%; }
  .typst-page svg, .typst-page img { display: block; max-width: 100%; height: auto; }
  @media print {
    body { padding: 0; background: none; }
    .typst-doc { gap: 0; }
    .typst-page { box-shadow: none; break-after: page; }
  }
`

/** Wrap compiled SVG pages in a standalone HTML document. */
export function typstPagesToHtml(pages: string[], title?: string): string {
  const body = pages
    .map((svg) => `<div class="typst-page">${stripSvgScripts(svg)}</div>`)
    .join('\n')
  return htmlShell(body, title)
}

/** Wrap rasterized pages in a standalone HTML document (the `.doc` payload). */
export function typstImagesToHtml(pngDataUris: string[], title?: string): string {
  const body = pngDataUris
    .map((src, i) => `<div class="typst-page"><img src="${src}" alt="Page ${i + 1}"></div>`)
    .join('\n')
  return htmlShell(body, title)
}

function htmlShell(body: string, title?: string): string {
  const heading = escapeHtml(title || 'Document')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="typst-doc">
${body}
</div>
</body>
</html>`
}

/**
 * Remove scripting from compiled SVG.
 *
 * typst.ts embeds a script for its text-selection overlay. Harmless in the app,
 * but an exported file is opened outside it — and a document that runs code is
 * not what "export to HTML" promises.
 */
export function stripSvgScripts(svg: string): string {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
}

/* ------------------------------------------------------------------ raster */

/** Intrinsic pixel size of an SVG, from its width/height or its viewBox. */
export function svgPixelSize(svg: string): { width: number; height: number } {
  const num = (v: string | null | undefined) => {
    const n = parseFloat(String(v ?? ''))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const width = num(/\bwidth="([^"]+)"/.exec(svg)?.[1])
  const height = num(/\bheight="([^"]+)"/.exec(svg)?.[1])
  if (width && height) return { width, height }

  const box = /\bviewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/[\s,]+/)
  if (box && box.length === 4) {
    const w = num(box[2])
    const h = num(box[3])
    if (w && h) return { width: w, height: h }
  }
  return { width: 0, height: 0 }
}

/** Decode one SVG page into an <img> the canvas can draw. */
async function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  // A blob URL rather than a data: URI — a multi-megabyte page SVG as a
  // percent-encoded data URI runs into per-URL length limits in some engines.
  const url = URL.createObjectURL(new Blob([stripSvgScripts(svg)], { type: 'image/svg+xml' }))
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('A compiled page could not be rasterized.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasOf(width: number, height: number, cap: number): HTMLCanvasElement {
  if (width > cap || height > cap) {
    throw new Error(`Canvas too large (${Math.round(width)}×${Math.round(height)}px, max ${cap}px).`)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/** Rasterize each page to a PNG data URI, in page order. */
async function rasterizePages(pages: string[], deps: TypstExportDeps): Promise<string[]> {
  const scale = deps.pixelRatio ?? 2
  const cap = deps.maxCanvasDimPx ?? BROWSER_CANVAS_MAX
  const out: string[] = []

  for (let i = 0; i < pages.length; i++) {
    deps.onProgress?.({ phase: 'paginating', current: i + 1, total: pages.length })
    const svg = pages[i]!
    const size = svgPixelSize(svg)
    const img = await loadSvgImage(svg)
    const w = (size.width || img.naturalWidth) * scale
    const h = (size.height || img.naturalHeight) * scale
    const canvas = canvasOf(w, h, cap)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable.')
    // Pages are white; without this, transparent margins turn black in Word.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    out.push(canvas.toDataURL('image/png'))
  }
  return out
}

/**
 * Render every page into ONE tall PNG.
 *
 * Matches what "export as image" means for a markdown document — a single long
 * image, not a folder of files the user has to reassemble.
 */
export async function renderTypstLongImage(
  pages: string[],
  deps: TypstExportDeps,
): Promise<Uint8Array> {
  const scale = deps.pixelRatio ?? 2
  const cap = deps.maxCanvasDimPx ?? BROWSER_CANVAS_MAX
  const gap = Math.round(16 * scale)

  const images: { img: HTMLImageElement; width: number; height: number }[] = []
  for (let i = 0; i < pages.length; i++) {
    deps.onProgress?.({ phase: 'paginating', current: i + 1, total: pages.length })
    const svg = pages[i]!
    const size = svgPixelSize(svg)
    const img = await loadSvgImage(svg)
    images.push({
      img,
      width: (size.width || img.naturalWidth) * scale,
      height: (size.height || img.naturalHeight) * scale,
    })
  }

  const width = Math.max(...images.map((p) => p.width))
  const height = images.reduce((sum, p) => sum + p.height, 0) + gap * (images.length - 1)
  const canvas = canvasOf(width, height, cap)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let y = 0
  for (const page of images) {
    // Centre narrower pages so a mixed-size document does not look ragged.
    ctx.drawImage(page.img, Math.round((width - page.width) / 2), y, page.width, page.height)
    y += page.height + gap
  }

  return canvasToPng(canvas)
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The image could not be encoded.')
  return new Uint8Array(await blob.arrayBuffer())
}

function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ').trim().slice(0, 80)
  return cleaned || 'document'
}
