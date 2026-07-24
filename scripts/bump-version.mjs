#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Bump the @moraya/core package version and print the release checklist.
 *
 * Usage:
 *   pnpm version:bump patch         # 0.5.1 → 0.5.2
 *   pnpm version:bump minor         # 0.5.1 → 0.6.0
 *   pnpm version:bump major         # 0.5.1 → 1.0.0
 *   pnpm version:bump 0.7.0         # explicit x.y.z (also accepts x.y.z-beta.1)
 *
 * Files updated:
 *   - package.json  (`version` field only — the SPDX headers in src/**
 *     don't carry the version)
 *
 * The `prepublishOnly` hook (spdx:check + build + test) runs on `npm publish`,
 * so this script does NOT try to build or test — that's deferred to publish.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkgPath = resolve(root, 'package.json');

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJSON(path, data) {
  // Match npm / pnpm convention: 2-space indent + trailing newline.
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: return type; // explicit version string
  }
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error(`Invalid version: "${version}". Expected x.y.z or x.y.z-beta.1`);
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const input = process.argv[2];
if (!input) {
  console.error('Usage: bump-version.mjs <patch|minor|major|x.y.z>');
  process.exit(1);
}

const pkg = readJSON(pkgPath);
const current = pkg.version;
const next = bumpVersion(current, input);
validateVersion(next);

if (current === next) {
  console.error(`Version already at ${next} — nothing to do.`);
  process.exit(1);
}

console.log(`Bumping @moraya/core: ${current} → ${next}\n`);

pkg.version = next;
writeJSON(pkgPath, pkg);
console.log(`  ✓ package.json\n`);

console.log(`Version updated to ${next}.\n`);
console.log(`To release:`);
console.log(`  git add . && git commit -m "chore: release v${next}"`);
console.log(`  git tag v${next}`);
console.log(`  git push origin main --tags`);
console.log(`  npm publish --access public   # runs spdx:check + build + test`);
console.log(``);
console.log(`Then bump the consumer manifests:`);
console.log(`  moraya (PC)      → package.json  "@moraya/core": "^${next}"`);
console.log(`  moraya-web       → package.json  "@moraya/core": "^${next}"`);
