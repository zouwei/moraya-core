#!/usr/bin/env node
/**
 * v0.96.0 CI gate — boundary check for `@moraya/core/src/i18n/`.
 *
 * Two hard invariants make the future extraction to a standalone
 * `@moraya/i18n` package a path rename instead of a refactor:
 *
 *   1. src/i18n/** MUST NOT import from outside src/i18n/**
 *      (no leaks into schema / plugins / editor concerns)
 *   2. src/i18n/** MUST NOT depend on prosemirror-*, markdown-it, svelte,
 *      or react — keep it framework-agnostic
 *
 * This script greps imports inside src/i18n/ and exits non-zero on violation.
 * Wire into moraya-core's PR CI.
 *
 * USAGE
 *   node scripts/i18n-isolation.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const I18N_ROOT = resolve(__dirname, '../src/i18n')

const FORBIDDEN_BARE_DEPS = [
  /^prosemirror-/,
  /^markdown-it/,
  /^@moraya\/core\/(?!i18n)/, // self-references via the package name (except own subpath)
  /^svelte(\/.*)?$/,
  /^react(\/.*)?$/,
  /^@sveltejs\//,
]

const violations = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const st = statSync(path)
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'locales') continue
      walk(path)
    } else if (st.isFile() && /\.(ts|js|mjs)$/.test(entry)) {
      checkFile(path)
    }
  }
}

function checkFile(path) {
  const text = readFileSync(path, 'utf8')
  const rel = relative(I18N_ROOT, path)
  // Static: import … from '…'
  // Dynamic: import('…')
  const importPattern = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
  let m
  while ((m = importPattern.exec(text)) !== null) {
    const spec = m[1]
    if (!spec) continue
    // Internal relative import: must stay inside src/i18n/**
    if (spec.startsWith('.')) {
      const resolved = resolve(dirname(path), spec)
      if (!resolved.startsWith(I18N_ROOT + '/') && resolved !== I18N_ROOT) {
        violations.push(`${rel}: relative import escapes src/i18n/ → '${spec}' resolves to ${relative(I18N_ROOT, resolved)}`)
      }
      continue
    }
    // Bare specifier: check forbidden deps
    for (const re of FORBIDDEN_BARE_DEPS) {
      if (re.test(spec)) {
        violations.push(`${rel}: forbidden import '${spec}' — ${re}`)
        break
      }
    }
  }
}

walk(I18N_ROOT)

if (violations.length > 0) {
  console.log('❌ FAIL — src/i18n/ boundary violations:')
  for (const v of violations) console.log(`  ${v}`)
  process.exit(1)
}

console.log('✅ src/i18n/ boundary OK — no escape imports, no framework deps.')
