# @moraya/core examples

Three minimal demos showing `@moraya/core/chat-markdown` driving an AI-style
chat-bubble UI. Each folder is self-contained — read its own `README.md` to
run it.

| Folder | Stack | Setup |
|---|---|---|
| [chat-vanilla](./chat-vanilla/) | Plain HTML + ESM via CDN | Open `index.html` in any browser, zero install |
| [chat-react](./chat-react/) | Vite + React 18 | `pnpm i && pnpm dev` |
| [chat-svelte](./chat-svelte/) | Vite + Svelte 5 | `pnpm i && pnpm dev` |

All three render the same fixture content so you can A/B compare the wire-up
across frameworks. The chat-markdown surface is identical in each — only the
UI layer differs.

## Adding syntax highlighting / KaTeX to any example

The defaults render plain code (`<pre><code>`) and leave `$math$` as text.
To turn those on, install `highlight.js` / `katex` in your app and pass
callbacks per the [README's quick-start](../README.md#quick-start-ai-chat-bubble).
