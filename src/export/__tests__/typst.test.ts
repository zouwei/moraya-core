// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect, vi } from 'vitest'
import {
  exportTypstDocument,
  typstPagesToHtml,
  typstImagesToHtml,
  stripSvgScripts,
  svgPixelSize,
  TYPST_EXPORT_FORMATS,
} from '../typst'
import type { FileSink } from '../types'
import type { TypstCompiler } from '../../typst/types'

const PAGE = '<svg width="596" height="842" viewBox="0 0 596 842"><text>hi</text></svg>'

/** A sink that records what it was handed. */
function recordingSink() {
  const saved: { name: string; text: string; mime: string }[] = []
  const sink: FileSink = {
    async save(name, bytes, mime) {
      saved.push({ name, text: new TextDecoder().decode(bytes), mime })
    },
  }
  return { sink, saved }
}

function compilerOf(pages: string[]): TypstCompiler {
  return { compile: async () => ({ pages }) }
}

describe('svgPixelSize', () => {
  it('reads width and height attributes', () => {
    expect(svgPixelSize(PAGE)).toEqual({ width: 596, height: 842 })
  })

  it('falls back to the viewBox', () => {
    // typst.ts omits width/height on some outputs; without this the page would
    // rasterize at 0×0 and export a blank image.
    expect(svgPixelSize('<svg viewBox="0 0 100 200">')).toEqual({ width: 100, height: 200 })
  })

  it('reports zero when the size is unknowable', () => {
    expect(svgPixelSize('<svg>')).toEqual({ width: 0, height: 0 })
  })
})

describe('stripSvgScripts', () => {
  it('removes the script typst.ts embeds', () => {
    // Harmless inside the app; an exported file is opened outside it, and
    // "export to HTML" must not hand the user a document that runs code.
    const out = stripSvgScripts('<svg><script>alert(1)</script><g/></svg>')
    expect(out).not.toContain('script')
    expect(out).toContain('<g/>')
  })

  it('removes inline event handlers', () => {
    expect(stripSvgScripts('<svg onload="x()"><g onclick=\'y()\'/></svg>')).toBe('<svg><g/></svg>')
  })
})

describe('typstPagesToHtml', () => {
  it('produces a standalone document with every page', () => {
    const html = typstPagesToHtml([PAGE, PAGE], 'My Doc')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<title>My Doc</title>')
    expect(html.match(/class="typst-page"/g)).toHaveLength(2)
  })

  it('embeds the SVG rather than linking it', () => {
    // The file has to survive being moved or emailed.
    expect(typstPagesToHtml([PAGE])).toContain('<svg')
  })

  it('escapes the title', () => {
    expect(typstPagesToHtml([PAGE], '<script>x</script>')).not.toContain('<script>x')
  })

  it('breaks pages when printed', () => {
    expect(typstPagesToHtml([PAGE])).toContain('break-after: page')
  })
})

describe('typstImagesToHtml', () => {
  it('embeds raster pages as img — what Word can actually render', () => {
    const html = typstImagesToHtml(['data:image/png;base64,AAA'], 'D')
    expect(html).toContain('<img src="data:image/png;base64,AAA"')
    expect(html).not.toContain('<svg')
  })
})

describe('exportTypstDocument', () => {
  it('exports HTML through the sink with the document title as filename', async () => {
    const { sink, saved } = recordingSink()
    const r = await exportTypstDocument('html', '= Hi', {
      compiler: compilerOf([PAGE]),
      sink,
      documentTitle: 'Report',
    })
    expect(r.ok).toBe(true)
    expect(saved[0]?.name).toBe('Report.html')
    expect(saved[0]?.mime).toBe('text/html')
    expect(saved[0]?.text).toContain('<svg')
  })

  it('asks the compiler for SVG — the one format both engines produce', async () => {
    // typst.ts has no HTML writer, so every derived format starts from SVG.
    const compile = vi.fn(async () => ({ pages: [PAGE] }))
    const { sink } = recordingSink()
    await exportTypstDocument('html', '= Hi', { compiler: { compile }, sink })
    expect(compile).toHaveBeenCalledWith('= Hi', 'svg')
  })

  it('prepares the engine before compiling', async () => {
    // First desktop use downloads the binary; skipping this fails the export.
    const order: string[] = []
    const { sink } = recordingSink()
    await exportTypstDocument('html', '= Hi', {
      compiler: {
        prepare: async () => { order.push('prepare') },
        compile: async () => { order.push('compile'); return { pages: [PAGE] } },
      },
      sink,
    })
    expect(order).toEqual(['prepare', 'compile'])
  })

  it('reports an empty document instead of writing a blank file', async () => {
    const { sink, saved } = recordingSink()
    const r = await exportTypstDocument('html', '   ', { compiler: compilerOf([PAGE]), sink })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
    expect(saved).toHaveLength(0)
  })

  it('reports a compile that yields no pages', async () => {
    const { sink } = recordingSink()
    const r = await exportTypstDocument('html', '= Hi', { compiler: compilerOf([]), sink })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })

  it('never throws — a compile failure comes back as a result', async () => {
    const { sink } = recordingSink()
    const r = await exportTypstDocument('html', '= Hi', {
      compiler: { compile: async () => { throw new Error('unknown variable') } },
      sink,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('unknown variable')
  })

  it('reports a sink failure', async () => {
    const r = await exportTypstDocument('html', '= Hi', {
      compiler: compilerOf([PAGE]),
      sink: { save: async () => { throw new Error('permission denied') } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('permission denied')
  })

  it('drives the progress phases in order', async () => {
    const phases: string[] = []
    const { sink } = recordingSink()
    await exportTypstDocument('html', '= Hi', {
      compiler: compilerOf([PAGE]),
      sink,
      onProgress: (p) => phases.push(p.phase),
    })
    expect(phases).toEqual(['preparing', 'rendering', 'writing', 'done'])
  })

  it('offers the same four formats as the markdown menu, minus LaTeX', () => {
    expect([...TYPST_EXPORT_FORMATS]).toEqual(['pdf', 'image', 'html', 'doc'])
  })
})
