// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * @moraya/core/convert — shared Markdown ⇄ Typst source conversion.
 *
 * A document is authored as EITHER markdown or Typst (see `@moraya/core/typst`),
 * and this module is the migration path between the two. It converts *source to
 * source* — it does not compile anything to PDF.
 *
 * The two directions are not symmetric:
 *
 *   - **Markdown → Typst** is a plain serialization: markdown has a small,
 *     closed syntax, so core parses it to the ProseMirror AST it already owns
 *     and walks that. No new dependency, works on every platform.
 *
 *   - **Typst → Markdown** cannot be done by parsing: Typst is a programming
 *     language (`#let`, functions, `#import`, show/set rules), so recovering a
 *     document needs an *evaluator*, not a syntax tree. The evaluator we already
 *     have is the compiler itself — so this direction runs the injected
 *     `TypstCompiler` to HTML and converts that.
 *
 * Conversion is inherently lossy in both directions (layout, spacing, generated
 * content, third-party packages). Callers are expected to write the result to a
 * NEW document rather than overwrite the source.
 */

import type { TypstCompiler } from '../typst/types'

/** Non-throwing conversion outcome — a failed conversion is an expected state. */
export type ConversionResult =
  | { ok: true; content: string; warnings: string[] }
  | { ok: false; reason: ConversionFailure; message: string }

export type ConversionFailure =
  /** The source could not be parsed / compiled (syntax error, missing package). */
  | 'source-error'
  /** A capability the direction needs is unavailable on this platform. */
  | 'unsupported'
  /** Infrastructure failure (engine missing, IPC dead). */
  | 'engine-error'

/** Options for markdown → Typst. */
export interface MarkdownToTypstOptions {
  /**
   * How to carry markdown's LaTeX math into Typst.
   *
   * Typst's math syntax is NOT LaTeX (`frac(a, b)` vs `\frac{a}{b}`), so copying
   * formulas verbatim produces a `.typ` that does not compile. Default `mitex`
   * wraps them in the Typst `mitex` package, which renders LaTeX as-is — the
   * formula keeps working without a lossy syntax translation.
   *
   *   - `mitex`  — emit `#mi("…")` / `#mitex("…")` and an import header
   *   - `raw`    — emit `$…$` verbatim (only safe when the math already uses
   *                Typst syntax; may not compile)
   *   - `code`   — emit the formula as inline/raw code, never compiles as math
   *                but never breaks the build
   */
  math?: 'mitex' | 'raw' | 'code'
}

/** Dependencies for Typst → markdown (the compiler does the evaluation). */
export interface TypstToMarkdownDeps {
  /** Same injected compiler used for preview/export — must support `'html'`. */
  compiler: TypstCompiler
}
