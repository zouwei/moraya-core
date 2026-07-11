# Changelog

All notable changes to `@moraya/core` are documented here. SemVer.

## [0.8.1] — 2026-07-11

### Fixed

- **Chemistry formulas (`\ce` / `\pu`, mhchem) rendered as red error markup.** KaTeX doesn't ship the mhchem macros; without the `katex/contrib/mhchem` side-effect import, `$\ce{H2O}$` showed a red unknown-macro marker in the interactive math NodeViews (`throwOnError: false` path) and display equations like `$$\ce{2KMnO4 ->[\Delta] K2MnO4 + MnO2 + O2 ^}$$` collapsed to red plain text in the schema `toDOM` fallback (which used KaTeX's default `throwOnError: true`). Now `schema.ts` and `plugins/math-node-views.ts` both register mhchem on the shared katex singleton, and the extension is declared external in tsup — critical, since bundling `mhchem.mjs` would drag in a *second* katex instance and register the macros on the wrong one. The full chemistry spectrum is gated by a new render suite (`mhchem-render.spec.ts`: molecules/ions, CJK reaction conditions, gas/precipitate arrows, reversible synthesis, redox, nuclear prescripts, `\pu` units) plus a round-trip fixture (`56-math-mhchem.md`) proving `\ce{...}` source survives parse→serialize byte-stable.
- **Schema `toDOM` math fallback aligned to `throwOnError: false`.** Any *still*-unknown macro now degrades to KaTeX's inline error marker instead of throwing and blanking the entire formula to red plain text; the catch-fallback remains for genuine parse crashes.

Consumers with their own direct `import katex from 'katex'` render paths (e.g. HTML export, chat bubbles) should add `import 'katex/contrib/mhchem'` alongside — the registration is idempotent.

## [0.8.0] — 2026-07-10

### Added

- **`@moraya/core/sync`** — shared document-synchronization engine, so PC / Web / Mobile share one merge semantics and one autosave state machine instead of each maintaining a fork. Two layers, both host-agnostic:
  - **Pure merge primitives**, extracted verbatim from Moraya desktop's battle-tested KB-sync engine (v1.6.0, 298-test regression matrix): `threeWayDiff(last, local, remote, maxSize, initialAuthority)` (the directory-level decision table — upload/download/delete/conflict/aligned, with first-sync `initialAuthority` handling) and the git-style line merge `threeWayMergeLines` / `twoWayMergeLines` / `assembleMerged` / `conflictChunkCount` (`node-diff3`'s `diff3Merge` with `excludeFalseConflicts`; 2-way fallback via `diff`'s `diffLines`).
  - **`DocSyncEngine`** — a single-document optimistic-concurrency state machine that replaces the ad-hoc per-consumer autosave loops which leaked a class of false "conflict detected" prompts. Model: optimistic concurrency (conditional write on a base etag) + client-side **single-flight** serialization + git-style 3-way auto-merge on conflict — the industry-standard shape for single-user multi-device sync (no OT/CRDT). Three invariants kill the false-conflict bug: single-flight (never two overlapping writes carrying a stale base), atomic base advance (`{etag, content}` moved together only after a write succeeds), and a trailing-write loop (a keystroke during an in-flight write re-writes with the fresh base). On a genuine server-side divergence the reconcile pipeline tries adopt-identical → remote-wins → clean 3-way merge → surface to the UI, with a progress-based circuit breaker (not a cross-flush streak counter) that only escalates to manual resolution for a real external writer. IO is dependency-injected via `DocSyncIO` (mirrors the AITransport DI pattern) — implementations return discriminated unions and never throw. 51 unit tests including deterministic concurrency-race cases.
  - Requires the **optional peers** `node-diff3` and `diff` — only consumers importing `/sync` install them (kept out of every other bundle).
- **i18n** — extended `conflict.*` (single-document rich resolve panel: `local`/`remote`/`base`/`take_local`/`take_remote`/`take_both`/`merge_preview`/`unresolved`/`apply`/`auto_merged_toast`) and lifted the 6 desktop `kb_sync.conflict.*` rich-panel keys (`take_*`/`merge_preview`/`unresolved`/`apply_upload`) into all 12 locales, so the desktop conflict panel no longer needs its local i18n override.

## [0.7.5] — 2026-07-09

### Added

