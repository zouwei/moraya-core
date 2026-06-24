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

function ChatBubble({ msg }: { msg: Message }) {
  // SAFE: renderChatMarkdown produces HTML hardened against XSS / JS-URL.
  const html = renderChatMarkdown(msg.content)
  return (
    <div className={`msg ${msg.role}`}>
      <div className="bubble" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export function App() {
  return (
    <div className="container">
      <h1>@moraya/core — chat-markdown React demo</h1>
      <div className="chat">
        {fixture.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
      </div>
    </div>
  )
}
