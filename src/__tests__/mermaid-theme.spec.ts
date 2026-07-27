// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  resolvePalette,
  buildMermaidConfig,
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
    expect(v.primaryColor).toBe(PALETTE.surface)
    expect(v.primaryBorderColor).toBe(PALETTE.accent)
    expect(v.nodeBorder).toBe(PALETTE.accent)
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
