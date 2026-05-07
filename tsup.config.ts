import { defineConfig } from 'tsup'

/**
 * Pure ESM build for @moraya/core.
 * Per v0.60.0-pre §1.1.1:
 * - module = ESM only (no CommonJS)
 * - target = ES2022 (compatible with iOS 14+ Safari, Android 8+ Chrome)
 * - DOM Level 4 + ContentEditable + ResizeObserver + IntersectionObserver
 * - Pure: no Node API, no host-specific imports
 */
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/schema.ts',
    'src/markdown.ts',
    'src/setup.ts',
    'src/commands.ts',
    'src/doc-cache.ts',
    'src/types.ts',
    'src/plugins/*.ts',
    'src/adapters/*.ts',
  ],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: [
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-model',
    'prosemirror-markdown',
    'prosemirror-commands',
    'prosemirror-history',
    'prosemirror-inputrules',
    'prosemirror-keymap',
    'prosemirror-schema-list',
    'prosemirror-tables',
    'markdown-it',
    'katex',
    'highlight.js',
  ],
  publicDir: 'src/styles',
})
