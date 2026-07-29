// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/typst — shared Typst authoring core.
 *
 * Consumed by PC / Web / Mobile. The compiler is injected per platform (see
 * `TypstCompiler` in ./types); everything here is platform-agnostic.
 */

export {
  MARKDOWN_EXTENSIONS,
  TYPST_EXTENSIONS,
  TYPST_PREVIEW_DEBOUNCE_MS,
  type DocumentFlavor,
  type TypstArtifact,
  type TypstCompileResult,
  type TypstCompiler,
  type TypstOutputFormat,
  type TypstPhase,
  type TypstProgress,
} from './types'

export {
  DOCUMENT_EXTENSIONS,
  documentExtension,
  extensionForFlavor,
  flavorForFile,
  isDocumentFile,
  isMarkdownFile,
  isTypstFile,
  withFlavorExtension,
} from './flavor'

export {
  compileTypst,
  createPreviewCompiler,
  normalizeDiagnostic,
  type PreviewCompiler,
  type PreviewCompilerOptions,
} from './engine'

export {
  tokenizeTypst,
  typstTokenClass,
  type TypstToken,
  type TypstTokenType,
} from './highlight'

export {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  clampZoom,
  zoomByWheel,
  anchoredScroll,
  isZoomGesture,
  fitPageBox,
  type AnchoredScrollInput,
  type Box,
} from './viewport'

export { extractTypstOutline, type TypstHeading } from './outline'

export {
  parseTemplateIndex,
  templateCategories,
  filterTemplates,
  compareVersions,
  templatePackageUrl,
  templateThumbnailUrl,
  templateImportSpec,
  type TypstTemplate,
  type TemplateFilter,
} from './templates'

export {
  DEFAULT_VIEW_MODES,
  viewModeForFlavor,
  rememberViewMode,
  type DocumentViewMode,
  type ViewModeMemory,
} from './view-mode'
