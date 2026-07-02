# @moraya/core

> **Markdown engine for editors and AI chat.**
> A framework-agnostic ESM library powering WYSIWYG markdown editing (ProseMirror) and AI-chat-bubble rendering (markdown-it + optional KaTeX/highlight.js, streaming-safe). Used in production by [Moraya](https://moraya.app) across desktop / web / mobile. Designed to embed into any TypeScript app — Svelte, React, Vue, vanilla, or Node SSR.

```bash
pnpm i @moraya/core
# or: npm i @moraya/core
# or: yarn add @moraya/core
```

---

## Why @moraya/core for AI apps

LLMs emit markdown. Your chat UI has to render it — safely, in real time, on every device.

- **Streaming-safe** — half-written code fences, math, and links from SSE chunks render gracefully without ever throwing. Every render is idempotent.
- **Security-first defaults** — `html: false`, JS/VBS/data: URL denylist, forced `rel="noopener noreferrer"` on every `<a>`. The same lockdown the Moraya mobile app ships.
- **Tree-shakeable math + highlighting** — KaTeX and highlight.js are wired by callback. Apps that don't need math (mobile chat, customer-support widgets) don't pay ~280 KB for it.
- **Shared editor schema** — when you eventually need a WYSIWYG editor in the same product, the rendering and the editor speak the same markdown dialect. No parser drift.
- **Pure ESM, peer-dep model** — works in Vite, esbuild, Rollup, webpack, Bun, Deno, Cloudflare Workers, Vercel Edge, Node SSR.

---

## Quick start (AI chat bubble)

Five lines plus your LLM call:

```ts
import { renderChatMarkdown } from '@moraya/core/chat-markdown'

const llmReply = await callYourLLM(prompt)              // string
const safeHtml = renderChatMarkdown(llmReply)           // safe HTML
bubbleEl.innerHTML = safeHtml                            // or React `dangerouslySetInnerHTML`, Svelte `{@html}`, Vue `v-html`
```

That's it. Code blocks, lists, headings, blockquotes, inline code, bold/italic, strikethrough, links — all rendered. Bare URLs are auto-linkified. Every `<a>` is sandboxed (`target="_blank" rel="noopener noreferrer"`).

### Adding syntax highlighting

```ts
import { renderChatMarkdown } from '@moraya/core/chat-markdown'
import hljs from 'highlight.js'

const html = renderChatMarkdown(reply, {
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    }
    return null   // fall back to default escaped <code>
  },
})
```

### Adding KaTeX math

```ts
import katex from 'katex'
import 'katex/dist/katex.min.css'

const html = renderChatMarkdown(reply, {
  math: (latex, displayMode) =>
    katex.renderToString(latex, { displayMode, throwOnError: false }),
})
```

`$inline$` and `$$display$$` are parsed; everything else (including dollar amounts like `$5`) is left alone.

---

## Use cases

| Use case | Subpath | Bundle size (gzipped) |
|---|---|---|
| **AI chat bubbles** — render LLM markdown output | `@moraya/core/chat-markdown` | ~7 KB + your `markdown-it` peer |
| **Embedded WYSIWYG editor** — Typora-style markdown editing | `@moraya/core` (+ schema/setup/commands subpaths) | ~80 KB + ProseMirror peers |
| **Server-side markdown → HTML** — Node SSR, Edge, Workers | `@moraya/core/chat-markdown` (no DOM needed) | ~7 KB |
| **Provider-agnostic LLM client** — chat completion + tool calls | `@moraya/core/ai` | ~15 KB |

You can use any of these independently. The `chat-markdown` subpath has no dependency on the editor, ProseMirror, or DOM.

---

## Framework examples

### Vanilla TypeScript (no framework)

```ts
import { renderChatMarkdown } from '@moraya/core/chat-markdown'

const el = document.querySelector('#chat')!
el.innerHTML = renderChatMarkdown(`
**Hello!** Here's some code:
\`\`\`python
def greet(name): return f"Hi, {name}!"
\`\`\`
`)
```

### React

```tsx
import { renderChatMarkdown } from '@moraya/core/chat-markdown'

