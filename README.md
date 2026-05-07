# @moraya/core

Shared markdown editor core for **Moraya desktop** (Tauri + Svelte 5) and **Moraya Web** (SvelteKit SPA). Pure ESM, host-agnostic, dependency-injected.

## Status

- v0.1.0 (initial extraction from Moraya desktop `src/lib/editor/`)
- See `CHANGELOG.md`

## Design

Per [v0.60.0-pre-shared-markdown-core](https://github.com/zouwei/moraya/blob/main/docs/iterations/v0.60.0-pre-shared-markdown-core.md):

- **Pure ESM** — no CommonJS, no Node API, no host-specific imports
- **DOM Level 4** required (ContentEditable + ResizeObserver + IntersectionObserver)
- **Dependency-injected** — `MediaResolver` / `LinkOpener` / `RendererRegistry` / `Platform`
- **5 peer deps** — `prosemirror-*`, `markdown-it`, `katex`, `highlight.js`
- **Bundle budget** — main entry ≤ 80KB gzipped

## Public API

```ts
import {
  // schema
  createSchema, type SchemaConfig,
  // markdown
  parseMarkdown, parseMarkdownAsync, serializeMarkdown,
  // setup
  createEditor, createEditorPlugins,
  type EditorPluginOptions, type CreateEditorOptions, type MorayaEditorInstance,
  // doc cache
  createDocCache, type DocCache,
  // commands
  toggleBold, toggleItalic, toggleStrikethrough, toggleCode,
  setHeading, toggleBlockquote, toggleOrderedList, toggleBulletList, toggleCodeBlock,
  insertTable, insertHorizontalRule, insertMathBlock,
  toggleLink, insertImage,
  // types
  type MediaResolver, type LinkOpener, type RendererRegistry, type RendererPluginModule, type Platform,
} from '@moraya/core'

import { BrowserMediaResolver } from '@moraya/core/adapters/browser-media-resolver'
import '@moraya/core/style'
```

## Consumer examples

### Moraya desktop bridge (Svelte 5 + Tauri)

```ts
import { createSchema } from '@moraya/core'
import { tauriMediaResolver } from './tauri-media-resolver'
import { morayaRendererRegistry } from './moraya-renderer-registry'

export const schema = createSchema({
  mediaResolver: tauriMediaResolver,
  rendererRegistry: morayaRendererRegistry,
})
```

### Moraya Web (SvelteKit SPA)

```ts
import { createSchema } from '@moraya/core'
import { BrowserMediaResolver } from '@moraya/core/adapters/browser-media-resolver'

export const schema = createSchema({
  mediaResolver: new BrowserMediaResolver(),
})
```

## Build & test

```bash
pnpm install
pnpm build
pnpm test
```

## License

PolyForm Internal Use 1.0.0 (private; not for redistribution).
