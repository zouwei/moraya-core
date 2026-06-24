<script lang="ts">
  import { renderChatMarkdown } from '@moraya/core/chat-markdown'

  interface Message {
    role: 'user' | 'assistant'
    content: string
  }

  const fixture: Message[] = [
    { role: 'user', content: 'Give me a short Python example with a code block and a link.' },
    {
      role: 'assistant',
      content: `Sure! Here's a tiny **async fetch** helper:

\`\`\`python
import aiohttp

async def fetch_json(url: str) -> dict:
    async with aiohttp.ClientSession() as s:
        async with s.get(url) as r:
            r.raise_for_status()
            return await r.json()
\`\`\`

See the [aiohttp docs](https://docs.aiohttp.org/) for more.`,
    },
  ]
</script>

<div class="container">
  <h1>@moraya/core — chat-markdown Svelte demo</h1>
  <div class="chat">
    {#each fixture as msg}
      <div class="msg {msg.role}">
        <div class="bubble">
          <!-- SAFE: renderChatMarkdown produces HTML hardened against XSS / JS-URL. -->
          {@html renderChatMarkdown(msg.content)}
        </div>
      </div>
    {/each}
  </div>
</div>
