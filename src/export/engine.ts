// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Export orchestrator — the DI surface. Turns markdown / the live editor DOM
 * into export bytes and hands them to the injected `FileSink`. Platform code
 * (Tauri save-dialog + native-PDF, browser download, Capacitor Share) lives in
 * the consumer's `FileSink`; this module is host-agnostic and never throws
 * (returns a discriminated `ExportResult`, like DocSyncIO).
 */

import {
  type ExportDeps,
  type ExportFormat,
  type ExportResult,
  type Html2CanvasFn,
  type JsPdfCtor,
  extensionForFormat,
  mimeForFormat,
} from './types'
import {
  markdownToHtml,
  markdownToLatex,
  inferDocumentTitle,
} from './html'
import {
  buildEditorContainer,
  buildHtmlContainer,
  captureContainerAsSingleCanvas,
  captureContainerAsPages,
  canvasToPngBytes,
} from './capture'
import { composePdf } from './pdf'

const encoder = new TextEncoder()

function defaultGetContainer(): HTMLElement | null {
  return document.querySelector('.moraya-editor') as HTMLElement | null
}

async function resolveHtml2Canvas(deps: ExportDeps): Promise<Html2CanvasFn> {
  if (deps.html2canvas) return deps.html2canvas
  const mod = (await import('html2canvas')) as unknown as { default: Html2CanvasFn }
  return mod.default
}

async function resolveJsPdf(deps: ExportDeps): Promise<JsPdfCtor> {
  if (deps.jsPDF) return deps.jsPDF
  const mod = (await import('jspdf')) as unknown as { jsPDF: JsPdfCtor }
  return mod.jsPDF
}

/** Obtain an offscreen capture container (editor clone preferred, HTML fallback). */
async function getDocumentContainer(deps: ExportDeps, markdown: string): Promise<HTMLElement> {
  const getContainer = deps.getContainer ?? defaultGetContainer
  const editorContainer = buildEditorContainer(getContainer, deps.caps)
  if (editorContainer) return editorContainer
  const html = await markdownToHtml(markdown, true, deps.mermaid)
  return buildHtmlContainer(html, deps.caps)
}

// ── Producers (bytes, no sink) ───────────────────────────────────────────────

export function renderLatex(markdown: string): Uint8Array {
  return encoder.encode(markdownToLatex(markdown))
}

export async function renderHtmlBytes(
  markdown: string,
  deps: Pick<ExportDeps, 'mermaid'>,
  includeStyles: boolean,
): Promise<Uint8Array> {
  return encoder.encode(await markdownToHtml(markdown, includeStyles, deps.mermaid))
}

/** Capture the live container to a single-canvas PNG. */
export async function renderImage(deps: ExportDeps): Promise<Uint8Array> {
  const markdown = deps.getMarkdown?.() ?? ''
  const html2canvas = await resolveHtml2Canvas(deps)
  const container = await getDocumentContainer(deps, markdown)
  try {
    const canvas = await captureContainerAsSingleCanvas(container, html2canvas, deps.caps)
    return await canvasToPngBytes(canvas)
  } finally {
    container.parentNode?.removeChild(container)
  }
}

/** Capture the live container to page slices and assemble a paginated PDF. */
export async function renderPdf(deps: ExportDeps): Promise<Uint8Array> {
  const markdown = deps.getMarkdown?.() ?? ''
  deps.onProgress?.({ phase: 'rendering' })
  const html2canvas = await resolveHtml2Canvas(deps)
  const JsPDF = await resolveJsPdf(deps)
  const container = await getDocumentContainer(deps, markdown)
  let pages: { canvases: HTMLCanvasElement[]; scale: number }
  try {
    pages = await captureContainerAsPages(container, html2canvas, deps.caps)
  } finally {
    container.parentNode?.removeChild(container)
  }
  const total = pages.canvases.length
  const bytes = composePdf(pages, JsPDF, (i) =>
    deps.onProgress?.({ phase: 'paginating', current: i, total }),
  )
  deps.onProgress?.({ phase: 'writing' })
  return bytes
}

// ── Orchestrator (bytes → sink) ──────────────────────────────────────────────

/**
 * Export a document in `format`, writing the result through `deps.sink`.
 * Non-throwing: returns `{ok:false, reason, message}` on failure. The consumer
 * remains responsible for anything host-specific it wants BEFORE bytes exist
 * (e.g. PC shows the Tauri save-dialog first, and routes PDF to its native
 * print path when preferred).
 */
export async function exportDocument(
  format: ExportFormat,
  deps: ExportDeps,
): Promise<ExportResult> {
  deps.onProgress?.({ phase: 'preparing' })
  try {
    let bytes: Uint8Array
    switch (format) {
      case 'latex':
        bytes = renderLatex(deps.getMarkdown?.() ?? '')
        break
      case 'html':
        bytes = await renderHtmlBytes(deps.getMarkdown?.() ?? '', deps, true)
        break
      case 'html-plain':
        bytes = await renderHtmlBytes(deps.getMarkdown?.() ?? '', deps, false)
        break
      case 'doc':
        bytes = await renderHtmlBytes(deps.getMarkdown?.() ?? '', deps, true)
        break
      case 'image':
        deps.onProgress?.({ phase: 'rendering' })
        bytes = await renderImage(deps)
        break
      case 'pdf':
        bytes = await renderPdf(deps)
        break
      default:
        bytes = encoder.encode(deps.getMarkdown?.() ?? '')
    }

    deps.onProgress?.({ phase: 'writing' })
    const title = deps.documentTitle ?? inferDocumentTitle(deps.getMarkdown?.() ?? '')
    const name = `${sanitizeFilename(title)}.${extensionForFormat(format)}`
    await deps.sink.save(name, bytes, mimeForFormat(format))
    deps.onProgress?.({ phase: 'done' })
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    deps.onProgress?.({ phase: 'error', message })
    const reason = /Canvas too large/.test(message) ? 'canvas-too-large' : 'error'
    return { ok: false, reason, message }
  }
}

function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ').trim().slice(0, 80)
  return cleaned || 'document'
}
