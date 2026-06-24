# chat-svelte — Vite + Svelte 5 demo

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints. Files of interest:

- [`src/App.svelte`](./src/App.svelte) — `renderChatMarkdown` driving a `{@html}` block
- [`src/styles.css`](./src/styles.css) — bubble layout (Svelte `:global()` for HTML inside `{@html}`)

The chat-markdown surface is identical to the [vanilla](../chat-vanilla/) and
[React](../chat-react/) demos — only the host framework differs.
