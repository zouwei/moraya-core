# Changelog

All notable changes to `@moraya/markdown-core` are documented here. SemVer.

## [Unreleased] — schema + markdown + plugins/setup migration batches (2026-05-05 — 2026-05-06)

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
- 3 DI-coupled plugins: `editor-props-plugin` (Platform + LinkOpener DI),
  `code-block-view` (full RendererRegistry integration + mermaid + KaTeX wire-up + nodeViews),
  faithful `highlight.js` integration (current `plugins/highlight.ts` is a no-op stub)
- 38 fixtures (currently 17): empty-replace / link-input-rule / large-async /
  KaTeX error / frontmatter YAML/TOML/JSON / footnote / wikilink / hashtag /
  Mermaid / blockquote-nested / autolink / hardbreak edge cases / 50KB real doc, etc.
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
