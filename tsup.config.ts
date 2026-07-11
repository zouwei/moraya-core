import { defineConfig } from 'tsup'
import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

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
    // v0.96.0 unified i18n — engine ships as its own subpath bundle. JSON
    // payloads are copied verbatim by `publicDir` below; the per-locale
    // dynamic `import()` inside loader.ts code-splits at the consumer's
    // bundler so a user only downloads the active language.
    'src/i18n/index.ts',
    // v0.4.0 shared AI provider layer — separate subpath bundles, kept OUT of
    // src/index.ts so the 80KB main-entry budget is unaffected.
    'src/ai/index.ts',
    'src/ai/types.ts',
    'src/ai/image.ts',
    'src/ai/voice.ts',
    'src/ai/drivers/*.ts',
    // v0.4.0 chat-markdown — streaming-safe markdown→HTML for AI chat bubbles.
    // Separate bundle so chat-only consumers (e.g. an external AI app that
    // never touches the editor schema) only pay for ~7 KB + their own
    // markdown-it peer, not the full ProseMirror payload.
    'src/chat-markdown/index.ts',
    // v0.7.0 memory — shared long-term-memory data contract + Markdown
    // serialization (aligned with Picora dot-directory hosting). Tiny, zero-dep,
    // its own bundle so non-memory consumers don't pay for it.
    'src/memory/index.ts',
    // v0.8.0 sync — shared document-sync engine: three-way diff/merge (extracted
    // from desktop KB-sync) + the single-flight DocSyncEngine that fixes the
    // false-conflict autosave races. Own bundle; pulls the node-diff3/diff
    // optional peers, so non-sync consumers never load it.
    'src/sync/index.ts',
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
    // Subpath external — esbuild matches externals exactly, so 'katex' alone
    // would NOT keep this side-effect import external; bundling it would pull
    // in a SECOND katex instance and register the \ce/\pu macros on the wrong
    // one. Must stay external so it resolves to the consumer's katex.
    'katex/contrib/mhchem',
    'highlight.js',
    // v0.8.0 sync optional peers — kept out of the bundle.
    'node-diff3',
    'diff',
  ],
  publicDir: 'src/styles',
  /*
   * v0.96.0 i18n locale handling.
   *
   * The 12 locale JSONs (~150 KB each) MUST stay separate files in dist so
   * each consumer's bundler can code-split per language. With tsup's default
   * (splitting: false), `await import('./locales/en.json')` would inline ALL
   * 12 bundles into dist/i18n/index.js (~2.5 MB). Two fixes wired below:
   *
   *   1. esbuild plugin marks `./locales/<loc>.json` imports as external,
   *      so the resolved path stays in the emitted JS as a runtime import.
   *   2. onSuccess copies src/i18n/locales/ to dist/i18n/locales/ so the
   *      external paths resolve at consumer Vite build time.
   */
  esbuildPlugins: [
    {
      name: 'moraya-i18n-locales-external',
      setup(build) {
        build.onResolve({ filter: /\.\/locales\/[\w-]+\.json$/ }, (args) => ({
          path: args.path,
          external: true,
        }))
      },
    },
  ],
  onSuccess: async () => {
    const src = resolve(__dirname, 'src/i18n/locales')
    const dst = resolve(__dirname, 'dist/i18n/locales')
    mkdirSync(dst, { recursive: true })
    cpSync(src, dst, { recursive: true })
  },
})