- **`@moraya/core/plugins/block-drag`** — host-agnostic position/transaction logic for a visual-mode block drag handle (grab a block, drop it anywhere else in the document). Extracted from Moraya desktop's PC-only implementation so PC and Web share one tested module instead of duplicating it.
  - `resolveDragUnit(doc, pos)` — resolves any position to its natural drag unit: the innermost enclosing `list_item` when nested inside a list (bullet or ordered, any depth), so list rows reorder one at a time instead of dragging the whole list; otherwise the whole top-level block (a table, code block, math block, or blockquote always moves as one atomic unit, never a fragment of it). Correctly handles the case where a position sits exactly at a list's own top/bottom content boundary — attributes it to the first/last item, not the whole list (a real bug caught by direct unit tests before this ever reached a consumer).
  - `siblingRangeInContainer(doc, pos, containerFrom, containerTo)` — during an active drag, re-resolves a position constrained to the drag's own container (the enclosing list, or the whole doc), so a dragged list item can only be dropped among its own siblings.
  - `moveBlockTransaction(state, blockFrom, blockTo, insertPos)` — builds the delete+insert transaction for the move (no-op-safe, sets a `NodeSelection` on the moved content for drop feedback).
  - `firstContentPos(doc, unitFrom, unitTo)` / `topLevelBlockRange(doc, pos)` — supporting helpers (first-line detection for handle alignment; top-level-only resolution).
  - DOM/mouse wiring (hover detection, the mousedown/mousemove/mouseup drag loop, handle icon + insertion-line rendering) is NOT part of this package — it's host-specific UI, implemented separately per consumer (PC: `Editor.svelte`; Web: `MorayaEditor.svelte`).
  - 30 unit tests (`src/plugins/__tests__/block-drag.test.ts`).

### Fixed

- **Backspace at a heading's start didn't demote it to a paragraph.** Every existing Backspace case in `buildKeymap()` was a WebKit atom-adjacency workaround, none heading-aware, so the cursor-at-heading-start case fell through to `baseKeymap`'s `joinBackward` — a no-op when the heading is the first block in the doc, or a silent merge into the previous block otherwise. Either way there was no way to strip the heading marker once its text was gone. This only ever "worked" by accident on platforms whose native contenteditable Backspace happens to outdent headings (WebKit) — Chromium/Firefox don't replicate that, so PC looked fine while web got stuck. Now an explicit case demotes the heading to a paragraph first (Typora/Notion convention); a second Backspace then merges normally via the existing fallback.

## [0.7.3] — 2026-07-08

### Fixed

- **Plain-text-only clipboard paste silently did nothing in the visual editor.** `clipboardTextParser` / `handlePaste`'s markdown-image branch / the large-paste async `handleDOMEvents.paste` path all called `parseMarkdown()` / `parseMarkdownAsync()` with no `schema` argument, which parses against `markdown.ts`'s internal `defaultSchema` singleton — a different `Schema` instance than any real editor actually uses (`createEditor()` always builds its own via `createSchema()`). The resulting `Slice`'s nodes carried mismatched `NodeType`/`MarkType` references, so `replaceSelection`/`replace` silently failed to insert anything. Reproduced with any clipboard content that has no `text/html` representation (e.g. a bare URL copied from a browser address bar, or any plain `<input>`/terminal source) — pasting such content into the visual editor did nothing, while the source-mode plain textarea (which doesn't touch ProseMirror at all) was unaffected. Fixed by passing the live schema (`$context.doc.type.schema` in `clipboardTextParser`, `view.state.schema` elsewhere) through all three call sites in `editor-props-plugin.ts`. The existing test suite for this file mounted its own test editor against `defaultSchema` itself, which masked the bug — tests now build against a real `createSchema()`-based schema (matching production) and a dedicated regression suite covers all three affected paths.

## [0.1.0] — 2026-05-07

Initial public release on npmjs.com. Faithful 1:1 extraction of Moraya desktop's `src/lib/editor/` markdown editor core into a host-agnostic, dependency-injected ESM package, per the iteration spec at [`v0.60.0-pre-shared-markdown-core.md`](https://github.com/zouwei/moraya/blob/main/docs/iterations/v0.60.0-pre-shared-markdown-core.md).

### Package identity

