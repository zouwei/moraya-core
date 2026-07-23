// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * CodeBlock NodeView — toolbar with language label, language picker, copy button,
 * mermaid preview, and renderer-plugin preview.
 *
 * Faithful 1:1 migration from Moraya desktop `src/lib/editor/plugins/code-block-view.ts`
 * with the following DI changes (v0.60.0-pre §F2.5):
 *   - `RENDERER_PLUGINS` / `loadRendererPlugin` / `rendererVersions` (moraya-internal)
 *     → `RendererRegistry` injected via factory parameter
 *   - `editorStore.getState().currentFilePath` (used by `isFilePathRenderer`)
 *     is no longer accessed here; the consumer's RendererRegistry implementation
 *     closes over its own platform context and surfaces it via the renderer
 *     module's `render(source, container)` call.
 *   - mermaid still has a built-in special-case path (`language === 'mermaid'`),
 *     using core's `plugins/mermaid-renderer.ts` (which is itself the migrated
 *     version of moraya's mermaid-renderer).
 *
 * The render dispose-instance pattern from moraya (CAD viewer etc.) is
 * implemented in core via `RendererPluginModule.destroy(container)` per §3.3:
 *   - On render: call `module.render(source, container, options)` (consumer
 *     stores any disposable in container or via WeakMap closure).
 *   - On lang change / NodeView destroy: call `module.destroy?(container)`.
 */

