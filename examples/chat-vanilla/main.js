// @ts-check
/**
 * Vanilla ESM demo of @moraya/core/chat-markdown.
 *
 * To run:
 *   1. From this folder, start any static server (e.g. `npx serve .`)
 *   2. Open the URL it prints in any modern browser
 *   3. Edit this file and refresh — no build step
 *
 * Imports are pulled directly from esm.sh CDN so this demo needs no install.
 * In a real project you'd `pnpm i @moraya/core markdown-it` instead.
 */

import { renderChatMarkdown } from 'https://esm.sh/@moraya/core@^0.4.0/chat-markdown'

const fixture = [
  {
    role: 'user',
    content: 'Show me a Python function that fetches a URL and parses JSON.',
  },
  {
    role: 'assistant',
    content: `Sure! Here's a small **async** helper using \`aiohttp\`:

\`\`\`python
import aiohttp

async def fetch_json(url: str) -> dict:
    async with aiohttp.ClientSession() as s:
        async with s.get(url) as r:
            r.raise_for_status()
            return await r.json()
\`\`\`

Three things worth noting:

1. \`raise_for_status()\` turns non-2xx responses into exceptions.
2. The \`async with\` blocks make sure connections close even on error.
3. For more advanced use, see the [aiohttp docs](https://docs.aiohttp.org/).

> **Tip:** if you're on Python 3.11+, consider \`httpx\` as a drop-in alternative.`,
  },
]

const chat = /** @type {HTMLElement} */ (document.getElementById('chat'))

for (const msg of fixture) {
  const row = document.createElement('div')
  row.className = `msg ${msg.role}`
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  // SAFE: renderChatMarkdown produces HTML escaped against XSS/JS-URL attacks.
  bubble.innerHTML = renderChatMarkdown(msg.content)
  row.appendChild(bubble)
  chat.appendChild(row)
}
