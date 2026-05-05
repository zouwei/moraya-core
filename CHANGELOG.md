# Changelog

All notable changes to `@moraya/markdown-core` are documented here. SemVer.

## [Unreleased] — schema-faithful migration batch (2026-05-05)

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
- markdown.ts: full token override for tables (`table_header_row` fix per CLAUDE.md
  "Table Parsing Fix"), math (`$..$` / `$$..$$` via markdown-it-texmath), html_block /
  html_inline / html_mark paired-tag pre-scan, defList (markdown-it-deflist), frontmatter
  YAML / TOML, footnote, task list checkbox, blank-line preservation
- setup.ts: Tier 1 lazy-load (`preloadEnhancementPlugins`),
  `buildInputRules` / `buildKeymap`, `createImageSelectionPlugin`,
  nodeViews wiring, `columnResizing`
- 11 plugins: code-block-view, cursor-syntax, definition-list, editor-props-plugin,
  emoji, enter-handler, inline-code-convert, keybindings, link-text-plugin,
  mermaid-renderer + faithful highlight.js integration in `highlight.ts`
- 47 fixtures (currently 8): table_header_row / empty-replace / link-input-rule /
  large-async / KaTeX error / frontmatter / GFM task list / raw HTML / def-list /
  footnote / CN punctuation / wikilink / hashtag / 50KB real doc, etc.
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
