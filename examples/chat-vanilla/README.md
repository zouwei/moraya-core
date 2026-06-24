# chat-vanilla — plain HTML + ESM demo

The smallest possible demo of `@moraya/core/chat-markdown`. No build step,
no install, no package.json — just open `index.html` in a browser.

## Run

```bash
# Any static-file server works. From this folder:
npx serve .
# or:
python3 -m http.server
```

Then open the URL in any modern browser (Chrome / Safari / Firefox / Edge).

## What's inside

- [`index.html`](./index.html) — page shell + chat-bubble CSS
- [`main.js`](./main.js) — imports `renderChatMarkdown` from esm.sh CDN, renders
  a two-message fixture

`@moraya/core` and `markdown-it` (its only peer dep used by chat-markdown)
are pulled directly from [esm.sh](https://esm.sh/) so the demo runs with
zero install. In a real app you'd:

```bash
pnpm i @moraya/core markdown-it
```

and use a bundler (Vite/esbuild/Rollup/webpack/Parcel).
