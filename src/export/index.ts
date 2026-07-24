// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/export — shared document export (PDF / long-image PNG / HTML /
 * DOC / LaTeX) for PC / Web / Mobile.
 *
 * Long-image + PDF screenshot the already-rendered `.moraya-editor` DOM
 * (full fidelity: tables, KaTeX, mermaid, highlighted code) via html2canvas;
 * HTML / DOC / LaTeX render markdown to a string (markdown-it, closing the
 * desktop regex renderer's table/ordered-list/highlight gap).
 *
 * Platform IO is dependency-injected via `ExportDeps` (FileSink, MermaidRenderer,
 * CanvasCaps, optional html2canvas/jsPDF overrides), mirroring DocSyncIO.
 * `html2canvas` and `jspdf` are OPTIONAL peers — only consumers importing
 * `/export` install them.
 */

export {
  exportDocument,
  renderImage,
  renderPdf,
  renderLatex,
  renderHtmlBytes,
} from './engine'

export {
  markdownToHtml,
  markdownToHtmlBody,
  renderMermaidInHtml,
  sanitizeHtml,
  escapeHtml,
  unescapeHtml,
  markdownToLatex,
  inferDocumentTitle,
} from './html'

export {
  buildEditorContainer,
  buildHtmlContainer,
  captureContainerAsSingleCanvas,
  captureContainerAsPages,
  canvasToPngBytes,
  computePageBreaks,
  pickAdaptiveScale,
  assertCanvasFits,
} from './capture'

export { composePdf } from './pdf'
export { computeBreakOffsets } from './pagination'
export type { BlockExtent } from './pagination'

export {
  EXPORT_OPTIONS,
  EXPORT_CONTAINER_WIDTH,
  BROWSER_CANVAS_MAX,
  PAGE_CSS_PX_HEIGHT,
  LIGHT_THEME_VARS,
  mimeForFormat,
  extensionForFormat,
} from './types'
export type {
  ExportFormat,
  ExportOption,
  ExportPhase,
  ExportProgress,
  ExportResult,
  ExportDeps,
  FileSink,
  MermaidRenderer,
  CanvasCaps,
  Html2CanvasFn,
  JsPdfCtor,
  JsPdfLike,
} from './types'