export function ChatBubble({ content }: { content: string }) {
  const html = renderChatMarkdown(content)
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
```

### Svelte 5

```svelte
<script lang="ts">
  import { renderChatMarkdown } from '@moraya/core/chat-markdown'
  let { content }: { content: string } = $props()
  const html = $derived(renderChatMarkdown(content))
</script>

<div>{@html html}</div>
```

### Vue 3

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '@moraya/core/chat-markdown'
const props = defineProps<{ content: string }>()
const html = computed(() => renderChatMarkdown(props.content))
</script>

<template>
  <div v-html="html" />
</template>
```

Runnable demos live in [`examples/`](./examples/).

---

## API reference

### `chat-markdown` subpath

```ts
import { renderChatMarkdown } from '@moraya/core/chat-markdown'

renderChatMarkdown(input: string, opts?: ChatMarkdownOptions): string

interface ChatMarkdownOptions {
  /** KaTeX math callback. When omitted, $...$ syntax renders as plain text. */
  math?: (latex: string, displayMode: boolean) => string

  /** Syntax-highlighter callback. When omitted, code blocks render with
   *  HTML-escaped content inside <pre><code>. Return null to fall back. */
  highlight?: (code: string, lang: string) => string | null

  /** Override default link attributes. Defaults: target=_blank, rel=noopener noreferrer. */
  linkAttrs?: { target?: string; rel?: string }

  /** Pre-process the markdown before parsing (mentions, slash-commands, etc). */
  preprocess?: (raw: string) => string
}
```

### Editor subpaths

```ts
import {
  // schema
  createSchema, type SchemaConfig,
  // markdown
  parseMarkdown, parseMarkdownAsync, serializeMarkdown,
  // setup
  createEditor, createEditorPlugins,
  // commands
  toggleBold, toggleItalic, toggleStrikethrough, toggleCode,
  setHeading, toggleBlockquote, toggleOrderedList, toggleBulletList, toggleCodeBlock,
  insertTable, insertHorizontalRule, insertMathBlock, toggleLink, insertImage,
  // doc cache
  createDocCache, type DocCache,
  // DI types
  type MediaResolver, type LinkOpener, type RendererRegistry, type Platform,
} from '@moraya/core'

import { BrowserMediaResolver } from '@moraya/core/adapters/browser-media-resolver'
import '@moraya/core/style'
```

### AI provider layer

```ts
import { streamChat, sendChat, type AITransport } from '@moraya/core/ai'
```

See [`src/ai/index.ts`](./src/ai/index.ts) for the full surface.

---

## Comparison

|  | @moraya/core/chat-markdown | bare markdown-it | react-markdown | marked |
|---|---|---|---|---|
| Streaming-safe (LLM SSE) | ✅ never throws | ⚠️ depends on plugins | ⚠️ React reconciliation cost | ⚠️ |
| `html: false` by default | ✅ | ❌ must set explicitly | ✅ | ❌ |
| `rel="noopener"` forced | ✅ | ❌ DIY plugin | ❌ DIY | ❌ |
| `javascript:` / `data:text/html` denied | ✅ | ⚠️ default but bypassable | ⚠️ | ❌ |
| KaTeX as opt-in callback | ✅ | ⚠️ via texmath plugin | ⚠️ via remark-math | ❌ |
| Tree-shakeable highlighter | ✅ | ⚠️ wires hljs directly | ⚠️ via rehype-highlight | ❌ |
| Pure ESM | ✅ | ✅ | ⚠️ CJS+ESM | ✅ |
| Works in Edge / Workers / SSR | ✅ | ✅ | ❌ needs React | ✅ |
| Bundle size (gzipped) | ~7 KB | ~25 KB | ~30 KB + React | ~10 KB |
| Shares schema with full editor | ✅ (via `@moraya/core/markdown`) | ❌ | ❌ | ❌ |

---

## Design constraints

- **Pure ESM** — no CommonJS, no Node API, no host-specific imports
- **ES2022** target (compatible with iOS 14+ Safari, Android 8+ Chrome, Node 20+, modern Edge)
- **DOM-optional** — `chat-markdown` is pure string→string; the editor parts require DOM Level 4 + ContentEditable
- **Dependency-injected** — `MediaResolver` / `LinkOpener` / `RendererRegistry` / `Platform` for the editor; callbacks for math/highlight in chat-markdown
- **Peer-dep model** — `prosemirror-*`, `markdown-it`, `katex`, `highlight.js` are peers; the consumer's bundler decides what ships
- **Bundle budget** — main editor entry ≤ 80 KB gzipped; chat-markdown ≤ 8 KB gzipped

See [v0.40.0 iteration](https://github.com/zouwei/moraya/blob/main/docs/iterations/v0.40.0-core-shared-markdown-core.md) for the full design contract.

---

## Build & test

```bash
pnpm install
pnpm build       # tsup → dist/ ESM + .d.ts
pnpm test        # vitest (217+ tests)
pnpm typecheck   # tsc --noEmit
```

## npm publish

```bash
npm login 
npm publish --access public 
```
---

## Production users

- **[Moraya](https://moraya.app)** — minimalist WYSIWYG markdown editor; uses every subpath
  - Desktop (Tauri 2 + Svelte 5)
  - Web ([moraya.app](https://moraya.app), SvelteKit SPA)
  - Mobile (Capacitor + Svelte 5, iOS + Android)

Built something with `@moraya/core`? Open a PR to add yourself.

---

## License

`@moraya/core` is **dual-licensed**:

- **[GNU GPL v3.0](./LICENSE)** — free for use in GPL-compatible open-source projects. Any product that incorporates `@moraya/core` (npm dependency, static/dynamic linking, bundling) must also be GPL-3.0 and publish its full source code.
- **Commercial license** — required for closed-source, proprietary, non-GPL-compatible open source (MIT/Apache), or hosted SaaS use. Contact **huzougege@gmail.com**.

See [LICENSING.md](./LICENSING.md) for full terms and a decision table.

Copyright © 2026 zouwei.
