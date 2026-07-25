// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compileTypst, createPreviewCompiler, normalizeDiagnostic } from '../engine'
import type { TypstArtifact, TypstCompiler } from '../types'

/** A compiler whose every call is resolvable by the test. */
function deferredCompiler() {
  const calls: {
    source: string
    resolve: (a: TypstArtifact) => void
    reject: (e: unknown) => void
  }[] = []
  const compiler: TypstCompiler = {
    compile: (source) =>
      new Promise<TypstArtifact>((resolve, reject) => {
        calls.push({ source, resolve, reject })
      }),
  }
  return { compiler, calls }
}

describe('normalizeDiagnostic', () => {
  it('trims long diagnostics', () => {
    const msg = normalizeDiagnostic(new Error('x'.repeat(5000)))
    expect(msg.length).toBeLessThanOrEqual(1200)
  })

  it('keeps only the leading lines', () => {
    const msg = normalizeDiagnostic(new Error(Array.from({ length: 40 }, (_, i) => `L${i}`).join('\n')))
    expect(msg.split('\n')).toHaveLength(12)
  })

  it('falls back when the message is empty', () => {
    expect(normalizeDiagnostic(new Error(''))).toBe('Typst compilation failed')
  })
})

describe('compileTypst', () => {
  it('returns the artifact on success', async () => {
    const compiler: TypstCompiler = {
      compile: async () => ({ pages: ['<svg/>'] }),
    }
    const result = await compileTypst(compiler, '= Hi', 'svg')
    expect(result).toEqual({ ok: true, artifact: { pages: ['<svg/>'] } })
  })

  it('reports compile errors instead of throwing', async () => {
    const compiler: TypstCompiler = {
      compile: async () => {
        throw new Error('unexpected end of block')
      },
    }
    const result = await compileTypst(compiler, '#{', 'svg')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('unexpected end of block')
  })

  it('prepares the compiler when it is not ready yet', async () => {
    const prepare = vi.fn(async () => {})
    const compiler: TypstCompiler = {
      compile: async () => ({ pages: [] }),
      isReady: async () => false,
      prepare,
    }
    const phases: string[] = []
    await compileTypst(compiler, '', 'svg', { onProgress: (p) => phases.push(p.phase) })
    expect(prepare).toHaveBeenCalledOnce()
    expect(phases).toEqual(['preparing', 'compiling', 'done'])
  })

  it('skips preparation when already ready', async () => {
    const prepare = vi.fn(async () => {})
    const compiler: TypstCompiler = {
      compile: async () => ({ pages: [] }),
      isReady: async () => true,
      prepare,
    }
    await compileTypst(compiler, '', 'svg')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('passes the output path through for file formats', async () => {
    const compile = vi.fn(async () => ({ pages: [], files: ['doc.pdf'] }))
    await compileTypst({ compile }, '= Hi', 'pdf', { outputPath: '/tmp/doc.pdf' })
    expect(compile).toHaveBeenCalledWith('= Hi', 'pdf', '/tmp/doc.pdf')
  })
})

describe('createPreviewCompiler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces rapid keystrokes into a single compile', async () => {
    const { compiler, calls } = deferredCompiler()
    const preview = createPreviewCompiler({ compiler, onPages: () => {}, debounceMs: 100 })

    preview.request('a')
    preview.request('ab')
    preview.request('abc')
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.source).toBe('abc')
  })

  it('ignores an unchanged buffer', async () => {
    const { compiler, calls } = deferredCompiler()
    const preview = createPreviewCompiler({ compiler, onPages: () => {}, debounceMs: 100 })

    preview.request('same')
    await vi.advanceTimersByTimeAsync(100)
    preview.request('same')
    await vi.advanceTimersByTimeAsync(100)

    // The editor re-emits content on tab restore; that must not recompile.
    expect(calls).toHaveLength(1)
  })

  it('drops results superseded by a newer compile', async () => {
    const { compiler, calls } = deferredCompiler()
    const pages: string[][] = []
    const preview = createPreviewCompiler({ compiler, onPages: (p) => pages.push(p), debounceMs: 10 })

    preview.request('old')
    await vi.advanceTimersByTimeAsync(10)
    preview.request('new')
    await vi.advanceTimersByTimeAsync(10)
    expect(calls).toHaveLength(2)

    // The first (slow) compile finishes last — its pages belong to a buffer the
    // user has already moved past and must not repaint the preview.
    calls[1]!.resolve({ pages: ['NEW'] })
    calls[0]!.resolve({ pages: ['OLD'] })
    await vi.advanceTimersByTimeAsync(0)

    expect(pages).toEqual([['NEW']])
  })

  it('clears the error once a compile succeeds', async () => {
    const { compiler, calls } = deferredCompiler()
    const errors: (string | null)[] = []
    const preview = createPreviewCompiler({
      compiler,
      onPages: () => {},
      onError: (e) => errors.push(e),
      debounceMs: 10,
    })

    preview.request('bad')
    await vi.advanceTimersByTimeAsync(10)
    calls[0]!.reject(new Error('syntax error'))
    await vi.advanceTimersByTimeAsync(0)

    preview.request('good')
    await vi.advanceTimersByTimeAsync(10)
    calls[1]!.resolve({ pages: ['<svg/>'] })
    await vi.advanceTimersByTimeAsync(0)

    expect(errors[0]).toContain('syntax error')
    expect(errors[1]).toBeNull()
  })

  it('flush compiles immediately and cancels the pending debounce', async () => {
    const { compiler, calls } = deferredCompiler()
    const preview = createPreviewCompiler({ compiler, onPages: () => {}, debounceMs: 1000 })

    preview.request('typed')
    const flushed = preview.flush('typed')
    expect(calls).toHaveLength(1)

    calls[0]!.resolve({ pages: [] })
    await flushed
    // The queued debounce must not fire a second compile.
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toHaveLength(1)
  })

  it('does not emit after disposal', async () => {
    const { compiler, calls } = deferredCompiler()
    const pages: string[][] = []
    const preview = createPreviewCompiler({ compiler, onPages: (p) => pages.push(p), debounceMs: 10 })

    preview.request('x')
    await vi.advanceTimersByTimeAsync(10)
    preview.dispose()
    calls[0]!.resolve({ pages: ['LATE'] })
    await vi.advanceTimersByTimeAsync(0)

    // Emitting here would repaint an unmounted view.
    expect(pages).toEqual([])
  })

  it('does not fire a pending timer after disposal', async () => {
    const { compiler, calls } = deferredCompiler()
    const preview = createPreviewCompiler({ compiler, onPages: () => {}, debounceMs: 50 })

    preview.request('x')
    preview.dispose()
    await vi.advanceTimersByTimeAsync(100)

    expect(calls).toHaveLength(0)
  })
})
