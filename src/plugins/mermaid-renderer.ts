// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Mermaid renderer — lazy-loads the mermaid library and provides a render API.
 *
 * This is a utility module imported on-demand by `code-block-view.ts`,
 * NOT itself a ProseMirror plugin. The mermaid library (~2.4 MB) is loaded
 * only when the first mermaid code block is encountered, via dynamic
 * `import('mermaid')`. Consumers that want mermaid support must install
 * `mermaid` as a peer dependency.
 *
 * IMPORTANT: `mermaid.render()` manipulates global DOM state and is NOT safe
 * to call concurrently. All renders go through a serial queue. That invariant
 * only holds while every caller in a window shares THIS module instance — a
 * second copy would bring its own queue and let two renders overlap.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mermaidModule: any = null
let loadingPromise: Promise<void> | null = null
let renderCounter = 0

// ── Serial render queue ──────────────────────────
// Mermaid.render() creates a temp SVG in the DOM, measures text, then removes
// it. If two renders overlap, the second corrupts the first's temp element,
// causing "Render failed". This queue ensures only one render runs at a time.
let renderQueue: Promise<void> = Promise.resolve()

export function isDark(): boolean {
  if (typeof document === 'undefined') return false
  const dt = document.documentElement.getAttribute('data-theme')
  if (dt === 'dark') return true
  if (dt === 'light') return false
  // No explicit attribute means the host follows the OS ("system" appearance).
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * The colours a diagram is built from, named by role rather than by any one
 * consumer's CSS convention.
 */
export interface MermaidPalette {
  background: string
  surface: string
  hover: string
  border: string
  text: string
  textMuted: string
  accent: string
}

/**
 * CSS custom properties to try, per role, in priority order.
 *
 * The consumers do not share a naming convention: desktop uses `--accent-color`
 * / `--text-primary`, web uses `--color-accent` / `--color-text`. Reading only
 * one set silently yields empty strings on the other host, which is how these
 * values used to degrade to hardcoded defaults on web. A `--mermaid-*` name is
 * checked first so a host can override a single role without renaming its theme.
 */
const VAR_CANDIDATES: Record<keyof MermaidPalette, readonly string[]> = {
  background: ['--mermaid-background', '--bg-primary', '--color-bg'],
  surface: ['--mermaid-node-bg', '--bg-secondary', '--color-bg-secondary'],
  hover: ['--bg-hover', '--color-bg-hover'],
  border: ['--border-color', '--color-border'],
  text: ['--mermaid-text', '--text-primary', '--color-text'],
  textMuted: ['--text-secondary', '--color-text-secondary'],
  accent: ['--mermaid-accent', '--accent-color', '--color-accent'],
}

const LIGHT_FALLBACK: MermaidPalette = {
  background: '#ffffff',
  surface: '#f5f5f5',
  hover: '#efefef',
  border: '#e0e0e0',
  text: '#1a1a1a',
  textMuted: '#666666',
  accent: '#4a90d9',
}

const DARK_FALLBACK: MermaidPalette = {
  background: '#1e1e1e',
  surface: '#242424',
  hover: '#2e2e2e',
  border: '#3a3a3a',
  text: '#e6e6e6',
  textMuted: '#aaaaaa',
  accent: '#569cd6',
}

/**
 * Resolve the palette from a CSS-variable reader.
 *
 * Split from the DOM so the naming-fallback order is unit-testable; `readVar`
 * returns '' for a variable the host does not define.
 */
export function resolvePalette(
  readVar: (name: string) => string,
  dark: boolean,
): MermaidPalette {
  const fallback = dark ? DARK_FALLBACK : LIGHT_FALLBACK
  const out = {} as MermaidPalette
  for (const role of Object.keys(VAR_CANDIDATES) as (keyof MermaidPalette)[]) {
    let value = ''
    for (const name of VAR_CANDIDATES[role]) {
      value = (readVar(name) || '').trim()
      if (value) break
    }
    out[role] = value || fallback[role]
  }
  return out
}

function readPalette(dark: boolean): MermaidPalette {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return dark ? DARK_FALLBACK : LIGHT_FALLBACK
  }
  const s = getComputedStyle(document.documentElement)
  return resolvePalette((name) => s.getPropertyValue(name), dark)
}

