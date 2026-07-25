// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect } from 'vitest'
import {
  documentExtension,
  extensionForFlavor,
  flavorForFile,
  isDocumentFile,
  isMarkdownFile,
  isTypstFile,
  withFlavorExtension,
} from '../flavor'

describe('flavor detection', () => {
  it('recognizes Typst documents', () => {
    expect(isTypstFile('paper.typ')).toBe(true)
    expect(isTypstFile('/kb/notes/paper.typ')).toBe(true)
  })

  it('matches extensions case-insensitively', () => {
    // File names arrive raw from the OS / file tree.
    expect(isTypstFile('PAPER.TYP')).toBe(true)
    expect(isMarkdownFile('README.MD')).toBe(true)
  })

  it('does not treat markdown as Typst', () => {
    expect(isTypstFile('notes.md')).toBe(false)
    expect(isMarkdownFile('notes.md')).toBe(true)
  })

  it('rejects non-documents', () => {
    expect(isDocumentFile('photo.png')).toBe(false)
    expect(isDocumentFile('archive.zip')).toBe(false)
    // A bare extension-like name is not a document.
    expect(isDocumentFile('typ')).toBe(false)
    // Only a trailing extension counts.
    expect(isDocumentFile('notes.md.bak')).toBe(false)
  })

  it('accepts both flavors as documents', () => {
    expect(isDocumentFile('a.md')).toBe(true)
    expect(isDocumentFile('a.markdown')).toBe(true)
    expect(isDocumentFile('a.typ')).toBe(true)
  })
})

describe('flavorForFile', () => {
  it('maps extensions to flavors', () => {
    expect(flavorForFile('a.typ')).toBe('typst')
    expect(flavorForFile('a.md')).toBe('markdown')
  })

  it('falls back to markdown for unknown extensions', () => {
    expect(flavorForFile('untitled')).toBe('markdown')
    expect(flavorForFile('data.json')).toBe('markdown')
  })
})

describe('documentExtension', () => {
  it('returns the extension preserving original case', () => {
    expect(documentExtension('Paper.TYP')).toBe('.TYP')
    expect(documentExtension('notes.md')).toBe('.md')
  })

  it('returns empty string for directories / non-documents', () => {
    expect(documentExtension('/kb/notes')).toBe('')
    expect(documentExtension('photo.png')).toBe('')
  })
})

describe('withFlavorExtension', () => {
  it('is a no-op when the extension already matches', () => {
    expect(withFlavorExtension('paper.typ', 'typst')).toBe('paper.typ')
  })

  it('appends the extension when there is none', () => {
    expect(withFlavorExtension('paper', 'typst')).toBe('paper.typ')
    expect(withFlavorExtension('notes', 'markdown')).toBe('notes.md')
  })

  it('replaces the other flavor extension', () => {
    // A content-derived suggested name arrives as .md; saving a Typst document
    // under it would make the file reopen as markdown.
    expect(withFlavorExtension('paper.md', 'typst')).toBe('paper.typ')
    expect(withFlavorExtension('paper.typ', 'markdown')).toBe('paper.md')
  })

  it('does not mistake a dotted name for an extension', () => {
    expect(withFlavorExtension('v1.2.report', 'typst')).toBe('v1.2.report.typ')
  })

  it('maps flavors to canonical extensions', () => {
    expect(extensionForFlavor('typst')).toBe('.typ')
    expect(extensionForFlavor('markdown')).toBe('.md')
  })
})
