import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Plugin, EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { BrowserMediaResolver } from '../../adapters/browser-media-resolver'
import { createSchema } from '../../schema'
import { createCodeBlockNodeViewFactory } from '../code-block-view'

describe('code block pointer events', () => {
  let host: HTMLDivElement
  let view: EditorView

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    view?.destroy()
    host.remove()
  })

  it('lets ProseMirror handle clicks on empty lines and pre padding', () => {
    const schema = createSchema({ mediaResolver: new BrowserMediaResolver() })
    const block = schema.nodes.code_block.create({ language: 'text' }, schema.text('first\n\n\nlast'))
    const doc = schema.nodes.doc.create(null, block)
    const onMouseDown = vi.fn(() => false)
    const plugin = new Plugin({ props: { handleDOMEvents: { mousedown: onMouseDown } } })
    const state = EditorState.create({ schema, doc, plugins: [plugin] })
    view = new EditorView(host, { state, nodeViews: { code_block: createCodeBlockNodeViewFactory() } })

    const pre = view.dom.querySelector('.code-block-pre')!
    pre.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onMouseDown).toHaveBeenCalledTimes(1)

    const toolbar = view.dom.querySelector('.code-block-toolbar')!
    toolbar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onMouseDown).toHaveBeenCalledTimes(1)
  })
})