/** WCAG relative luminance of a `#rgb` / `#rrggbb` colour, or null if unparseable. */
export function relativeLuminance(hex: string): number | null {
  const digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!digits) return null
  const h = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits
  const channel = (i: number) => {
    const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** Parse `#rgb` / `#rrggbb` into channel bytes, or null. */
function parseHex(hex: string): [number, number, number] | null {
  const digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1]
  if (!digits) return null
  const h = digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

/**
 * Blend `color` `ratio` of the way towards `towards`. Returns `color` unchanged
 * if either side is not a hex colour we can read.
 */
export function mixColors(color: string, towards: string, ratio: number): string {
  const a = parseHex(color)
  const b = parseHex(towards)
  if (!a || !b) return color
  const t = Math.min(1, Math.max(0, ratio))
  const ch = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t)
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The seed for mermaid's categorical scales.
 *
 * Two constraints meet here.
 *
 * First, mindmap section labels are HTML inside a foreignObject and mermaid
 * emits NO rule for them — `.section-N text { fill: cScaleLabelN }` only applies
 * when htmlLabels is off. Those labels just inherit the page's text colour, so
 * no theme variable can fix their contrast; the fills have to be the side that
 * adapts.
 *
 * Second, base darkens every scale after deriving it: `darken(cScale, 25)` in a
 * light appearance and `darken(cScale, 75)` in a dark one. 75 points of
 * lightness is most of the range, so a seed at ordinary accent lightness lands
 * on pure black and every section becomes an identical black slab.
 *
 * Mixing towards WHITE — in both appearances, not towards the page background —
 * satisfies both: it lifts the seed high enough to survive that darkening with
 * its hue intact, and it keeps chroma, which is what lets the hue rotations stay
 * tellable apart as pie slices and git branches.
 */
export function scaleSeed(palette: MermaidPalette, _dark: boolean): string {
  return mixColors(palette.accent, '#ffffff', 0.62)
}

/**
 * Build the mermaid config for a palette.
 *
 * `theme` MUST stay 'base'. It is the only built-in theme that derives node
 * colours from the supplied `themeVariables` (`nodeBkg = nodeBkg || primaryColor`);
 * 'default', 'dark', 'forest' and 'neutral' all overwrite them from their own
 * constants inside `updateColors()` (`nodeBkg = mainBkg`), so everything below
 * would be computed and then silently discarded. That is exactly what used to
 * happen: diagrams ignored the app theme and rendered in mermaid's stock
 * palette — including a near-black stock dark palette that showed up as black
 * blocks in an otherwise light editor.
 */
export function buildMermaidConfig(palette: MermaidPalette, dark: boolean) {
  return {
    startOnLoad: false,
    theme: 'base' as const,
    themeVariables: {
      // Tells base which direction to lighten/darken its derived colours.
      darkMode: dark,
      background: palette.background,

      // primaryColor seeds EVERY categorical scale: pie1..pie12, cScale0..11
      // (journey, C4, timeline) and the git branch colours are all hue
      // rotations of it. It needs chroma to rotate — a neutral surface would
      // collapse every slice and branch to one tint — but it also has to stay
      // light enough (dark enough, in a dark appearance) for the inherited
      // label text. See scaleSeed.
      primaryColor: scaleSeed(palette, dark),
      // secondaryColor / tertiaryColor are deliberately left unset: base
      // derives them as hue rotations of primaryColor, which is what keeps
      // pie2 / pie3 distinct from pie1.

      // The shapes that should read as editor surfaces are pinned explicitly,
      // because base would otherwise fill them with primaryColor too.
      mainBkg: palette.surface,
      nodeBkg: palette.surface,
      nodeTextColor: palette.text,

      primaryTextColor: palette.text,
      primaryBorderColor: palette.accent,
      nodeBorder: palette.accent,
      lineColor: palette.textMuted,
      textColor: palette.text,
      titleColor: palette.text,
      // Without this, edge labels keep a hardcoded white plate that is
      // unreadable on a dark canvas.
      edgeLabelBackground: palette.background,
      clusterBkg: palette.background,
      clusterBorder: palette.border,
      pieTitleTextColor: palette.text,
      // With the scales tinted towards the page, body text reads on them — and
      // it matches what the mindmap's inherited HTML labels use regardless.
      scaleLabelColor: palette.text,
      pieSectionTextColor: palette.text,
    },
  }
}

function currentConfig() {
  const dark = isDark()
  return buildMermaidConfig(readPalette(dark), dark)
}

export async function ensureMermaidLoaded(): Promise<void> {
  if (mermaidModule) return
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ 'mermaid')
    mermaidModule = mod.default
    mermaidModule.initialize(currentConfig())
  })()

  return loadingPromise
}

export async function renderMermaid(
  code: string,
): Promise<{ svg: string } | { error: string }> {
  await ensureMermaidLoaded()

  // Enqueue: wait for previous render to finish before starting this one
  const result = new Promise<{ svg: string } | { error: string }>((resolve) => {
    renderQueue = renderQueue.then(async () => {
      const id = `mermaid-${++renderCounter}`
      try {
        const { svg } = await mermaidModule.render(id, code)
        resolve({ svg })
      } catch (e) {
        resolve({ error: e instanceof Error ? e.message : 'Render failed' })
      }
    })
  })

  return result
}

/**
 * Re-initialize mermaid with updated theme. Called when the host theme changes.
 */
export function updateMermaidTheme(): void {
  if (!mermaidModule) return
  mermaidModule.initialize(currentConfig())
}
