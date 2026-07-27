import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { createSchema } from '../schema'
import { BrowserMediaResolver } from '../adapters/browser-media-resolver'
import { parseMarkdown } from '../markdown'
import { createEditorPlugins } from '../setup'

/**
 * A widget decoration rendered inside a code block becomes part of
 * `code.textContent` — which the code-block NodeView hands to mermaid as the
 * diagram source. A stray `**` there silently corrupted every diagram in the
 * document (they rendered as black blobs). Marks cannot apply inside a code
 * block at all, so the delimiters must not be drawn there.
 */
const S = createSchema({ mediaResolver: new BrowserMediaResolver() })
let host: HTMLDivElement
let view: EditorView | null = null

async function mount(md: string) {
  const plugins = await createEditorPlugins({ mediaResolver: new BrowserMediaResolver() }, S)
  view = new EditorView(host, { state: EditorState.create({ schema: S, doc: parseMarkdown(md, S), plugins }) })
  return view
}

/** Put the caret at `pos` and arm `strong`, exactly as the bare-`**` rule does. */
function armStrongAt(v: EditorView, pos: number) {
  const tr = v.state.tr.setSelection(TextSelection.create(v.state.doc, pos))
  tr.setStoredMarks([S.marks.strong!.create()])
  v.dispatch(tr)
}

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host) })
afterEach(() => { view?.destroy(); view = null; host.remove() })

describe('cursor-syntax: pending delimiters never enter a code block', () => {
  it('renders no delimiter widgets inside a code block', async () => {
    const v = await mount('```mermaid\nflowchart TD\n  A-->B\n```')
    expect(v.state.doc.firstChild!.type.name).toBe('code_block')
    armStrongAt(v, 3)
    expect(v.dom.querySelectorAll('.syntax-md-mark')).toHaveLength(0)
  })

  it('leaves the code text byte-for-byte intact', async () => {
    const v = await mount('```mermaid\nflowchart TD\n  A-->B\n```')
    armStrongAt(v, 3)
    // This string is what the NodeView passes to mermaid.
    expect(v.dom.querySelector('code')?.textContent).toBe('flowchart TD\n  A-->B')
  })

  it('still renders them in a paragraph, where the mark applies', async () => {
    const v = await mount('hello')
    armStrongAt(v, 3)
    const shown = Array.from(v.dom.querySelectorAll('.syntax-md-mark')).map(e => e.textContent).join('|')
    expect(shown).toBe('**|**')
  })
})