import type { Node as PmNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { renderMermaid as RenderFn, updateMermaidTheme as UpdateThemeFn } from './mermaid-renderer'
import type { RendererRegistry, RendererPluginModule } from '../types'

// ── Mermaid lazy-load wrapper ─────────────────────

type MermaidApi = { renderMermaid: typeof RenderFn; updateMermaidTheme: typeof UpdateThemeFn }
let mermaidApi: MermaidApi | null = null
let mermaidLoading: Promise<MermaidApi | null> | null = null

function loadMermaidApi() {
  if (mermaidApi) return Promise.resolve(mermaidApi)
  if (mermaidLoading) return mermaidLoading
  mermaidLoading = import('./mermaid-renderer').then(mod => {
    mermaidApi = mod
    return mermaidApi
  })
  return mermaidLoading
}

// Theme change listener: re-render all mermaid previews when theme switches
let themeObserverInstalled = false
const mermaidReRenderCallbacks = new Set<() => void>()

function installThemeObserver() {
  if (themeObserverInstalled) return
  themeObserverInstalled = true
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver(() => {
    if (mermaidApi) mermaidApi.updateMermaidTheme()
    for (const cb of mermaidReRenderCallbacks) cb()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

// ── Language registry ─────────────────────────────

interface LanguageEntry {
  id: string       // primary id used in node.attrs.language
  label: string    // display name
  aliases: string[] // searchable aliases
}

const POPULAR_LANGUAGES: LanguageEntry[] = [
  { id: 'javascript', label: 'JavaScript', aliases: ['js'] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'java', label: 'Java', aliases: [] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'c', label: 'C', aliases: [] },
  { id: 'cpp', label: 'C++', aliases: ['c++'] },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'php', label: 'PHP', aliases: [] },
  { id: 'swift', label: 'Swift', aliases: [] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt'] },
  { id: 'sql', label: 'SQL', aliases: [] },
  { id: 'bash', label: 'Bash', aliases: ['sh', 'shell'] },
  { id: 'json', label: 'JSON', aliases: [] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
  { id: 'html', label: 'HTML', aliases: ['xml'] },
  { id: 'css', label: 'CSS', aliases: [] },
  { id: 'csharp', label: 'C#', aliases: ['cs'] },
  { id: 'dart', label: 'Dart', aliases: [] },
  { id: 'r', label: 'R', aliases: [] },
  { id: 'dockerfile', label: 'Dockerfile', aliases: ['docker'] },
  { id: 'graphql', label: 'GraphQL', aliases: ['gql'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'text', label: 'Plain Text', aliases: ['plaintext', 'txt'] },
  { id: 'prompt', label: 'Prompt', aliases: ['image-prompts', 'image-prompt'] },
  { id: 'system', label: 'System Prompt', aliases: ['system-prompt'] },
]

const BASE_OTHER_LANGUAGES: LanguageEntry[] = [
  { id: 'scss', label: 'SCSS', aliases: [] },
  { id: 'lua', label: 'Lua', aliases: [] },
  { id: 'diff', label: 'Diff', aliases: [] },
  { id: 'perl', label: 'Perl', aliases: ['pl'] },
  { id: 'scala', label: 'Scala', aliases: [] },
  { id: 'objectivec', label: 'Objective-C', aliases: ['objc'] },
  { id: 'ini', label: 'TOML / INI', aliases: ['toml'] },
  { id: 'powershell', label: 'PowerShell', aliases: ['ps', 'ps1'] },
  { id: 'makefile', label: 'Makefile', aliases: ['make'] },
  { id: 'groovy', label: 'Groovy', aliases: [] },
  { id: 'elixir', label: 'Elixir', aliases: ['ex'] },
  { id: 'haskell', label: 'Haskell', aliases: ['hs'] },
  { id: 'protobuf', label: 'Protobuf', aliases: ['proto'] },
  { id: 'latex', label: 'LaTeX', aliases: ['tex'] },
  { id: 'nginx', label: 'Nginx', aliases: ['nginxconf'] },
  { id: 'shell', label: 'Shell Session', aliases: [] },
  { id: 'mermaid', label: 'Mermaid', aliases: [] },
]

const POPULAR_IDS = new Set(POPULAR_LANGUAGES.map(l => l.id))

/** Given a renderer registry, derive the full language lists. */
function buildLanguageLists(registry?: RendererRegistry): {
  popular: LanguageEntry[]
  rendererPlugins: LanguageEntry[]
  all: LanguageEntry[]
  rendererLangIds: Set<string>
} {
  const rendererLangIds = registry
    ? new Set(Object.keys(registry.versions))
    : new Set<string>()
  const rendererPlugins: LanguageEntry[] = registry
    ? Object.keys(registry.versions).sort().map((id) => ({
        id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        aliases: [],
      }))
    : []
  const all: LanguageEntry[] = [
    ...POPULAR_LANGUAGES,
    ...BASE_OTHER_LANGUAGES,
    ...rendererPlugins,
  ].sort((a, b) => a.label.localeCompare(b.label))
  return { popular: POPULAR_LANGUAGES, rendererPlugins, all, rendererLangIds }
}

function findLanguageLabel(langId: string, all: LanguageEntry[]): string {
  if (!langId) return 'text'
  const entry = all.find(
    l => l.id === langId || l.aliases.includes(langId),
  )
  return entry ? entry.label : langId
}

// ── Auto-detect language via highlight.js ─────────

let hljsAutoDetect: ((code: string) => string | null) | null = null

async function getAutoDetect(): Promise<(code: string) => string | null> {
  if (hljsAutoDetect) return hljsAutoDetect
  try {
    const hljs = (await import('highlight.js/lib/core')).default
    hljsAutoDetect = (code: string) => {
      if (!code.trim() || code.length < 10) return null
      try {
        const result = hljs.highlightAuto(code)
        if (result.language && result.relevance > 5) {
          return result.language
        }
      } catch { /* ignore */ }
      return null
    }
  } catch {
    hljsAutoDetect = () => null
  }
  return hljsAutoDetect
}

// ── Language Picker ───────────────────────────────

function createLanguagePicker(
  container: HTMLElement,
  anchor: HTMLElement,
  currentLang: string,
  codeContent: string,
  langLists: ReturnType<typeof buildLanguageLists>,
  onSelect: (lang: string) => void,
  onDismiss?: () => void,
): { destroy: () => void } {
  const { popular, rendererPlugins, all } = langLists

  const picker = document.createElement('div')
  picker.className = 'code-lang-picker'
  picker.setAttribute('contenteditable', 'false')
  picker.addEventListener('mousedown', (e) => { e.stopPropagation() })
  picker.addEventListener('click', (e) => { e.stopPropagation() })

  const searchWrap = document.createElement('div')
  searchWrap.className = 'code-lang-search'
  const searchInput = document.createElement('input')
  searchInput.type = 'text'
  searchInput.className = 'code-lang-search-input'
  searchInput.placeholder = 'Search language...'
  searchInput.autocomplete = 'off'
  searchInput.setAttribute('autocorrect', 'off')
  searchInput.setAttribute('autocapitalize', 'off')
  searchInput.spellcheck = false
  searchWrap.appendChild(searchInput)
  picker.appendChild(searchWrap)

  const listEl = document.createElement('div')
  listEl.className = 'code-lang-list'
  picker.appendChild(listEl)

  let detectedLang: string | null = null

  function renderList(filter: string) {
    listEl.innerHTML = ''
    const lowerFilter = filter.toLowerCase()

    const matchesFilter = (entry: LanguageEntry) => {
      if (!lowerFilter) return true
      return (
        entry.id.includes(lowerFilter) ||
        entry.label.toLowerCase().includes(lowerFilter) ||
        entry.aliases.some(a => a.includes(lowerFilter))
      )
    }

    if (detectedLang && !lowerFilter && detectedLang !== currentLang) {
      const label = findLanguageLabel(detectedLang, all)
      const suggestEl = document.createElement('div')
      suggestEl.className = 'code-lang-suggestion'
      suggestEl.innerHTML = `<span class="suggestion-icon">✦</span> ${label} <span class="suggestion-hint">detected</span>`
      suggestEl.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        onSelect(detectedLang!)
        destroy()
      })
      listEl.appendChild(suggestEl)

      const divider = document.createElement('div')
      divider.className = 'code-lang-divider'
      listEl.appendChild(divider)
    }

    const popularMatches = popular.filter(matchesFilter)
    if (popularMatches.length > 0 && !lowerFilter) {
      const groupLabel = document.createElement('div')
      groupLabel.className = 'code-lang-group-label'
      groupLabel.textContent = 'Popular'
      listEl.appendChild(groupLabel)

      for (const lang of popularMatches) {
        listEl.appendChild(createOption(lang))
      }

      const rendererIds = new Set(rendererPlugins.map(l => l.id))
      const others = all.filter(
        l => !POPULAR_IDS.has(l.id) && !rendererIds.has(l.id) && matchesFilter(l),
      )
      if (others.length > 0) {
        const divider = document.createElement('div')
        divider.className = 'code-lang-divider'
        listEl.appendChild(divider)

        const allLabel = document.createElement('div')
        allLabel.className = 'code-lang-group-label'
        allLabel.textContent = 'All'
        listEl.appendChild(allLabel)
        for (const lang of others) {
          listEl.appendChild(createOption(lang))
        }
      }

      const rendererMatches = rendererPlugins.filter(matchesFilter)
      if (rendererMatches.length > 0) {
        const divider2 = document.createElement('div')
        divider2.className = 'code-lang-divider'
        listEl.appendChild(divider2)

        const rendererLabel = document.createElement('div')
        rendererLabel.className = 'code-lang-group-label'
        rendererLabel.textContent = 'Renderer Plugins'
        listEl.appendChild(rendererLabel)
        for (const lang of rendererMatches) {
          listEl.appendChild(createOption(lang))
        }
      }
    } else {
      const matches = all.filter(matchesFilter)
      for (const lang of matches) {
        listEl.appendChild(createOption(lang))
      }
      if (matches.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'code-lang-empty'
        empty.textContent = 'No matches'
        listEl.appendChild(empty)
      }
    }
  }

  function createOption(lang: LanguageEntry): HTMLElement {
    const option = document.createElement('div')
    option.className = 'code-lang-option'
    if (lang.id === currentLang) option.classList.add('selected')
    option.textContent = lang.label
    option.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      onSelect(lang.id)
      destroy()
    })
    return option
  }

  renderList('')

  searchInput.addEventListener('input', () => {
    renderList(searchInput.value)
  })

  searchInput.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      destroy()
    }
  })

  // Append OUTSIDE ProseMirror's DOM tree so the editor's domObserver won't
  // detect focus moving to the search input and steal it back.
  const pickerHost = container.closest('.editor-wrapper') ?? document.body
  pickerHost.appendChild(picker)

  ;(function positionPicker() {
    const rect = anchor.getBoundingClientRect()
    picker.style.position = 'fixed'
    picker.style.top = `${rect.bottom + 2}px`
    picker.style.left = `${rect.left}px`
  })()

  requestAnimationFrame(() => searchInput.focus())

  getAutoDetect().then(detect => {
    detectedLang = detect(codeContent)
    if (detectedLang && !searchInput.value) {
      renderList('')
    }
  })

  function handleOutsideClick(e: MouseEvent) {
    if (!picker.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
      destroy()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      destroy()
    }
  }

  setTimeout(() => {
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleKeydown, true)
  }, 0)

  function destroy() {
    document.removeEventListener('mousedown', handleOutsideClick)
    document.removeEventListener('keydown', handleKeydown, true)
    picker.remove()
    onDismiss?.()
  }

  return { destroy }
}

