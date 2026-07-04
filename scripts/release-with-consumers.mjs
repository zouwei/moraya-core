#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * One-command release of @moraya/core + propagation to every consumer
 * (方案 C). Turns the multi-repo release dance into a single command so the
 * "forgot to publish core" / "forgot to bump a consumer" mistakes become
 * structurally impossible — complements the release gates (方案 A/B).
 *
 * What it does, in order:
 *   1. Preflight — core on main + clean (when publishing); discover which
 *      sibling repos actually depend on @moraya/core.
 *   2. Bump @moraya/core to the target version, commit + tag + push.
 *   3. Publish to npm (`npm publish --access public`; prompts for OTP if your
 *      account requires it — run interactively).
 *   4. Poll the npm registry until the new version is resolvable.
 *   5. For each consumer: set "@moraya/core": "^<new>", pnpm install,
 *      pnpm check, self-verify with check-core-dep (release mode), then
 *      commit + push.
 *   6. Print a summary.
 *
 * Usage:
 *   pnpm release patch                 # 0.5.1 → 0.5.2, publish, propagate
 *   pnpm release minor
 *   pnpm release 0.7.0                 # explicit
 *   pnpm release patch --dry-run       # show the whole plan, touch nothing
 *   pnpm release --skip-publish        # core already on npm; only bump consumers
 *   pnpm release patch --yes           # skip the confirmation prompt
 *
 * Consumers are auto-discovered: any sibling in CONSUMER_DIRS whose
 * package.json depends on @moraya/core. moraya-mobile (no direct dep) is
 * skipped automatically.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const PKG = '@moraya/core';
const __dirname = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(__dirname, '..');

// Sibling repos to consider as consumers (relative to moraya-core).
const CONSUMER_DIRS = ['../moraya', '../moraya-web', '../moraya-mobile'];

const NPM_POLL_INTERVAL_MS = 10_000;
// The CI Publish workflow runs install + test + build + OIDC publish, so give
// it a generous budget before declaring the release stuck.
const NPM_POLL_TIMEOUT_MS = 12 * 60_000;

// ── arg parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const YES = args.includes('--yes');
const SKIP_PUBLISH = args.includes('--skip-publish');
const positional = args.filter((a) => !a.startsWith('--'));
const bumpArg = positional[0];

