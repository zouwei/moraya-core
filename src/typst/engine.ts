// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Compile orchestration for Typst documents.
 *
 * Two pieces, both platform-agnostic:
 *   - `compileTypst` — a single non-throwing compile that normalizes compiler
 *     diagnostics and infrastructure failures into one result union.
 *   - `createPreviewCompiler` — the live-preview loop: debounce keystrokes,
 *     dedupe unchanged buffers, and drop results that a newer compile has
 *     superseded (without which a slow compile can repaint the pane with the
 *     previous document's pages).
 */

import {
  TYPST_PREVIEW_DEBOUNCE_MS,
  type TypstArtifact,
  type TypstCompileResult,
  type TypstCompiler,
  type TypstOutputFormat,
  type TypstProgress,
} from './types'

/** Trim a compiler diagnostic to something displayable next to the editor. */
export function normalizeDiagnostic(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const lines = raw.split('\n').slice(0, 12).join('\n').trim()
  return (lines || 'Typst compilation failed').slice(0, 1200)
}

/**
 * Compile once. Never throws: a Typst syntax error is an expected state while
 * the user types, so it comes back as `{ ok: false, reason: 'compile-error' }`.
 */
export async function compileTypst(
  compiler: TypstCompiler,
  source: string,
  format: TypstOutputFormat,
  opts?: { outputPath?: string; onProgress?: (p: TypstProgress) => void },
): Promise<TypstCompileResult> {
  const { outputPath, onProgress } = opts ?? {}
  try {
    if (compiler.prepare && compiler.isReady) {
      const ready = await compiler.isReady()
      if (!ready) {
        onProgress?.({ phase: 'preparing' })
        await compiler.prepare()
      }
    }
    onProgress?.({ phase: 'compiling' })
    const artifact = await compiler.compile(source, format, outputPath)
    onProgress?.({ phase: 'done' })
    return { ok: true, artifact }
  } catch (err) {
    const message = normalizeDiagnostic(err)
    onProgress?.({ phase: 'error', message })
    return { ok: false, reason: 'compile-error', message }
  }
}

export interface PreviewCompilerOptions {
  compiler: TypstCompiler
  /** Called with the pages of every accepted (non-stale) compile. */
  onPages: (pages: string[]) => void
  /** Called with a normalized diagnostic, or `null` once a compile succeeds. */
  onError?: (message: string | null) => void
  onProgress?: (p: TypstProgress) => void
  /** Override the keystroke debounce (ms). */
  debounceMs?: number
}

export interface PreviewCompiler {
  /** Queue a debounced recompile. Unchanged source is ignored. */
  request(source: string): void
  /** Compile immediately, bypassing the debounce. */
  flush(source: string): Promise<void>
  /** Cancel pending work and reject in-flight results. */
  dispose(): void
}

/**
 * Build the live-preview compile loop for a Typst editor surface.
 *
 * Every platform's preview pane needs the same three guarantees, and getting
 * any of them wrong is subtle: unchanged buffers must not recompile (the editor
 * re-emits content on tab restore), results must be dropped once superseded,
 * and disposal must not leave a timer that fires into an unmounted view.
 */
export function createPreviewCompiler(opts: PreviewCompilerOptions): PreviewCompiler {
  const { compiler, onPages, onError, onProgress } = opts
  const debounceMs = opts.debounceMs ?? TYPST_PREVIEW_DEBOUNCE_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  let lastCompiled: string | null = null
  let serial = 0
  let disposed = false

  async function run(source: string): Promise<void> {
    const mine = ++serial
    // Spread rather than pass `onProgress: undefined` — the package builds with
    // exactOptionalPropertyTypes, where an explicit undefined is not assignable
    // to an optional property.
    const result = await compileTypst(compiler, source, 'svg', {
      ...(onProgress ? { onProgress } : {}),
    })
    // A newer request (or disposal) superseded this one — its pages belong to
    // a buffer the user has already moved past.
    if (disposed || mine !== serial) return
    if (result.ok) {
      onError?.(null)
      onPages(result.artifact.pages)
    } else {
      onError?.(result.message)
    }
  }

  return {
    request(source: string) {
      if (disposed) return
      if (source === lastCompiled) return
      lastCompiled = source
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run(source)
      }, debounceMs)
    },
    async flush(source: string) {
      if (disposed) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      lastCompiled = source
      await run(source)
    },
    dispose() {
      disposed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      // Bump the serial so any in-flight compile resolves into a stale check.
      serial++
    },
  }
}

/** Re-exported for consumers that only need the artifact shape. */
export type { TypstArtifact }
