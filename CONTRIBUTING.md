# Contributing to `@moraya/markdown-core`

This package is the shared markdown editor core for Moraya desktop and Moraya Web. Source of truth for the design contract:
[`v0.60.0-pre-shared-markdown-core.md`](https://github.com/zouwei/moraya/blob/main/docs/iterations/v0.60.0-pre-shared-markdown-core.md).

This document covers the developer workflow only — release flow, local dev, fixture authoring, and the immutable engineering rules.

---

## Engineering rules (non-negotiable)

These are derived from the iteration spec §1.1, §1.2, and §1.3. Violations are blocked by CI; do not work around the gates.

### 1. Frontend purity (§1.1.4 — automated)

`dist/` must contain:

- 0 Node API imports (`fs`/`path`/`crypto`/`os`/`child_process`/`stream`/`http`/`https`/`net`/`util`/`events`)
- 0 CommonJS `require()` calls
- 0 host-specific imports (`@tauri-apps/*`/`@capacitor/*`/`cordova-*`/`electron`)
- Main entry `dist/index.js` ≤ 80 KB gzipped

Run locally:

```bash
pnpm build && pnpm test
gzip -c dist/index.js | wc -c   # must be ≤ 81920
```

CI runs all four gates after every `pnpm build`. PRs that fail a gate are blocked from merge.

### 2. Faithful migration (§1.2)

This package is the result of a **1:1 architectural extraction** from Moraya desktop's `src/lib/editor/`. The §1.2.4 cold-code prohibition applies to ongoing work too:

- ❌ No "drive-by" simplifications, renames, comment trims, or parameter reshuffles when fixing an unrelated bug
- ✅ If you spot a real cold-code or refactor opportunity, file a separate issue + PR

Reviewers reject diffs that bundle unrelated changes.

### 3. Behavior parity gates (§1.2.2)

Three layers, all must be green for a release tag:

| Layer | Tool | Run locally |
|---|---|---|
| Roundtrip stability (55 fixtures, second pass byte-identical) | vitest | `pnpm test src/__tests__/roundtrip.spec.ts` |
| Plugin order fingerprint (snapshot) | vitest | `pnpm test src/__tests__/plugin-order.spec.ts` |
| Real-note disk byte-diff (3 sample notes) | manual on Moraya desktop | see §1.2.2 of the iteration spec |

Snapshot updates require explicit reviewer approval (`pnpm vitest run -u`); they are not "auto-accept".

### 4. Public API stability (§3.2)

Removing or renaming an exported symbol, changing parameter required-ness, or modifying roundtrip serialization behavior outside the §4.6 normalization whitelist requires a **major bump** (or a deprecation-warning minor with a one-version transition).

`index.ts` is the only public surface. Don't add re-exports to subpath modules without updating the iteration spec's §3.2 contract list.

### 5. No host-specific code in core

`MediaResolver` / `LinkOpener` / `RendererRegistry` / `Platform` are the four DI seams. New host-specific behavior goes through these, not via direct `import` of `@tauri-apps/*` or `window.fetch` shims.

`adapters/browser-media-resolver.ts` is the only adapter shipped in `dist/`. Tauri / Capacitor / Electron adapters live in their respective consumer repos.

---

## Local development

### Prerequisites

- Node 20+
- pnpm 10
- (optional) GitHub PAT with `read:packages` scope, for installing private deps if any are added later

### Setup

```bash
pnpm install
pnpm typecheck           # strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
pnpm test                # vitest
pnpm build               # tsup → dist/ (ESM + .d.ts)
```

### Iteration loop

```bash
pnpm dev                 # tsup --watch
pnpm test:watch          # vitest watch mode
```

### Sibling-consumer iteration (without a publish round-trip)

If you need to test an unpublished change against Moraya desktop or Moraya Web, **do not** edit the consumer's `package.json` to point at a relative path — that violates the §1.3 hard rules.

Use one of:

1. **`pnpm pack` + tarball install** (recommended):

   ```bash
   # in this repo:
   pnpm build && pnpm pack --pack-destination /tmp/

   # in the consumer repo:
   pnpm add /tmp/moraya-markdown-core-x.y.z.tgz
   ```

2. **Local verdaccio**:

   ```bash
   # one-time setup:
   npm install -g verdaccio
   verdaccio &  # listens on :4873

   # in this repo:
   npm publish --registry http://localhost:4873

   # in the consumer repo: add to .npmrc temporarily:
   #   registry=http://localhost:4873
   pnpm install
   ```

   Restore consumer's `.npmrc` after testing.

---

## Fixture authoring (T4 / §4.3)

Fixtures live in `src/__tests__/fixtures/NN-name.md`. The roundtrip test glob picks every `.md` automatically and asserts:

```
serialize(parse(serialize(parse(input)))) === serialize(parse(input))
```

That is: **first** roundtrip may apply normalization from the §4.6 whitelist (e.g. `_em_` → `*em*`); **second** roundtrip onward must be byte-identical.

When adding a fixture:

1. Pick the next `NN` (already at 55).
2. Cover one specific dimension; don't bundle unrelated cases. Use multiple fixtures for breadth.
3. Run `pnpm test` and confirm it passes immediately. If it doesn't, the fixture is exposing a real serializer bug — file an issue rather than tweaking the fixture to "match".

Schema-critical traps (§4.4) live in `roundtrip.spec.ts`'s `'§4.4 schema-critical data traps'` describe block, not as `.md` fixtures, because they assert structural properties of the parsed Doc.

---

## Release flow

Tags trigger `.github/workflows/publish.yml` which publishes to GitHub Packages.

```bash
# 1. Bump version + update CHANGELOG.md
#    (edit package.json "version" and add a [x.y.z] section in CHANGELOG.md)

# 2. Verify locally
pnpm build && pnpm test
gzip -c dist/index.js | wc -c   # ≤ 81920

# 3. Tag and push
git commit -am "chore: release vx.y.z"
git tag vx.y.z
git push origin main --tags     # triggers publish workflow
```

The `publish` workflow:

1. Re-runs `pnpm test` and `pnpm build`
2. Authenticates to `npm.pkg.github.com` via `${{ secrets.GITHUB_TOKEN }}` with `packages: write`
3. Runs `pnpm publish --no-git-checks` with `publishConfig.access: restricted` (private package)

If the workflow fails, fix the issue and tag a new patch version. Do **not** delete and re-push a tag — published versions are immutable.

### Tarball hygiene audit (§9.1)

Before a release, verify locally:

```bash
pnpm pack --pack-destination /tmp/
tar -tzf /tmp/moraya-markdown-core-x.y.z.tgz | grep -vE "^package/dist/"
# expected output (exactly):
#   package/LICENSE
#   package/package.json
#   package/CHANGELOG.md
#   package/README.md
```

Anything else (e.g. `*.svelte`, `src-tauri/`, `*.test.ts`, lockfile) leaking into the tarball is a release blocker.

---

## Pull request checklist

- [ ] Diff is scoped: only the migration / fix / feature being claimed; no drive-by refactors (§1.2.4)
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean (all 106+ tests)
- [ ] `pnpm build` clean
- [ ] Four §1.1.4 purity gates pass locally
- [ ] If serialization behavior changed → §4.6 whitelist updated **or** new fixture added that fails on `main` and passes on the branch
- [ ] If public API changed → §3.2 in iteration spec updated, version bump justified
- [ ] If plugin order changed → snapshot updated (`pnpm vitest run -u`) **and** explicit explanation in PR body

---

## License

Internal use only (PolyForm Internal Use 1.0.0). Not for redistribution. See `LICENSE`.
