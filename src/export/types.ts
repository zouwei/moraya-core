// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/export — shared document-export contracts.
 *
 * The platform-agnostic type surface for exporting a Moraya document to PDF,
 * long-image PNG, styled HTML, DOC (HTML-as-Word), or LaTeX. Long-image and PDF
 * work by screenshotting the already-rendered `.moraya-editor` DOM (full render
 * fidelity — tables, KaTeX, mermaid, highlighted code) via html2canvas; HTML /
 * DOC / LaTeX render markdown to a string.
 *
 * Platform differences are dependency-injected (see `ExportDeps`), mirroring the
 * DocSyncIO pattern: core builds the export bytes; the consumer supplies the
 * file sink (Tauri save-dialog / browser download / Capacitor Share), the
 * mermaid renderer, and per-platform canvas caps.
 */

export type ExportFormat = 'pdf' | 'html' | 'html-plain' | 'doc' | 'latex' | 'image'

/** Coarse phases a consumer can surface in a progress indicator. */
export type ExportPhase =
  | 'preparing'
  | 'rendering'
  | 'paginating'
  | 'writing'
  | 'done'
  | 'error'

export interface ExportProgress {
  phase: ExportPhase
  /** 1-indexed current page (paginating phase). */
  current?: number
  total?: number
  message?: string
}

/**
 * Platform file sink — one method, three implementations. Bytes are always
 * `Uint8Array`; text formats are UTF-8 encoded upstream so a single method
 * covers every format.
 *   - PC (Tauri): save-dialog → `write_file` (text) / `write_file_bytes` (binary)
 *   - Web: Blob + `<a download>`
 *   - Mobile (Capacitor): `Filesystem.writeFile(Cache, base64)` + `Share.share`
 */
export interface FileSink {
  /** Persist `bytes` for the user. `suggestedName` includes the extension. */
  save(suggestedName: string, bytes: Uint8Array, mime: string): Promise<void>
}

/**
 * Injected mermaid renderer — used ONLY by the text (HTML/DOC) path, since the
 * capture path screenshots the already-rendered SVG in the live DOM. Returns
 * the SVG string, or an error marker (the caller keeps the `<pre><code>`
 * fallback). Never throws.
 */
export type MermaidRenderer = (code: string) => Promise<{ svg: string } | { error: string }>

/**
 * Per-platform canvas limits. Browsers silently return a blank canvas past a
 * per-axis dimension cap; iOS WKWebView is stricter than Chromium. A consumer
 * injects tighter values on the affected platform.
 */
export interface CanvasCaps {
  /** Max px on either canvas axis before we hard-error. Default 16384. */
  maxCanvasDimPx?: number
  /** Offscreen render container CSS width. Default 800. */
  containerWidth?: number
  /** Upper bound for the adaptive single-canvas scale. Default 2. */
  maxSingleScale?: number
  /** Inline style forcing light-theme CSS vars onto the export container. */
  lightThemeVars?: string
}

/** html2canvas call signature (structural — avoids a hard type dep). */
export type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>

/** jsPDF constructor (structural). */
export interface JsPdfLike {
  addPage(): void
  addImage(
    data: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void
  output(type: 'arraybuffer'): ArrayBuffer
}
export type JsPdfCtor = new (opts: Record<string, unknown>) => JsPdfLike

/**
 * Dependency-injected platform surface for one export call. Only `sink` is
 * required; everything else has a sensible default (container = the on-page
 * `.moraya-editor`; html2canvas/jsPDF lazily imported from the optional peer).
 */
export interface ExportDeps {
  sink: FileSink
  onProgress?: (p: ExportProgress) => void
  /** Live render container to capture. Default: `querySelector('.moraya-editor')`. */
  getContainer?: () => HTMLElement | null
  /** Markdown source for text formats. Lazy so huge-doc serialization is deferred. */
  getMarkdown?: () => string
  documentTitle?: string
  /** Text-path mermaid renderer. Omit → mermaid stays as `<pre><code>`. */
  mermaid?: MermaidRenderer
  caps?: CanvasCaps
  /** Inject html2canvas (e.g. web's lazy-loaded instance). Else engine imports the peer. */
  html2canvas?: Html2CanvasFn
  /** Inject jsPDF constructor. Else engine imports the peer. */
  jsPDF?: JsPdfCtor
}

export type ExportResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'canvas-too-large' | 'error'; message?: string }

// ── Defaults ─────────────────────────────────────────────────────────────────

/** Container CSS width for all export rendering; keeps layout reproducible. */
export const EXPORT_CONTAINER_WIDTH = 800

/**
 * Conservative single-axis canvas dimension cap. Chromium hard-limits at 32767
 * but blanks above ~16384 on many GPUs; WebKit is similar. Anything larger is a
 * hard error so the caller sees a real failure, not a silently blank export.
 */
export const BROWSER_CANVAS_MAX = 16384

// A4 portrait, 10mm margins → 190×277mm content.
export const PDF_PAGE_WIDTH_MM = 210
export const PDF_PAGE_HEIGHT_MM = 297
export const PDF_MARGIN_MM = 10
export const PDF_CONTENT_WIDTH_MM = PDF_PAGE_WIDTH_MM - 2 * PDF_MARGIN_MM
export const PDF_CONTENT_HEIGHT_MM = PDF_PAGE_HEIGHT_MM - 2 * PDF_MARGIN_MM

/** CSS px of container height that corresponds to one PDF page at the export width. */
export const PAGE_CSS_PX_HEIGHT =
  EXPORT_CONTAINER_WIDTH * (PDF_CONTENT_HEIGHT_MM / PDF_CONTENT_WIDTH_MM)

/**
 * Light-theme variable overrides forced onto export containers. A document
 * authored/viewed in dark mode inherits a near-white `--text-primary`, so a
 * screenshot would paint light text on the forced-white page = an invisible
 * export. Pinning light values makes exports look right in any app theme.
 */
export const LIGHT_THEME_VARS =
  '--bg-primary:#ffffff;--bg-secondary:#f8f9fa;--bg-hover:#e9ecef;--bg-active:#dee2e6;' +
  '--text-primary:#1a1a1a;--text-secondary:#6c757d;--text-muted:#adb5bd;' +
  '--border-color:#e0e0e0;--border-light:#f0f0f0;--accent-color:#4a90d9;'

export interface ExportOption {
  format: ExportFormat
  labelKey: string
  extension: string
  mimeType: string
}

export const EXPORT_OPTIONS: ExportOption[] = [
  { format: 'pdf', labelKey: 'export.pdf', extension: 'pdf', mimeType: 'application/pdf' },
  { format: 'html', labelKey: 'export.html', extension: 'html', mimeType: 'text/html' },
  { format: 'html-plain', labelKey: 'export.html_plain', extension: 'html', mimeType: 'text/html' },
  { format: 'image', labelKey: 'export.image', extension: 'png', mimeType: 'image/png' },
  { format: 'doc', labelKey: 'export.doc', extension: 'doc', mimeType: 'application/msword' },
  { format: 'latex', labelKey: 'export.latex', extension: 'tex', mimeType: 'application/x-latex' },
]

export function mimeForFormat(format: ExportFormat): string {
  return EXPORT_OPTIONS.find((o) => o.format === format)?.mimeType ?? 'application/octet-stream'
}

export function extensionForFormat(format: ExportFormat): string {
  return EXPORT_OPTIONS.find((o) => o.format === format)?.extension ?? 'txt'
}
