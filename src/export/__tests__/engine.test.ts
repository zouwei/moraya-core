// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { exportDocument } from '../engine'
import type { FileSink, Html2CanvasFn, JsPdfCtor, ExportProgress } from '../types'

// happy-dom does no layout, so every element reports offsetHeight 0 → the
// capture pipeline would bail with "zero height". Stub a positive height.
beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 1000
    },
  })
})

function recordingSink() {
  const saves: Array<{ name: string; bytes: Uint8Array; mime: string }> = []
  const sink: FileSink = {
    async save(name, bytes, mime) {
      saves.push({ name, bytes, mime })
    },
  }
  return { sink, saves }
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    width: 800,
    height: 1000,
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1, 2, 3])])),
    toDataURL: () => 'data:image/png;base64,AAAA',
  } as unknown as HTMLCanvasElement
}

const fakeHtml2Canvas: Html2CanvasFn = async () => fakeCanvas()

const fakeJsPdf = vi.fn().mockImplementation(() => ({
  addPage: vi.fn(),
  addImage: vi.fn(),
  output: () => new Uint8Array([37, 80, 68, 70]).buffer, // "%PDF"
})) as unknown as JsPdfCtor

function editorEl(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'moraya-editor'
  el.innerHTML = '<h1>Title</h1><p>body</p>'
  document.body.appendChild(el)
  return el
}

describe('exportDocument — dispatch', () => {
  it('latex → application/x-latex, bytes decode to LaTeX', async () => {
    const { sink, saves } = recordingSink()
    const r = await exportDocument('latex', { sink, getMarkdown: () => '# Hi' })
    expect(r).toEqual({ ok: true })
    expect(saves).toHaveLength(1)
    expect(saves[0]!.mime).toBe('application/x-latex')
    expect(saves[0]!.name).toBe('Hi.tex')
    expect(new TextDecoder().decode(saves[0]!.bytes)).toContain('\\section{Hi}')
  })

  it('html → text/html with rendered content', async () => {
    const { sink, saves } = recordingSink()
    const r = await exportDocument('html', { sink, getMarkdown: () => '# Title\n\n| A |\n|---|\n| 1 |' })
    expect(r.ok).toBe(true)
    expect(saves[0]!.mime).toBe('text/html')
    const html = new TextDecoder().decode(saves[0]!.bytes)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<table>') // markdown-it table fidelity
  })

  it('image → image/png via injected html2canvas + container', async () => {
    const el = editorEl()
    const { sink, saves } = recordingSink()
    const r = await exportDocument('image', {
      sink,
      getContainer: () => el,
      getMarkdown: () => '# x',
      html2canvas: fakeHtml2Canvas,
    })
    expect(r.ok).toBe(true)
    expect(saves[0]!.mime).toBe('image/png')
    expect(saves[0]!.name).toBe('x.png')
    expect(saves[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]))
    el.remove()
  })

  it('pdf → application/pdf via injected html2canvas + jsPDF, emits progress', async () => {
    const el = editorEl()
    const { sink, saves } = recordingSink()
    const phases: ExportProgress[] = []
    const r = await exportDocument('pdf', {
      sink,
      getContainer: () => el,
      getMarkdown: () => '# x',
      html2canvas: fakeHtml2Canvas,
      jsPDF: fakeJsPdf,
      onProgress: (p) => phases.push(p),
    })
    expect(r.ok).toBe(true)
    expect(saves[0]!.mime).toBe('application/pdf')
    expect(phases.map((p) => p.phase)).toContain('paginating')
    expect(phases.map((p) => p.phase)).toContain('done')
    el.remove()
  })

  it('non-throwing: a failing html2canvas returns {ok:false}', async () => {
    const el = editorEl()
    const { sink } = recordingSink()
    const r = await exportDocument('image', {
      sink,
      getContainer: () => el,
      getMarkdown: () => '# x',
      html2canvas: async () => {
        throw new Error('boom')
      },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('boom')
    el.remove()
  })
})
