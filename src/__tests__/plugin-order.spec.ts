// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Plugin order fingerprint snapshot (v0.60.0-pre §1.2.2).
 *
 * Captures the ProseMirror plugin array structure produced by
 * `createEditorPlugins(opts)`. Any reordering / addition / removal of plugins
 * produces a snapshot diff that requires explicit reviewer approval and a
 * dual-run against Moraya desktop's same-fixture suite.
 *
 * The snapshot intentionally captures only **shape** (PluginKey + spec slot
 * presence), NOT runtime state values, to avoid spurious diffs from user input
 * variation.
 */
import { describe, test, expect } from 'vitest'
import { createEditorPlugins } from '../setup'
import { BrowserMediaResolver } from '../adapters/browser-media-resolver'

interface PluginFingerprint {
  index: number
  key: string
  slots: { state: boolean; props: boolean; view: boolean }
}

function fingerprintPlugins(plugins: import('prosemirror-state').Plugin[]): PluginFingerprint[] {
  return plugins.map((p, idx) => {
    const spec = p.spec as Record<string, unknown>
    const key = (spec.key as { key?: string } | undefined)?.key ?? `<no-key:${idx}>`
    return {
      index: idx,
      key,
      slots: {
        state: typeof spec.state !== 'undefined',
        props: typeof spec.props !== 'undefined',
        view: typeof spec.view !== 'undefined',
      },
    }
  })
}

describe('plugin order fingerprint (§1.2.2)', () => {
  test('default consumer config (Web-style: no enableMermaid)', async () => {
    const plugins = await createEditorPlugins({
      mediaResolver: new BrowserMediaResolver(),
    })
    expect(fingerprintPlugins(plugins)).toMatchSnapshot()
  })

  test('desktop-style consumer config (enableMermaid + enableHistory + enableImageSelection + enableTableResize)', async () => {
    const plugins = await createEditorPlugins({
      mediaResolver: new BrowserMediaResolver(),
      enableMermaid: true,
      enableHistory: true,
      enableImageSelection: true,
      enableTableResize: true,
    })
    expect(fingerprintPlugins(plugins).map(fp => fp.key)).toMatchSnapshot()
  })

  test('history disabled (Yjs-style consumer per §10.3)', async () => {
    const plugins = await createEditorPlugins({
      mediaResolver: new BrowserMediaResolver(),
      enableHistory: false,
    })
    const keys = fingerprintPlugins(plugins).map(fp => fp.key)
    expect(keys).toMatchSnapshot()
    // Sanity: history plugin's signature key should NOT be present
    expect(keys.some(k => k.includes('history'))).toBe(false)
  })

  test('table resize disabled', async () => {
    const plugins = await createEditorPlugins({
      mediaResolver: new BrowserMediaResolver(),
      enableTableResize: false,
    })
    const keys = fingerprintPlugins(plugins).map(fp => fp.key)
    // columnResizing plugin is from prosemirror-tables; its key starts with 'tableColumnResizing$'
    expect(keys.some(k => k.startsWith('tableColumnResizing'))).toBe(false)
  })

  test('with onChange callback adds lazy-change plugin', async () => {
    const plugins = await createEditorPlugins({
      mediaResolver: new BrowserMediaResolver(),
      onChange: () => undefined,
    })
    const keys = fingerprintPlugins(plugins).map(fp => fp.key)
    expect(keys.some(k => k.includes('moraya-lazy-change'))).toBe(true)
  })

  test('with onDocChanged callback adds dirty-track plugin', async () => {
    const plugins = await createEditorPlugins({
      mediaResolver: new BrowserMediaResolver(),
      onDocChanged: () => undefined,
    })
    const keys = fingerprintPlugins(plugins).map(fp => fp.key)
    expect(keys.some(k => k.includes('moraya-dirty-track'))).toBe(true)
  })
})
