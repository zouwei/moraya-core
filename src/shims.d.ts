// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Module shims for markdown-it plugins lacking TypeScript declarations.
 * Both ship as plain JS without bundled .d.ts; we treat them as
 * `MarkdownIt.PluginSimple` (the standard plugin signature).
 */

declare module 'markdown-it-deflist' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt) => void
  export default plugin
}

declare module 'markdown-it-texmath' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt, opts?: Record<string, unknown>) => void
  export default plugin
}
