// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/typst — shared Typst authoring contracts.
 *
 * Typst is a document *compiler*, not a WYSIWYG markup: a `.typ` document is
 * edited as source and rendered by compiling it to paginated SVG (preview) or
 * PDF/PNG/HTML (export). That makes it mutually exclusive with the markdown
 * ProseMirror surface — a document is edited as EITHER markdown or Typst.
 *
 * The compiler itself is dependency-injected (see `TypstCompiler`) because it
 * differs per platform and is far too heavy to bundle here:
 *   - PC (Tauri): the official `typst` CLI, downloaded on demand and invoked
 *     over IPC — zero WASM, keeps the desktop binary small.
 *   - Web: the typst.ts WASM compiler (~27 MB), lazily loaded in a Worker.
 *   - Mobile: a native plugin, or preview-only against a remote compile.
 *
 * What core owns is everything platform-agnostic: flavor detection, the
 * compile orchestration (debounce + stale-result rejection), and error
 * normalization — the logic that would otherwise be re-implemented, and drift,
 * on every platform.
 */

/** Markup language a document is authored in. Mutually exclusive by design. */
export type DocumentFlavor = 'markdown' | 'typst'

/** Output formats a Typst document can be compiled to. */
export type TypstOutputFormat = 'svg' | 'pdf' | 'png' | 'html'

/**
 * A compiled result.
 *
 * `pages` carries one SVG string per page for the `svg` preview format. The
 * file-producing formats write through the platform's own sink and report the
 * written file names instead (PNG is one file per page — Typst cannot merge
 * pages into a single raster).
 */
export interface TypstArtifact {
  /** Per-page SVG markup (`svg` format only). */
  pages: string[]
  /** File names written by a file-producing format, in page order. */
  files?: string[]
}

/**
 * Injected compiler. Implementations must be non-throwing for *compilation*
 * errors — a Typst syntax error is normal while typing, not an exception — and
 * should surface them through a rejected promise only for infrastructure
 * failures (engine missing, IPC dead). `compileTypst` normalizes both.
 */
export interface TypstCompiler {
  /**
   * Compile `source`. `outputPath` is required by the file-producing formats
   * and ignored by `svg`.
   */
  compile(
    source: string,
    format: TypstOutputFormat,
    outputPath?: string,
  ): Promise<TypstArtifact>
  /** True once the compiler is usable (e.g. the engine has been downloaded). */
  isReady?(): Promise<boolean>
  /** Prepare the compiler, downloading/initializing it if needed. */
  prepare?(): Promise<void>
}

/** Non-throwing compile outcome. */
export type TypstCompileResult =
  | { ok: true; artifact: TypstArtifact }
  | { ok: false; reason: 'compile-error' | 'engine-error' | 'stale'; message: string }

/** Coarse phases a consumer can surface while compiling. */
export type TypstPhase = 'preparing' | 'compiling' | 'done' | 'error'

export interface TypstProgress {
  phase: TypstPhase
  message?: string
}

/** File extensions that identify each document flavor. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'] as const
export const TYPST_EXTENSIONS = ['.typ'] as const

/**
 * Debounce for live preview recompilation. Typst compiles in tens of
 * milliseconds, so this is tuned for "stopped typing" rather than throughput.
 */
export const TYPST_PREVIEW_DEBOUNCE_MS = 450