- **Name**: `@moraya/core` (final name; renamed twice during pre-release: working name `@moraya/markdown-core` → interim `@zouwei/moraya-core` (GitHub Packages attempt) → final `@moraya/core` (npmjs.com public))
- **Repo**: https://github.com/zouwei/moraya-core (public)
- **Registry**: npmjs.com (https://registry.npmjs.org), `access: public` — anyone can `npm install @moraya/core` with no token
- **License**: PolyForm Internal Use 1.0.0

### Distribution rationale

The original spec §5.1 chose GitHub Packages (private) for cost reasons, but GitHub Packages requires authentication even for public packages — incompatible with Moraya's open-source distribution model. The pre-release `@zouwei/moraya-core@0.1.0` published to GitHub Packages on 2026-05-06 was unpublished; `@moraya/core@0.1.0` on npmjs.com supersedes it.

### Surface

- **Schema**: `createSchema(config)` factory + 23 nodes / 6 marks (faithful 1:1 from desktop)
- **Markdown**: `parseMarkdown` / `parseMarkdownAsync` (≥50KB threshold) / `serializeMarkdown` with cross-schema parser cache
- **Editor lifecycle**: `createEditor` / `createEditorPlugins` / `preloadEnhancementPlugins` (Tier 1 chunked dynamic import: highlight + emoji + code-block-view)
- **Plugins** (11 total): 8 base + 3 DI-coupled (highlight / editor-props / code-block-view); `review-decoration` excluded (stays in moraya for v0.30.0+ team-collab)
- **Doc cache**: `createDocCache(maxEntries?)` + `djb2Hash`
- **Commands** (14): bold/italic/strike/code/heading/blockquote/lists/code-block/table/HR/math-block/link/image
- **Adapters**: `BrowserMediaResolver` (Tauri / Electron / Capacitor adapters live in their consumer repos)
- **DI seams**: `MediaResolver` / `LinkOpener` / `RendererRegistry` / `Platform` (4 interfaces, §3.3)

### Engineering contract

- **Pure ESM** — `dist/` contains 0 Node API imports, 0 `require()`, 0 host-specific imports (verified by 4 §1.1.4 CI gates)
- **Bundle**: main entry **34 KB gzipped** (42% of 80 KB budget)
- **Tests**: 106 vitest cases across 4 spec files
  - 72 roundtrip tests (55 fixture files + 17 schema-critical data traps)
  - 23 API contract tests
  - 6 plugin-order fingerprint snapshots
  - 5 adapter unit tests
- **Behavior parity**: §1.2.2 layer 1 (fixture roundtrip) + layer 2 (plugin order snapshot) green; layer 3 (3-note byte-diff) deferred to consumer-side smoke test

### Tarball hygiene

`pnpm pack` produces a 58-entry tarball containing only:
- `package/LICENSE`, `package/package.json`, `package/CHANGELOG.md`, `package/README.md`
- `package/dist/**/*.{js,js.map,d.ts}`

No `*.svelte`, `src-tauri/`, `*.test.ts`, lockfile, or fixtures leak into the published artifact.

---

## [Unreleased / pre-release notes] — schema + markdown + plugins/setup + DI plugins migration batches (2026-05-05 — 2026-05-06)

### DI plugins batch (2026-05-06)

Final batch of plugin migration. All 11 ProseMirror plugins from Moraya desktop's `src/lib/editor/plugins/` (excluding `review-decoration.ts` which stays in moraya/) are now in core.

#### Added (3 DI-coupled plugins migrated faithfully)

**`plugins/highlight.ts`** — full faithful 1:1 migration replaces the prior no-op stub.
- Imports + registers 39 highlight.js languages (javascript / typescript / python / rust / go / c / cpp / java / ruby / php / swift / kotlin / yaml / json / bash / sql / xml / html / css / scss / dart / r / perl / scala / objectivec / dockerfile / ini / powershell / makefile / groovy / elixir / haskell / protobuf / graphql / latex / nginx / shell / markdown / diff / lua + svelte/jsx/tsx aliases + cs / py / sh / rb / kt / yml / md / pl / objc / ex / hs / proto / gql / tex / nginxconf / ps1)
- `flattenHljsTree(rootNode)` + `scopeToClasses` walk hljs v11 emitter tree
- Per-block cache keyed by `(language, code)` with FIFO eviction at 100 entries (Moraya CLAUDE.md "Performance Coding Standards" §6 contract)
- 300 ms debounced full re-highlight via metadata-only transaction
- File-switch (`tr.getMeta('file-switch')`) and full-delete (`tr.getMeta('full-delete')`) paths rebuild from scratch
- Short-circuit when `tr.mapping` doesn't touch any code_block (saves ~90% of keystroke debounces)
- Schema-agnostic (no `$lib/` imports); zero behavior drift from desktop

**`plugins/editor-props-plugin.ts`** — full faithful 1:1 migration with `Platform` + `LinkOpener` DI.
- `editorStore.getState().currentFilePath` → `platform.getCurrentFilePath()`
- `isMacOS` from `$lib/utils/platform` → `platform.isMacOS`
- `import('@tauri-apps/plugin-opener').{openPath,openUrl}` → `linkOpener.open(href)` (consumer's LinkOpener routes URL vs local-file)
- 5-plugin merge preserved: `clipboardTextParser` + `handlePaste` (markdown image / empty link / degenerate slice fallbacks) + `transformPastedHTML` (language- → data-language) + `handleDOMEvents.{click,mousedown,keydown,keyup}` (link-hover class / Cmd+click open / math_block click / fast AllSelection delete / WKWebView Backspace fix) + `handleClick` (click-below-content append paragraph) + `handleClickOn` (image → TextSelection) + `handleKeyDown` (ArrowRight ZWSP escape / fast AllSelection delete fallback) + `decorations` (caret-empty-para macOS) + `view` lifecycle (scroll-after-paste + WKWebView empty-doc focus recovery)
- `isLocalFilePath` / `resolveLocalPath` ported as pure helpers (resolve-against-currentFile uses `platform.getCurrentFilePath()`)

**`plugins/code-block-view.ts`** — full faithful 1:1 migration with `RendererRegistry` DI.
- `RENDERER_PLUGINS` / `loadRendererPlugin` / `rendererVersions` (moraya-internal) → `RendererRegistry` injected via `createCodeBlockNodeViewFactory({ rendererRegistry })`
- Renderer plugin language list + versions derived from `registry.versions` keys
- Mermaid still has built-in special-case path (`language === 'mermaid'`) using core's `plugins/mermaid-renderer.ts`
- `LanguageEntry` registry (POPULAR_LANGUAGES + BASE_OTHER_LANGUAGES + dynamic renderer-plugin entries) + `findLanguageLabel`
- Language picker with auto-detect via `hljs.highlightAuto` (relevance > 5 threshold), grouped Popular / All / Renderer Plugins, keyboard nav, outside-click + Escape dismiss, focus-stealing-prevention via append-to-`.editor-wrapper` (not into ProseMirror DOM)
- Mermaid render path: lazy `loadMermaidApi()` → serial render queue → debounce 150 ms → SVG injection or error fallback → theme-change re-render via MutationObserver on `data-theme`
- Renderer render path: `registry.load(lang).render(source, container)` with §3.3 error contract: `<div class="renderer-error" data-language data-error>` fallback DOM, `module.destroy?(container)` called on lang-change / NodeView destroy
- Copy button + toggle-edit/preview button + `stopEvent` / `ignoreMutation` / `update` / `selectNode` / `deselectNode` / `destroy` lifecycle 1:1 from moraya
- 580 lines → ~700 lines (faithful, no shortcuts; the §1.2.4 "no simplification" rule is honored)

#### Wired into setup.ts (this batch)
- `preloadEnhancementPlugins(schema, rendererRegistry?)` now loads **3 chunks** in parallel: highlight + emoji + **code-block-view** (was 2 in previous batch)
- Cache key extended from `Schema` → `{ schema, rendererRegistry }` so consumers with different registry produce different cached factories
- `createEditorPlugins` adds `createEditorPropsPlugin({ platform, linkOpener })` between `columnResizing` and `cursorSyntax`
- `createEditor` wires `nodeViews.code_block` from `tier1.codeBlockView`
- Default `LinkOpener` (`window.open(href, '_blank', 'noopener,noreferrer')`) added when consumer doesn't inject one

#### Plugin order snapshot updates (§1.2.2)
Snapshot diffs reflect intentional changes:
- New `moraya-editor-props$` plugin added between `tableColumnResizing$` and `moraya-cursor-syntax$` (rank 8 → 9 shift for downstream plugins)
- Highlight key renamed: `moraya-highlight$` (stub) → `moraya-syntax-highlight$` (faithful)
Snapshots regenerated and committed per §1.2.2 reviewer-approval workflow.

#### Verification (this batch)
- ✅ `pnpm typecheck` clean (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
- ✅ `pnpm test`: **68/68 pass** (snapshots updated + all roundtrip / api-contract / data-trap / plugin-order tests still passing)
- ✅ `pnpm build`: ESM + .d.ts; `dist/index.js` gzipped = **33.9 KB** (41% of 80 KB budget)
- ✅ §1.1.4 purity gates green (`.js` only): 0 Node API / 0 `require()` / 0 `@tauri-apps`/`@capacitor`/`electron` imports in dist
- ✅ Tier 1 chunks: `highlight.js` 2.4 KB gzipped, `code-block-view.js` 6.1 KB gzipped (hljs + mermaid live in consumer's bundle as peer deps)

#### Plugin migration progress: 11/11 ✅
| Plugin | Status |
|---|---|
| keybindings | Stays in moraya (static data, not a PM plugin) |
| definition-list | ✅ migrated |
| emoji | ✅ migrated |
| cursor-syntax | ✅ migrated |
| enter-handler | ✅ migrated |
| inline-code-convert | ✅ migrated |
| link-text | ✅ migrated |
| mermaid-renderer | ✅ migrated |
| **highlight** | ✅ migrated (this batch) |
| **editor-props-plugin** | ✅ migrated (this batch) |
| **code-block-view** | ✅ migrated (this batch) |
| review-decoration | Stays in moraya (v0.30.0+ team-collab specific) |



### plugins + setup batch (2026-05-06)

#### Added (8 plugins migrated faithfully)
- **`plugins/definition-list.ts`** — `createDefListInputRule(schema)` factory (schema-parameterized)
- **`plugins/emoji.ts`** — `createEmojiPlugin()` converts `:shortcode:` → emoji via `node-emoji` peer dep
- **`plugins/cursor-syntax.ts`** — Typora-style source-syntax overlay (heading/blockquote prefix + paired mark delimiters for strong/em/code/strike_through)
- **`plugins/enter-handler.ts`** — unified Enter-key handler (table cell row navigation + Cmd+Enter add row + Shift+Enter hardbreak + plain Enter exits last row + code-fence detection + pipe-table detection with `parsePipeTableHeader`/`buildTableFromHeaders`)
- **`plugins/inline-code-convert.ts`** — backtick-pair collapse + ZWSP cursor target after trailing `code/strong/em/strike_through` marks + storedMarks management at code-ZWSP boundary
- **`plugins/link-text-plugin.ts`** — `[text](url)` literal-text decoration + cursor-leave collapse to link mark + cursor-enter expand-back-to-literal
- **`plugins/mermaid-renderer.ts`** — lazy-loaded mermaid render utility (serial render queue, theme-color resolution from CSS custom properties); `mermaid` declared as optional peer (`peerDependenciesMeta.mermaid.optional = true`)

All plugin code is **host-agnostic**: zero Tauri / store / DOM-singleton imports. Schema lookups go through `state.schema.nodes[name]` / `state.schema.marks[name]` so each plugin works against any consumer-injected schema produced by `createSchema(config)`.

#### Skipped (intentional — moved out of core scope)
- **`keybindings.ts`** is **NOT a ProseMirror plugin** — it's static `KeyBinding[]` data consumed only by Moraya's CommandPalette UI (file save / zoom / sidebar toggle / etc.). Heavily app-specific shortcut metadata; stays in moraya/. The v0.60.0-pre §3 file-tree listing this in `plugins/` was a documentation artifact.

#### Pending for next batch (3 DI-coupled plugins)
- `editor-props-plugin.ts` (580 lines, needs `Platform.getCurrentFilePath` + `isMacOS` + `LinkOpener.open` injection)
- `code-block-view.ts` (780 lines, needs full `RendererRegistry` integration + mermaid wiring)
- `highlight.ts` faithful hljs integration (current core stub is no-op; full migration requires per-block decoration cache from Moraya CLAUDE.md performance §6/§9 contract)

### setup.ts batch (2026-05-06)

Replaces the 6KB minimum-viable stub with a 21KB faithful migration of Moraya desktop's editor lifecycle (730 lines).

#### Added
- `preloadEnhancementPlugins(schema)` — schema-keyed Tier 1 lazy-load cache (highlight + emoji currently; code-block-view + KaTeX CSS in next batch)
- `createImageSelectionPlugin()` — blue-overlay decoration for selected image / `<img>` html_inline nodes
- **`buildInputRules(schema, tier1)`** — 12 input rules: code-fence, blockquote, bullet/ordered list, heading 1-6, hr, math block + inline, strong (`**` / `__`), em (`*` / `_`), inline code, strike_through (`~~`), task-list checkbox, link `[text](url)`, def-list (Tier 1)
- **`buildKeymap(schema)`** — full keymap from Moraya:
  - `Mod-z/y/Shift-z` → `undo` / `redo` (top-level ESM imports, replaces 3 `require('prosemirror-history')` calls per §1.1.1 Pure ESM)
  - `Mod-b/i/e/Shift-x` → strong / em / code / strike_through marks
  - `Mod-Alt-0..6` → paragraph / heading levels
  - `Mod-Alt-c` → code_block, `Mod-Shift-b` → blockquote
  - `Tab` / `Shift-Tab` / `Mod-]` / `Mod-[` → list indent/outdent
  - `Mod-a` → code-block-local select-all OR doc-wide AllSelection
  - `Shift-Enter` → hardbreak with `isInline: false`
  - `Backspace` → 5-case WebKit contenteditable bug fix (full-doc fast delete + NodeSelection-on-atom + cursor-end-before-atom + cursor-start-after-atom + end-of-paragraph-after-inline-atom + end-of-textblock surrogate-pair-aware delete)
  - `Delete` → block-atom protection (NodeSelection move + textblock-end consume)
- **listShortcutsPlugin** — `Cmd+Alt+O/U/X` → ordered/bullet/task list using `event.code` (macOS Option-key safe, Moraya CLAUDE.md "Option键快捷键处理" feedback memory)
- **`createDirtyTrackPlugin`** + **`createLazyChangePlugin`** — O(1) text-content callback vs debounced markdown-serialization callback
- Full `createEditor(opts)` + `createEditorPlugins(opts, schema?)` — assembles 13 base plugins + Tier 1 lazy-loaded plugins in faithful order:
  1. listShortcuts → 2. inputRules → 3. enter-handler → 4. buildKeymap → 5. baseKeymap →
  6. history (skippable for v0.72 Yjs) → 7. dropCursor → 8. columnResizing →
  9. cursorSyntax → 10. linkText → 11. inlineCodeConvert → 12. imageSelection →
  13. dirty/lazy-change → 14. Tier 1 highlight + emoji
- `wrapInBulletList` / `wrapInOrderedList` / `wrapInTaskList` exported from `commands.ts` (schema-agnostic via `state.schema`)

#### Plugin order fingerprint (§1.2.2)
- New `__tests__/plugin-order.spec.ts`: 6 snapshot/assertion tests covering default Web config, desktop-style config, history disabled (Yjs path), table-resize disabled, onChange/onDocChanged callback variants. **Snapshot is committed** so any reorder/add/remove triggers explicit reviewer review.

#### New peer deps
- `mermaid@^11.0.0` (optional via `peerDependenciesMeta`)
- `node-emoji@^2.0.0`
- `prosemirror-commands@^1.7.0`
- `prosemirror-dropcursor@^1.8.0`
- `prosemirror-inputrules@^1.5.0`
- `prosemirror-keymap@^1.2.0`
- `prosemirror-schema-list@^1.5.0`
- `prosemirror-tables@^1.8.0`

#### Verification (this batch)
- ✅ `pnpm typecheck` clean (strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
- ✅ `pnpm test`: **68/68 pass** (was 62/62; +6 plugin-order fingerprint tests)
- ✅ `pnpm build`: ESM + .d.ts; `dist/index.js` gzipped = 22.7 KB (28% of 80 KB budget)
- ✅ §1.1.4 purity gates green: 0 Node API / 0 `require()` / 0 host imports in dist
- ✅ All `require()` calls in original Moraya `setup.ts:282/286/290/343` replaced with top-level ESM imports per §1.1.1

### markdown.ts batch (2026-05-06)

### markdown.ts batch (2026-05-06)

#### Added
- Faithful 1:1 migration of Moraya desktop `markdown.ts` (912 lines)
- Full token override `MorayaMarkdownParser` class:
  - `tr_open` dispatches to `table_header_row` (inside `<thead>`) vs `table_row` —
    fixes "thead content lost to auto-inserted empty header row" bug
  - `th_open/close` + `td_open/close` wrap inline content in inner `paragraph`
    so `content: 'paragraph+'` cells aren't dropped by `createAndFill`
  - `link_open` detects empty-text links `[]()` / `[](url)` and inserts the raw
    markdown syntax as literal text instead of an empty (=removed) mark
  - `html_inline` handler:
    - Combines single-line `<audio>` / `<video>` opening + closing into one
      `html_inline` atom node so `toDOM` can render media players
    - Pre-scanned paired tags (`htmlPaired` meta) become `html_mark` open/close
      so paired raw HTML like `<font>...</font>` round-trips as styled marks
    - Unpaired tags stay as `html_inline` atom nodes for byte-stable roundtrip
  - `html_block` handler:
    - Promotes standalone `<img>` / `<video>` / `<audio>` blocks to
      `paragraph(html_inline)` so they render as media instead of code blocks
    - Multiple `<img>` tags in one block are joined with inline hardbreaks
- `tagPairedHtmlInline` pre-processor: scans inline tokens and tags paired
  HTML opening/closing tags with `meta.htmlPaired = true`
- `preserveBlankLines` post-processor: injects empty paragraph tokens for
  consecutive blank lines so multi-Enter spacing roundtrips faithfully
- Math support via `markdown-it-texmath` (peer dep): `math_inline`,
  `math_inline_double` (mapped to `math_inline`), and `math_block`
- Definition list support via `markdown-it-deflist` (peer dep)
- GFM table + strikethrough enabled (`md.enable(['table', 'strikethrough'])`)
- Task list checkbox detection in `list_item` getAttrs:
  - `[x]` / `[ ]` parsed from inline content into `checked: boolean | null`
  - Literal checkbox text stripped from the rendered text
- `image` getAttrs decodes URL-encoded backslashes (`%5C` → `\`) so Windows
  local image paths roundtrip correctly
- `link` getAttrs decodes percent-encoded non-ASCII UTF-8 sequences (e.g.
  Chinese / Japanese / Korean) while leaving ASCII encodings (`%20` etc.) intact
- Pre-parse normalizers:
  - `normalizeMathBlocks`: ensures `$$..$$` is surrounded by blank lines so
    texmath parses it as `math_block` (not `math_inline_double`)
  - `normalizeSmartQuotes`: converts curly quotes in image/link title
    delimiters to straight quotes
- Post-serialize cleanup:
  - Un-escapes over-escaped link syntax (`\[\](url)` → `[](url)`)
  - Strips zero-width spaces (`​`) used as cursor targets

#### Serializer
- 23 node serializers (incl. `table` with alignment-aware separator,
  `renderTableRow` helper using output-buffer capture, `math_inline`,
  `math_block`, `defList` / `defListTerm` / `defListDescription`,
  `html_block`, `html_inline`, `hardbreak` always emitting `'  \n'`)
- 6 mark serializers (incl. `html_mark` writing `mark.attrs.openTag` /
  `closeTag`, autolink-aware `link.open`/`close`, mixable `strike_through`)
- `serialize(doc, { tightLists: true })`

#### New fixtures (8→17)
- `09-table-aligned.md` — pipe table with left/center/right alignment
- `10-table-no-header.md` — pipe table sanity check
- `11-math-inline.md` — `$..$` inline math (KaTeX peer dep)
- `12-math-block.md` — `$$..$$` block math (multi-equation)
- `13-raw-html.md` — `<font>` paired tag (html_mark) + `<sub>` + unpaired `<br>`
- `14-def-list.md` — definition list via markdown-it-deflist
- `15-task-list.md` — GFM task list with checkbox stripping
- `16-cn-punctuation.md` — full-width CJK punctuation + bold/italic/strike on CJK
- `17-strikethrough-nested.md` — strikethrough nested inside bold + with em inside

#### New explicit data-trap tests (§4.4)
- block math `$$..$$` does NOT degrade to inline `$..$` after roundtrip
- raw HTML `<font>` preserved verbatim (no markdown conversion)
- paired `<sub>` round-trips byte-stably as `html_mark`
- table first child IS `table_header_row` (the table parsing fix)
- table cells use paragraph-wrapped content (not bare text)
- task list checkbox attrs recovered + literal `[x]`/`[ ]` stripped
- definition list parses to `defList` / `defListTerm` / `defListDescription`

#### Verification (this batch)
- ✅ `pnpm typecheck` clean
- ✅ `pnpm test`: **62/62 pass** (was 46/46; +9 fixture roundtrips, +7 data-trap tests)
- ✅ `pnpm build`: ESM + .d.ts; `dist/index.js` gzipped = 12.8 KB (16% of 80 KB budget)
- ✅ §1.1.4 purity gates: 0 Node API / 0 `require()` / 0 `@tauri-apps`/`@capacitor`/`electron` in dist
- ✅ New peer deps declared (`markdown-it-deflist@^3`, `markdown-it-texmath@^1`)
  with TS shim declarations in `src/shims.d.ts`

### Schema batch (2026-05-05)

> **Honest status**: previous "0.1.0" CHANGELOG overclaimed scope. The actual
> v0.60.0-pre §1.2 *faithful migration* is in progress and shipped per-batch
> rather than as a single drop. Below is the real state at each batch boundary.
> The package will not be tagged & published until all batches land + Moraya
> desktop bridge layer is wired up + behavior parity (§1.2.2) is verified.

### Schema batch (this batch)

#### Added
- ProseMirror schema 1:1 faithful migration from Moraya desktop `src/lib/editor/schema.ts`:
  - **23 nodes**: doc, text, paragraph, heading, blockquote, code_block,
    horizontal_rule, bullet_list, ordered_list, list_item, image, hardbreak,
    html_block, html_inline, table, table_header_row, table_row,
    table_header, table_cell, math_inline, math_block,
    defList, defListTerm, defListDescription
  - **6 marks**: html_mark, strong, em, code, link, strike_through
  - All node attributes match Moraya exact 1:1 (no rename / no schema simplification)
- KaTeX rendering inside `math_inline` / `math_block` `toDOM` (peer dep; no DI needed)
- HTML helpers (`extractHtmlAttr`, `extractAllHtmlAttrs`, `htmlTagToStyle`,
  `showBrokenImage`, `createMediaElement`) ported as pure DOM helpers
- Path detection helpers (`isAbsoluteFilePath`, `isRelativePath`,
  `resolveRelativePath`) ported as pure string ops
- Tauri `read_file_binary` IPC + `plugin-http` calls in image / video / audio
  loaders are replaced by consumer-injected `MediaResolver` methods
  (`loadLocalImage` / `loadLocalMedia` / `loadRemoteMedia`)
- Module-level `documentBaseDir` state preserved with public
  `setDocumentBaseDir(dir)` / `getDocumentBaseDir()` exports
  (pure string state, not Tauri-coupled)
- KaTeX render-error fallback marks math node with
  `class="math-error" data-math-type="inline|block"` per §4.4 contract

#### Changed
- `code_block.attrs.params` → `code_block.attrs.language` (matches Moraya naming)
- `hard_break` node → `hardbreak` (matches Moraya naming + `leafText()` returns `\n`)
- `strikethrough` mark → `strike_through` (matches Moraya naming)
- `bullet_list` / `ordered_list` no longer have `tight` attr (Moraya schema doesn't track tightness on the list node)
- `image` no longer has `width` attr (Moraya encodes width in `title="width=70%"`)
- `list_item` now carries `label` / `listType` / `spread` / `checked` attrs (task-list support)
- `code_block.attrs.language` defaults to `'text'` (was `''`); fence info `''` → `'text'`
- `defaultSchema` now built from the full faithful 23N+6M, not the prior 15-node stub

### Still pending (subsequent batches)
- 38 fixtures (currently 17): empty-replace / link-input-rule / large-async /
  KaTeX error / frontmatter YAML/TOML/JSON / footnote / wikilink / hashtag /
  Mermaid / blockquote-nested / autolink / hardbreak edge cases / 50KB real doc, etc.
- Moraya desktop bridge layer + `TauriMediaResolver` / `TauriLinkOpener` /
  `MorayaRendererRegistry` injection + bridge schema.ts re-export shim
- Moraya desktop end-to-end smoke (`pnpm tauri dev`, save → disk byte diff vs v0.39.0 baseline)
- `@moraya/markdown-core@0.1.0` first publish to GitHub Packages (only after bridge + behavior parity)
- Behavior parity 3-layer verification (§1.2.2): plugin order fingerprint snapshot,
  fixture roundtrip CI gate dual-run with Moraya desktop, hand-test 3 representative
  notes save → disk byte diff
- Moraya desktop bridge layer + `TauriMediaResolver` / `MorayaRendererRegistry` injection
- `@moraya/markdown-core` first publish to GitHub Packages (only after all of above)

### Verification (this batch)
- ✅ `pnpm typecheck`: clean (`tsc --noEmit`, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)
- ✅ `pnpm test`: 46/46 pass (3 spec files: api-contract, roundtrip, adapter)
- ✅ `pnpm build`: ESM + .d.ts emit, dist/index.js gzipped = 9.1 KB (89% under 80 KB budget)
- ✅ §1.1.4 purity gates: 0 Node API imports, 0 `require()`, 0 `@tauri-apps`/`@capacitor`/`electron` in dist

### Notes
- Excludes `review-decoration.ts` (Moraya v0.30.0+ team-collab specific; stays in moraya/ desktop repo)
- Schema requires consumer-provided `MediaResolver` (no default singleton exported; see v0.60.0-pre §6.1.1)
- The internal `defaultSchema` (sentinel-tagged null resolver) is used only by
  `parseMarkdown` / `serializeMarkdown` and is NOT exported via `index.ts`
