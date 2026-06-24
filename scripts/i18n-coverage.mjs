#!/usr/bin/env node
/**
 * v0.96.0 CI gate — key-coverage check.
 *
 * Walks a consumer source tree, extracts every `t('…')` / `resolveForLocale('…',…)` /
 * `resolveAllLocales('…',…)` key argument, then joins against the merged
 * locale JSON (loaded from @moraya/core's dist). Exits non-zero if any
 * referenced key is undefined. Also reports defined-but-unreferenced keys
 * as a warning (non-fatal — some are referenced dynamically).
 *
 * USAGE
 *   node scripts/i18n-coverage.mjs <consumer-src-root> [--strict]
 *
 *     <consumer-src-root>  e.g. /Users/.../moraya-web/src or /Users/.../moraya/src
 *     --strict             also fail on unreferenced-but-defined keys
 *
 * INTENT
 *   Wire into PR CI in both moraya and moraya-web to catch the exact bug
 *   class that v0.96.0 was responding to (raw `settings.ai.usage.title`
 *   showing up in the UI because the JSON nested it elsewhere).
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ROOT = process.argv[2]
const STRICT = process.argv.includes('--strict')

if (!ROOT) {
  console.error('Usage: node scripts/i18n-coverage.mjs <consumer-src-root> [--strict]')
  process.exit(2)
}

// Locate the merged English bundle. Prefer the consumer's installed
// @moraya/core; fall back to moraya-core's src for in-tree runs.
function locateEnBundle() {
  const consumerRoot = resolve(ROOT, '..')
  const candidates = [
    join(consumerRoot, 'node_modules/@moraya/core/dist/i18n/locales/en.json'),
    resolve(__dirname, '../src/i18n/locales/en.json'),
    resolve(__dirname, '../dist/i18n/locales/en.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('Could not locate en.json — checked: ' + candidates.join(', '))
}

// ─────────────────────────────────────────────────────────────────────────
// Walk + grep
// ─────────────────────────────────────────────────────────────────────────

const EXTS = new Set(['.ts', '.svelte', '.js', '.mjs'])
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.svelte-kit', '.next',
  'src-tauri', 'target', 'web', 'ios', 'android', '__snapshots__',
  'coverage', '.git', '__tests__',
])

const PATTERNS = [
  /\bt\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  /\bresolveForLocale(?:Async)?\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  /\bresolveAllLocales(?:Async)?\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  /\bget\(t\)\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  /\bt\(\s*`([\w.-]+)`\s*[,)]/g,
]

const referenced = new Map() // key → set of paths

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    let st
    try { st = statSync(path) } catch { continue }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      walk(path)
    } else if (st.isFile()) {
      const ext = entry.slice(entry.lastIndexOf('.'))
      if (!EXTS.has(ext)) continue
      if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue
      const text = readFileSync(path, 'utf8')
      for (const pat of PATTERNS) {
        pat.lastIndex = 0
        let m
        while ((m = pat.exec(text)) !== null) {
          // For backtick pattern, group 1 holds the key; for quoted, group 2.
          const key = m[2] ?? m[1]
          if (!key || !key.includes('.')) continue
          if (!referenced.has(key)) referenced.set(key, new Set())
          referenced.get(key).add(path)
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Flatten JSON
// ─────────────────────────────────────────────────────────────────────────

function flatten(node, prefix = '', out = new Set()) {
  if (typeof node !== 'object' || node === null) return out
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('__')) continue // sentinel keys like __mt
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.add(key)
    else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      flatten(v, key, out)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

const enPath = locateEnBundle()
const defined = flatten(JSON.parse(readFileSync(enPath, 'utf8')))

console.log(`Scanning ${ROOT}`)
console.log(`Locale bundle: ${enPath}`)

walk(resolve(ROOT))

const undef = []
for (const [key] of referenced.entries()) {
  if (!defined.has(key)) undef.push(key)
}

const unref = []
for (const k of defined) {
  if (!referenced.has(k)) unref.push(k)
}

console.log('')
console.log('───────────── COVERAGE ─────────────')
console.log(`Referenced keys (in source):   ${referenced.size}`)
console.log(`Defined keys (in en.json):     ${defined.size}`)
console.log(`Undefined-but-referenced:      ${undef.length}`)
console.log(`Defined-but-unreferenced:      ${unref.length}`)

if (undef.length > 0) {
  console.log('')
  console.log('❌ FAIL — these keys are used in source but missing from en.json:')
  for (const k of undef.slice(0, 50)) {
    const sites = referenced.get(k)
    const example = sites.values().next().value
    console.log(`  ${k}\n    e.g. ${example}`)
  }
  if (undef.length > 50) console.log(`  …(${undef.length - 50} more)`)
  process.exit(1)
}

if (STRICT && unref.length > 0) {
  console.log('')
  console.log('❌ FAIL (--strict) — these keys are defined but never referenced:')
  for (const k of unref.slice(0, 50)) console.log(`  ${k}`)
  if (unref.length > 50) console.log(`  …(${unref.length - 50} more)`)
  process.exit(1)
}

console.log('')
console.log('✅ All referenced keys are defined.')
