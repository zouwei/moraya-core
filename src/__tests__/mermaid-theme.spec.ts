// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  resolvePalette,
  buildMermaidConfig,
  relativeLuminance,
  mixColors,
  scaleSeed,
  type MermaidPalette,
} from '../plugins/mermaid-renderer'

/** Reader over a fixed map, standing in for getComputedStyle on :root. */
const readerFor = (vars: Record<string, string>) => (name: string) => vars[name] ?? ''

const PALETTE: MermaidPalette = {
  background: '#ffffff',
  surface: '#f5f5f5',
  hover: '#efefef',
  border: '#e0e0e0',
  text: '#1a1a1a',
  textMuted: '#666666',
  accent: '#4a90d9',
}

describe('buildMermaidConfig', () => {
  it('uses the base theme', () => {
    // The regression this guards: 'default'/'dark' recompute node colours from
    // their own constants in updateColors(), discarding themeVariables — which
    // made diagrams ignore the app theme entirely.
    expect(buildMermaidConfig(PALETTE, false).theme).toBe('base')
    expect(buildMermaidConfig(PALETTE, true).theme).toBe('base')
  })

  it('passes darkMode through so base derives colours in the right direction', () => {
    expect(buildMermaidConfig(PALETTE, true).themeVariables.darkMode).toBe(true)
    expect(buildMermaidConfig(PALETTE, false).themeVariables.darkMode).toBe(false)
  })

  it('fills nodes with the surface colour and outlines them in the accent', () => {
    const { themeVariables: v } = buildMermaidConfig(PALETTE, false)
    expect(v.nodeBkg).toBe(PALETTE.surface)
    expect(v.mainBkg).toBe(PALETTE.surface)
    expect(v.primaryBorderColor).toBe(PALETTE.accent)
    expect(v.nodeBorder).toBe(PALETTE.accent)
  })

  it('leaves secondary/tertiary unset so base can rotate them off primary', () => {
    // Pinning these to neutral surfaces is what flattened pie2 and pie3.
    const v = buildMermaidConfig(PALETTE, false).themeVariables as Record<string, unknown>
    expect('secondaryColor' in v).toBe(false)
    expect('tertiaryColor' in v).toBe(false)
  })

  it('backs edge labels with the page background', () => {
    // Mermaid otherwise plates them in hardcoded white, unreadable when dark.
    expect(buildMermaidConfig(PALETTE, true).themeVariables.edgeLabelBackground).toBe(
      PALETTE.background,
    )
  })

  it('draws text and edges from the theme, not mermaid constants', () => {
    const { themeVariables: v } = buildMermaidConfig(PALETTE, false)
    expect(v.textColor).toBe(PALETTE.text)
    expect(v.primaryTextColor).toBe(PALETTE.text)
    expect(v.lineColor).toBe(PALETTE.textMuted)
  })
})

describe('scaleSeed', () => {
  it('lifts the seed well above the accent in BOTH appearances', () => {
    // base darkens every scale afterwards — by 75 points in a dark appearance.
    // A seed at accent lightness lands on pure black, turning every mindmap
    // section into the same black slab.
    for (const dark of [false, true]) {
      const seed = scaleSeed({ ...PALETTE, background: dark ? '#1e1e1e' : '#ffffff' }, dark)
      expect(relativeLuminance(seed)!).toBeGreaterThan(relativeLuminance(PALETTE.accent)! + 0.3)
    }
  })

  it('does not follow the page background down in a dark appearance', () => {
    const onLight = scaleSeed(PALETTE, false)
    const onDark = scaleSeed({ ...PALETTE, background: '#1e1e1e' }, true)
    expect(onDark).toBe(onLight)
  })

  it('keeps chroma so hue rotations stay distinguishable', () => {
    // Regression: a fully neutral seed collapsed every pie slice to one tint.
    const seed = scaleSeed(PALETTE, false)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(seed.slice(i, i + 2), 16))
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(24)
  })

  it('seeds primaryColor, and is not the raw accent', () => {
    const v = buildMermaidConfig(PALETTE, false).themeVariables
    expect(v.primaryColor).toBe(scaleSeed(PALETTE, false))
    expect(v.primaryColor).not.toBe(PALETTE.accent)
    // Borders stay vivid even though the fills are tinted.
    expect(v.nodeBorder).toBe(PALETTE.accent)
  })

  it('labels scales with the body text colour', () => {
    const v = buildMermaidConfig(PALETTE, false).themeVariables
    expect(v.scaleLabelColor).toBe(PALETTE.text)
  })
})

describe('mixColors', () => {
  it('returns the endpoints at 0 and 1', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('blends halfway', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('passes the colour through when it cannot parse', () => {
    expect(mixColors('var(--x)', '#ffffff', 0.5)).toBe('var(--x)')
  })
})

describe('relativeLuminance', () => {
  it('anchors on black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('returns null for non-hex input', () => {
    expect(relativeLuminance('rgb(0,0,0)')).toBeNull()
  })
})

describe('resolvePalette', () => {
  it('reads the desktop variable names', () => {
    const p = resolvePalette(
      readerFor({
        '--accent-color': '#4a90d9',
        '--text-primary': '#1a1a1a',
        '--text-secondary': '#666666',
        '--border-color': '#e0e0e0',
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f5f5f5',
        '--bg-hover': '#efefef',
      }),
      false,
    )
    expect(p).toEqual(PALETTE)
  })

  it('reads the web variable names', () => {
    // Web names its theme `--color-*`; reading only the desktop names is how
    // these values used to collapse to hardcoded defaults on web.
    const p = resolvePalette(
      readerFor({
        '--color-accent': '#4a9eff',
        '--color-text': '#111111',
        '--color-text-secondary': '#777777',
        '--color-border': '#dddddd',
        '--color-bg': '#fefefe',
        '--color-bg-secondary': '#f0f0f0',
        '--color-bg-hover': '#e8e8e8',
      }),
      false,
    )
    expect(p.accent).toBe('#4a9eff')
    expect(p.text).toBe('#111111')
    expect(p.background).toBe('#fefefe')
    expect(p.surface).toBe('#f0f0f0')
  })

  it('lets a --mermaid-* name win over the host theme', () => {
    const p = resolvePalette(
      readerFor({ '--mermaid-accent': '#ff0000', '--accent-color': '#4a90d9' }),
      false,
    )
    expect(p.accent).toBe('#ff0000')
  })

  it('falls back per role, not all-or-nothing', () => {
    const p = resolvePalette(readerFor({ '--accent-color': '#123456' }), false)
    expect(p.accent).toBe('#123456')
    expect(p.text).toBe(LIGHT_TEXT)
  })

  it('picks dark fallbacks when the host defines nothing', () => {
    const light = resolvePalette(readerFor({}), false)
    const dark = resolvePalette(readerFor({}), true)
    expect(light.background).toBe('#ffffff')
    expect(dark.background).toBe('#1e1e1e')
    expect(dark.text).not.toBe(light.text)
  })

  it('ignores whitespace-only values', () => {
    // getComputedStyle returns ' ' for some undefined custom properties.
    const p = resolvePalette(readerFor({ '--accent-color': '   ' }), false)
    expect(p.accent).toBe('#4a90d9')
  })
})

const LIGHT_TEXT = '#1a1a1a'
