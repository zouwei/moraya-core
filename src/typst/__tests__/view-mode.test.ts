// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW_MODES,
  viewModeForFlavor,
  rememberViewMode,
  type ViewModeMemory,
} from '../view-mode'

describe('viewModeForFlavor', () => {
  it('opens markdown as WYSIWYG and Typst side-by-side', () => {
    // A Typst document only exists as pages after a compile, so source-only
    // hides the result and preview-only hides what you are editing.
    expect(viewModeForFlavor(undefined, 'markdown')).toBe('visual')
    expect(viewModeForFlavor(undefined, 'typst')).toBe('split')
    expect(viewModeForFlavor({}, 'typst')).toBe('split')
  })

  it('prefers a remembered mode over the default', () => {
    expect(viewModeForFlavor({ typst: 'source' }, 'typst')).toBe('source')
  })

  it('keeps the flavors independent', () => {
    // Reading a .typ in source mode must not put every markdown note into
    // source mode as well.
    const memory: ViewModeMemory = { typst: 'source' }
    expect(viewModeForFlavor(memory, 'markdown')).toBe('visual')
  })
})

describe('rememberViewMode', () => {
  it('records the choice for that flavor only', () => {
    const next = rememberViewMode({ markdown: 'source' }, 'typst', 'visual')
    expect(next).toEqual({ markdown: 'source', typst: 'visual' })
  })

  it('overwrites a previous choice', () => {
    expect(rememberViewMode({ typst: 'source' }, 'typst', 'split')).toEqual({ typst: 'split' })
  })

  it('does not mutate the memory it was given', () => {
    // Callers hold this in reactive state; mutating in place would not notify.
    const memory: ViewModeMemory = { typst: 'source' }
    rememberViewMode(memory, 'typst', 'visual')
    expect(memory).toEqual({ typst: 'source' })
  })

  it('round-trips through viewModeForFlavor', () => {
    const memory = rememberViewMode(undefined, 'typst', 'source')
    expect(viewModeForFlavor(memory, 'typst')).toBe('source')
  })
})

describe('DEFAULT_VIEW_MODES', () => {
  it('covers every flavor', () => {
    // A missing entry would resolve to undefined and blank the editor.
    expect(Object.keys(DEFAULT_VIEW_MODES).sort()).toEqual(['markdown', 'typst'])
  })
})