// ── tiny helpers ─────────────────────────────────────────────────────────────
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
function die(msg) {
  console.error(C.red(`\n✖ ${msg}\n`));
  process.exit(1);
}
function readJSON(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function writeJSON(p, data) {
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}
/** Read-only command — always runs, even under --dry-run. */
function query(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/** Mutating command — printed & skipped under --dry-run. `inherit` for OTP prompts. */
function mutate(cmd, cwd, { inherit = false } = {}) {
  const where = cwd.replace(resolve(coreRoot, '..') + '/', '');
  if (DRY) {
    console.log(C.dim(`  [dry] (${where}) ${cmd}`));
    return '';
  }
  console.log(C.dim(`  → (${where}) ${cmd}`));
  return execSync(cmd, {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}
async function confirm(question) {
  if (YES || DRY) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`${question} ${C.dim('[y/N]')} `)).trim().toLowerCase();
  rl.close();
  return ans === 'y' || ans === 'yes';
}
function bumpVersion(current, type) {
  const [maj, min, pat] = current.split('.').map(Number);
  if (type === 'major') return `${maj + 1}.0.0`;
  if (type === 'minor') return `${maj}.${min + 1}.0`;
  if (type === 'patch') return `${maj}.${min}.${pat + 1}`;
  return type; // explicit
}
function isSemver(v) {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}
function gitClean(cwd) {
  return query('git status --porcelain', cwd) === '';
}
function fileDirty(cwd, ...files) {
  const out = query(`git status --porcelain -- ${files.join(' ')}`, cwd);
  return out !== '';
}

// ── main ─────────────────────────────────────────────────────────────────────
const corePkgPath = resolve(coreRoot, 'package.json');
const corePkg = readJSON(corePkgPath);
const currentVersion = corePkg.version;

if (!SKIP_PUBLISH && !bumpArg) {
  die('missing version. Usage: pnpm release <patch|minor|major|x.y.z> [--dry-run] [--skip-publish] [--yes]');
}
const targetVersion = SKIP_PUBLISH && !bumpArg ? currentVersion : bumpVersion(currentVersion, bumpArg);
if (!isSemver(targetVersion)) die(`invalid target version "${targetVersion}"`);

// Discover consumers that actually depend on @moraya/core.
const consumers = [];
for (const rel of CONSUMER_DIRS) {
  const dir = resolve(coreRoot, rel);
  const pj = resolve(dir, 'package.json');
  if (!existsSync(pj)) {
    console.log(C.dim(`  skip ${rel} — not found`));
    continue;
  }
  const pkg = readJSON(pj);
  const spec = pkg.dependencies?.[PKG] ?? pkg.devDependencies?.[PKG];
  if (!spec) {
    console.log(C.dim(`  skip ${rel} — no ${PKG} dependency`));
    continue;
  }
  consumers.push({ rel, dir, pj, name: pkg.name || rel, currentSpec: spec });
}
if (consumers.length === 0) die('no consumer repos depend on @moraya/core');

// ── plan ─────────────────────────────────────────────────────────────────────
console.log(C.bold('\n@moraya/core release plan'));
console.log(`  core:       ${currentVersion} → ${C.green(targetVersion)}${SKIP_PUBLISH ? C.yellow('  (skip publish — assume already on npm)') : ''}`);
console.log(`  mode:       ${DRY ? C.yellow('DRY RUN (no changes)') : 'LIVE'}`);
console.log('  consumers:');
for (const c of consumers) console.log(`    ${c.rel.padEnd(16)} ${c.currentSpec}  →  ^${targetVersion}`);
if (!SKIP_PUBLISH) {
  console.log(
    C.dim(
      '  note:       publish is CI-driven (tag push → OIDC). Requires the trusted\n' +
        '              publisher to be configured on npmjs.com for @moraya/core.',
    ),
  );
}
console.log('');

// ── preflight ────────────────────────────────────────────────────────────────
// A live run aborts on any violation. A dry run downgrades them to warnings so
// the full plan can still be previewed against a dirty working tree.
function requireOrWarn(ok, msg) {
  if (ok) return;
  if (DRY) {
    console.warn(C.yellow(`  ⚠ (would abort in a live run) ${msg.split('\n')[0]}`));
    return;
  }
  die(msg);
}
if (!SKIP_PUBLISH) {
  const branch = query('git rev-parse --abbrev-ref HEAD', coreRoot);
  requireOrWarn(branch === 'main', `moraya-core is on "${branch}", not main. Switch to main before releasing.`);
  requireOrWarn(
    gitClean(coreRoot),
    'moraya-core has uncommitted changes. Commit or stash them first — a release must ' +
      'publish a clean, tagged tree.',
  );
  requireOrWarn(
    !query(`git tag -l v${targetVersion}`, coreRoot),
    `tag v${targetVersion} already exists. Pick a new version.`,
  );
}
// Never clobber a consumer that has in-progress dep edits.
for (const c of consumers) {
  requireOrWarn(
    !fileDirty(c.dir, 'package.json', 'pnpm-lock.yaml'),
    `${c.rel} has uncommitted package.json / pnpm-lock.yaml changes. Commit or revert them first.`,
  );
}

if (!(await confirm(C.bold(`Proceed with ${DRY ? 'DRY RUN of ' : ''}release ${targetVersion}?`)))) {
  console.log('Aborted.');
  process.exit(0);
}

// ── 1. bump + tag core → CI publishes via OIDC ───────────────────────────────
if (!SKIP_PUBLISH) {
  console.log(C.bold(`\n▸ Tagging v${targetVersion} — CI publishes to npm via OIDC`));
  if (!DRY) {
    corePkg.version = targetVersion;
    writeJSON(corePkgPath, corePkg);
  } else {
    console.log(C.dim(`  [dry] set package.json version → ${targetVersion}`));
  }
  mutate(`git add package.json`, coreRoot);
  mutate(`git commit -m "chore: release v${targetVersion}"`, coreRoot);
  mutate(`git tag v${targetVersion}`, coreRoot);
  // Pushing the tag triggers .github/workflows/publish.yml, which publishes
  // to npm via GitHub OIDC trusted publishing — no local `npm publish`, no
  // OTP prompt. The poll below waits for that CI run to land the version.
  mutate(`git push origin main --tags`, coreRoot);
}

// ── 2. wait for CI to serve the version on npm ───────────────────────────────
console.log(
  C.bold(
    SKIP_PUBLISH
      ? `\n▸ Verifying ${PKG}@${targetVersion} on npm`
      : `\n▸ Waiting for CI to publish ${PKG}@${targetVersion} to npm`,
  ),
);
if (DRY) {
  console.log(C.dim(`  [dry] would poll npm until ${targetVersion} resolves`));
} else {
  const deadline = Date.now() + NPM_POLL_TIMEOUT_MS;
  let ok = false;
  while (Date.now() < deadline) {
    let found = '';
    try {
      found = query(`npm view "${PKG}@${targetVersion}" version`, coreRoot);
    } catch {
      /* not there yet */
    }
    if (found) {
      ok = true;
      console.log(C.green(`  ✓ ${PKG}@${targetVersion} is live on npm`));
      break;
    }
    process.stdout.write(
      C.dim('  …waiting for the Publish workflow (install + test + build + OIDC publish)\n'),
    );
    execSync(`sleep ${NPM_POLL_INTERVAL_MS / 1000}`);
  }
  if (!ok) {
    die(
      `${PKG}@${targetVersion} did not appear on npm within ${NPM_POLL_TIMEOUT_MS / 60000} min.\n` +
        `  Check the Publish workflow run: https://github.com/zouwei/moraya-core/actions\n` +
        `  Common causes: OIDC trusted publisher not configured on npmjs.com, or a\n` +
        `  test/build failure. Once the version is live, re-run with --skip-publish\n` +
        `  to bump the consumers.`,
    );
  }
}

// ── 3. propagate to consumers ────────────────────────────────────────────────
const results = [];
for (const c of consumers) {
  console.log(C.bold(`\n▸ ${c.rel}  →  ${PKG}@^${targetVersion}`));
  try {
    if (!DRY) {
      const pkg = readJSON(c.pj);
      const field = pkg.dependencies?.[PKG] ? 'dependencies' : 'devDependencies';
      pkg[field][PKG] = `^${targetVersion}`;
      writeJSON(c.pj, pkg);
    } else {
      console.log(C.dim(`  [dry] set ${PKG} → ^${targetVersion} in package.json`));
    }
    mutate('pnpm install', c.dir);
    mutate('pnpm check', c.dir);
    // Self-verify the release gate would pass (dep is a published npm range).
    mutate('node scripts/check-core-dep.mjs release', c.dir);
    mutate('git add package.json pnpm-lock.yaml', c.dir);
    mutate(`git commit -m "chore(deps): bump ${PKG} to ^${targetVersion}"`, c.dir);
    mutate('git push origin main', c.dir);
    results.push({ rel: c.rel, ok: true });
  } catch (e) {
    results.push({ rel: c.rel, ok: false, err: String(e.message || e).split('\n')[0] });
    console.error(C.red(`  ✖ ${c.rel} failed: ${String(e.message || e).split('\n')[0]}`));
    console.error(C.yellow(`  Stopping. ${PKG}@${targetVersion} is published; re-run with --skip-publish to retry the remaining consumers.`));
    break;
  }
}

// ── 4. summary ───────────────────────────────────────────────────────────────
console.log(C.bold('\n── Summary ──'));
console.log(`  ${PKG}: ${SKIP_PUBLISH ? 'assumed already at' : 'published'} ${targetVersion}`);
for (const r of results) {
  console.log(`  ${r.ok ? C.green('✓') : C.red('✖')} ${r.rel}${r.err ? '  ' + C.dim(r.err) : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
const skipped = consumers.length - results.length;
if (skipped) console.log(C.yellow(`  ${skipped} consumer(s) not attempted (stopped after a failure).`));
if (DRY) console.log(C.yellow('\n  DRY RUN — nothing was changed.'));
process.exit(failed || skipped ? 1 : 0);
