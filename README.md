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

## 版本发布

### 一键发布（推荐）

一条命令完成「升版 → 发布 npm → 等待 registry → 升级所有下游 consumer → 校验 → commit+push」，杜绝「忘发 core」「漏升某个平台」：

```bash
pnpm release patch              # 0.5.1 → 0.5.2，发布并联动升级 moraya + moraya-web
pnpm release minor              # 0.5.1 → 0.6.0
pnpm release 0.7.0              # 指定版本
pnpm release patch --dry-run    # 打印完整计划，什么都不改（首次强烈建议先跑）
pnpm release --skip-publish     # core 已在 npm，只联动升级 consumer（或补做失败的 consumer）
pnpm release patch --yes        # 跳过确认提示
```

流程与安全性：

- **前置检查**：core 必须在 `main` 且工作树干净（发布模式）；任何 consumer 若已有未提交的 `package.json`/`pnpm-lock.yaml` 改动则中止，避免误覆盖你正在改的依赖。（`--dry-run` 下这些检查降级为警告，方便预览完整计划。）
- **消费者自动识别**：扫描 `../moraya`、`../moraya-web`、`../moraya-mobile`，只升级真正依赖 `@moraya/core` 的仓库（mobile 无直接依赖，自动跳过）。
- **发布走 CI（免 OTP）**：脚本只做 bump + commit + tag + `git push --tags`；推 tag 触发 `.github/workflows/publish.yml`，由 **GitHub OIDC Trusted Publishing** 发到 npm。**没有本地 `npm publish`，不需要 OTP，不需要 NPM_TOKEN**。
- **等待 CI 发布**：轮询 `npm view` 直到新版本可解析（CI 要跑 install+test+build+publish，预算 12 分钟），再动 consumer。
- **每个 consumer**：改依赖 → `pnpm install` → `pnpm check` → `check-core-dep release` 自校验 → commit + push。任一步失败即停，已发布的 core 不受影响，可 `--skip-publish` 重跑补齐剩余 consumer。

### 首次配置：npm Trusted Publishing（OIDC）

CI 发布依赖一次性的 npmjs.com 配置（只有 `@moraya` scope 所有者能做）：

1. 登录 npmjs.com → `@moraya/core` 包 → **Settings → Trusted Publishing → Add publisher**
2. 选 **GitHub Actions**，填：Organization/user `zouwei`、Repository `moraya-core`、Workflow `publish.yml`、Environment 留空

配好后，任何 `v*` tag 推送都会自动发布（2FA 免疫、无 token）。配置前 CI 会因鉴权失败——此时可临时用底层命令里的本地 `npm publish` 兜底。

### 底层命令（手动分步，一般用不到）

`pnpm release` 内部复用下面这些；只在需要手动控制某一步、或 OIDC 尚未配好需本地兜底时才单独调用：

```bash
pnpm version:bump patch         # 仅改 core package.json 版本号
git add package.json && git commit -m "chore: release v0.5.2" && git tag v0.5.2
git push origin main --tags     # 推 tag → 触发 CI OIDC 发布（正常路径）
# —— 若 OIDC 未配好，本地兜底（会提示输 OTP）：
#   npm publish --access public
# 然后到每个下游仓库把 "@moraya/core" 改成 "^0.5.2" 并 pnpm install + commit
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