// ── Text escape helper ────────────────────────────

function escapeText(str: string): string {
  const d = document.createElement('div')
  d.textContent = str
  return d.innerHTML
}

// ── Copy button helper ────────────────────────────

function handleCopy(btn: HTMLButtonElement, codeEl: HTMLElement) {
  const text = codeEl.textContent || ''
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied')
    btn.title = 'Copied!'
    setTimeout(() => {
      btn.classList.remove('copied')
      btn.title = 'Copy'
    }, 1500)
  })
}

// ── NodeView Factory ──────────────────────────────

export interface CodeBlockNodeViewOptions {
  rendererRegistry?: RendererRegistry
}

/**
 * NodeView factory builder. Returns the function to pass as
 * `nodeViews: { code_block: <returned> }` in EditorView config.
 *
 * Closes over a `RendererRegistry` so dispatched renderer plugins are
 * looked up via the consumer's injected registry rather than a Moraya-only
 * static map.
 */
export function createCodeBlockNodeViewFactory(opts: CodeBlockNodeViewOptions = {}) {
  const { rendererRegistry } = opts
  const langLists = buildLanguageLists(rendererRegistry)
  const { rendererLangIds, all: allLanguages } = langLists

  return function createCodeBlockNodeView(
    nodeArg: PmNode,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    let node = nodeArg
    // ── DOM structure ──
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'

    const toolbar = document.createElement('div')
    toolbar.className = 'code-block-toolbar'
    toolbar.setAttribute('contenteditable', 'false')

    const langLabel = document.createElement('span')
    langLabel.className = 'code-lang-label'
    langLabel.textContent = findLanguageLabel((node.attrs.language as string) || '', allLanguages)
    langLabel.title = 'Change language'

    const toggleBtn = document.createElement('button')
    toggleBtn.className = 'mermaid-toggle-btn'
    toggleBtn.type = 'button'

    const copyBtn = document.createElement('button')
    copyBtn.className = 'code-copy-btn'
    copyBtn.title = 'Copy'
    copyBtn.type = 'button'
    copyBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
      '<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>' +
      '</svg>' +
      '<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 6L9 17l-5-5"/>' +
      '</svg>'

    const toolbarRight = document.createElement('div')
    toolbarRight.className = 'code-toolbar-right'
    toolbarRight.appendChild(toggleBtn)
    toolbarRight.appendChild(copyBtn)

    toolbar.appendChild(langLabel)
    toolbar.appendChild(toolbarRight)

    const pre = document.createElement('pre')
    pre.className = 'code-block-pre'
    const code = document.createElement('code')
    code.className = 'code-block-code'
    pre.appendChild(code)

    const mermaidPreview = document.createElement('div')
    mermaidPreview.className = 'mermaid-preview'
    mermaidPreview.setAttribute('contenteditable', 'false')
    mermaidPreview.style.display = 'none'

    const rendererPreview = document.createElement('div')
    rendererPreview.className = 'renderer-preview'
    rendererPreview.setAttribute('contenteditable', 'false')
    rendererPreview.style.display = 'none'

    wrapper.appendChild(toolbar)
    wrapper.appendChild(pre)
    wrapper.appendChild(mermaidPreview)
    wrapper.appendChild(rendererPreview)

    // ── Mermaid state ──
    let isEditing = false
    let isMermaid = (node.attrs.language === 'mermaid')
    let lastRenderedCode = ''
    let renderTimer: ReturnType<typeof setTimeout> | null = null

    // ── Renderer plugin state ──
    let isRenderer = rendererLangIds.has((node.attrs.language as string) || '')
    let rendererEditing = false
    let lastRendererCode = ''
    let rendererTimer: ReturnType<typeof setTimeout> | null = null
    /** Last successfully loaded renderer module — kept so destroy() can be called. */
    let currentRendererModule: RendererPluginModule | null = null

    function syncMermaidMode() {
      const showPreview = isMermaid && !isEditing
      pre.style.display = (showPreview || (isRenderer && !rendererEditing)) ? 'none' : ''
      mermaidPreview.style.display = showPreview ? 'flex' : 'none'
      toggleBtn.style.display = (isMermaid || isRenderer) ? 'inline-flex' : 'none'
      wrapper.classList.toggle('mermaid-preview-mode', showPreview)
      if (isMermaid) {
        toggleBtn.textContent = isEditing ? '👁 Preview' : '✏️ Edit'
        if (showPreview) triggerMermaidRender()
      }
    }

    function triggerMermaidRender() {
      const codeText = code.textContent || ''
      if (!codeText.trim()) {
        mermaidPreview.innerHTML = '<div class="mermaid-empty">Empty diagram</div>'
        lastRenderedCode = ''
        return
      }
      if (codeText === lastRenderedCode) return
      lastRenderedCode = codeText

      if (renderTimer) clearTimeout(renderTimer)
      renderTimer = setTimeout(async () => {
        mermaidPreview.innerHTML = '<div class="mermaid-loading"><div class="mermaid-spinner"></div>Loading diagram...</div>'
        try {
          const api = await loadMermaidApi()
          if (!api) return
          const result = await api.renderMermaid(codeText)
          if (code.textContent !== codeText) return
          if ('svg' in result) {
            mermaidPreview.innerHTML = result.svg
          } else {
            mermaidPreview.innerHTML = `<div class="mermaid-error">${escapeText(result.error)}</div>`
          }
        } catch {
          mermaidPreview.innerHTML = '<div class="mermaid-error">Render failed</div>'
        }
      }, 150)
    }

    // ── Renderer plugin sync ──
    function syncRendererMode() {
      const showPreview = isRenderer && !rendererEditing
      pre.style.display = (showPreview || (isMermaid && !isEditing)) ? 'none' : ''
      rendererPreview.style.display = showPreview ? 'block' : 'none'
      toggleBtn.style.display = (isMermaid || isRenderer) ? 'inline-flex' : 'none'
      wrapper.classList.toggle('renderer-preview-mode', showPreview)
      if (isRenderer) {
        toggleBtn.textContent = rendererEditing ? '👁 Preview' : '✏️ Edit'
        if (showPreview) triggerRendererRender()
      }
    }

    function triggerRendererRender() {
      const source = code.textContent || ''
      const lang = (node.attrs.language as string) || ''
      if (!rendererRegistry || !rendererRegistry.has(lang)) return

      if (!source.trim()) {
        rendererPreview.innerHTML = '<div class="renderer-empty">Empty block</div>'
        lastRendererCode = ''
        return
      }
      if (source === lastRendererCode) return
      lastRendererCode = source

      if (rendererTimer) clearTimeout(rendererTimer)
      rendererTimer = setTimeout(async () => {
        rendererPreview.innerHTML = '<div class="renderer-loading"><div class="renderer-spinner"></div>Rendering...</div>'
        try {
          const module = await rendererRegistry.load(lang)
          if (code.textContent !== source) return // source changed during load
          // Dispose previous renderer (frees canvases / observers)
          if (currentRendererModule?.destroy) {
            try { currentRendererModule.destroy(rendererPreview) } catch { /* swallow per §4.5 */ }
          }
          currentRendererModule = module
          rendererPreview.innerHTML = ''
          try {
            await module.render(source, rendererPreview)
          } catch (e) {
            // §3.3 RendererPluginModule error contract: NodeView shows
            // .renderer-error fallback; serializer keeps fenced source via
            // node.attrs (not DOM), so roundtrip is safe.
            rendererPreview.innerHTML =
              `<div class="renderer-error" data-language="${escapeText(lang)}" data-error="${escapeText(String(e))}">[Renderer ${escapeText(lang)} failed]</div>`
          }
        } catch (e) {
          rendererPreview.innerHTML =
            `<div class="renderer-error" data-language="${escapeText(lang)}" data-error="${escapeText(String(e))}">[Renderer ${escapeText(lang)} failed]</div>`
        }
      }, 150)
    }

    function onThemeChange() {
      if (isMermaid && !isEditing) {
        lastRenderedCode = ''
        triggerMermaidRender()
      }
    }

    if (isMermaid) {
      installThemeObserver()
      mermaidReRenderCallbacks.add(onThemeChange)
      // Defer: ProseMirror populates contentDOM AFTER NodeView factory returns
      requestAnimationFrame(() => syncMermaidMode())
    } else if (isRenderer) {
      // Hide pre and show toggle button immediately, then re-trigger after content arrives
      syncRendererMode()
      requestAnimationFrame(() => syncRendererMode())
    } else {
      syncMermaidMode()
    }

    // ── Language picker ──
    let activePicker: { destroy: () => void } | null = null

    langLabel.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()

      if (activePicker) {
        activePicker.destroy()
        activePicker = null
        wrapper.classList.remove('picker-open')
        return
      }

      const currentLang = (node.attrs.language as string) || ''
      const codeContent = code.textContent || ''
      wrapper.classList.add('picker-open')
      activePicker = createLanguagePicker(
        wrapper,
        langLabel,
        currentLang,
        codeContent,
        langLists,
        (newLang) => {
          activePicker = null
          wrapper.classList.remove('picker-open')
          const pos = getPos()
          if (pos === undefined) return
          view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              language: newLang,
            }),
          )
          view.focus()
        },
        () => {
          activePicker = null
          wrapper.classList.remove('picker-open')
        },
      )
    })

    // ── Enter edit: place the caret INSIDE this block ──
    // The whole editor is one contenteditable, so we keep the invariant
    // "editing ⟺ selection is inside this block". Putting the cursor in the
    // code content on entry lets the selection-exit watcher below reliably
    // detect when the user clicks away.
    function focusCodeContent() {
      const pos = getPos()
      if (pos === undefined) { view.focus(); return }
      const inner = Math.min(pos + 1, view.state.doc.content.size)
      try {
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(inner), 1)))
      } catch { /* boundary edge — fall through to plain focus */ }
      view.focus()
    }

    // ── Auto-exit editing when the selection leaves this block ──
    // Moving the caret from this code block to another node fires NO DOM blur
    // (single contenteditable), so we watch the document's native
    // `selectionchange` and compare against ProseMirror's committed selection.
    // Once the caret is no longer inside this block we drop out of edit mode,
    // which re-renders the diagram/preview (Typora-style click-away-to-render).
    // rAF-deferred so PM has committed its selection before we read it.
    let exitCheckRaf: number | null = null
    function selectionIsInside(): boolean {
      const pos = getPos()
      if (pos === undefined) return false
      const sel = view.state.selection
      // Strictly inside the block CONTENT (exclude node boundaries so a
      // whole-node NodeSelection counts as "outside" → renders).
      return sel.from > pos && sel.to < pos + node.nodeSize
    }
    function scheduleExitCheck() {
      if (!isEditing && !rendererEditing) return
      if (exitCheckRaf !== null) return
      exitCheckRaf = requestAnimationFrame(() => {
        exitCheckRaf = null
        if (!isEditing && !rendererEditing) return
        if (selectionIsInside()) return
        if (isMermaid && isEditing) { isEditing = false; syncMermaidMode() }
        if (isRenderer && rendererEditing) { rendererEditing = false; syncRendererMode() }
      })
    }
    document.addEventListener('selectionchange', scheduleExitCheck)

    // ── Mermaid / Renderer toggle button ──
    toggleBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (isMermaid) {
        isEditing = !isEditing
        syncMermaidMode()
      } else if (isRenderer) {
        rendererEditing = !rendererEditing
        syncRendererMode()
      }
      if (isEditing || rendererEditing) focusCodeContent()
      else view.focus()
    })

    // Click SVG preview → enter edit mode
    mermaidPreview.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      isEditing = true
      syncMermaidMode()
      focusCodeContent()
    })

    // ── Copy button ──
    copyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleCopy(copyBtn, code)
    })

    return {
      dom: wrapper,
      contentDOM: code,

      stopEvent(event: Event) {
        const target = event.target as Node
        return !code.contains(target) && wrapper.contains(target) && target !== code
      },

      ignoreMutation(mutation: { target: Node }) {
        return !code.contains(mutation.target)
      },

      update(updatedNode: PmNode) {
        if (updatedNode.type.name !== 'code_block') return false
        node = updatedNode
        langLabel.textContent = findLanguageLabel((updatedNode.attrs.language as string) || '', allLanguages)

        const wasMermaid = isMermaid
        isMermaid = (updatedNode.attrs.language === 'mermaid')
        if (isMermaid !== wasMermaid) {
          isEditing = false
          if (isMermaid) {
            installThemeObserver()
            mermaidReRenderCallbacks.add(onThemeChange)
          } else {
            mermaidReRenderCallbacks.delete(onThemeChange)
          }
        }

        const wasRenderer = isRenderer
        isRenderer = rendererLangIds.has((updatedNode.attrs.language as string) || '')
        if (isRenderer !== wasRenderer) {
          rendererEditing = false
          lastRendererCode = ''
          rendererPreview.innerHTML = ''
          // Dispose old renderer module when switching away
          if (!isRenderer && currentRendererModule?.destroy) {
            try { currentRendererModule.destroy(rendererPreview) } catch { /* swallow */ }
            currentRendererModule = null
          }
        }

        if (isRenderer) {
          syncRendererMode()
        } else {
          rendererPreview.style.display = 'none'
          wrapper.classList.remove('renderer-preview-mode')
          syncMermaidMode()
        }
        return true
      },

      selectNode() {
        wrapper.classList.add('ProseMirror-selectednode')
      },

      deselectNode() {
        wrapper.classList.remove('ProseMirror-selectednode')
      },

      destroy() {
        document.removeEventListener('selectionchange', scheduleExitCheck)
        if (exitCheckRaf !== null) { cancelAnimationFrame(exitCheckRaf); exitCheckRaf = null }
        if (activePicker) {
          activePicker.destroy()
          activePicker = null
        }
        if (renderTimer) clearTimeout(renderTimer)
        if (rendererTimer) clearTimeout(rendererTimer)
        if (currentRendererModule?.destroy) {
          try { currentRendererModule.destroy(rendererPreview) } catch { /* swallow */ }
        }
        currentRendererModule = null
        mermaidReRenderCallbacks.delete(onThemeChange)
      },
    }
  }
}
