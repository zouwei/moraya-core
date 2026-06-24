#!/usr/bin/env node
/**
 * v0.96.0 Phase 3/4 — Codemod that rewrites `t('old.key')` callsites to
 * `t('new.key')` based on the mapping produced by `i18n-merge.mjs`.
 *
 * USAGE
 *   node scripts/i18n-rename.mjs <root>
 *
 *     <root>  directory to walk (e.g. /Users/.../moraya-web/src)
 *
 * MATCH RULES
 *   - `t('key.path')`            single-quoted
 *   - `t("key.path")`            double-quoted
 *   - `t(\`key.path\`)`          backtick template (only when no ${...})
 *   - `resolveForLocale('key.path', …)`
 *   - `resolveAllLocales('key.path', …)`
 *
 *   The key argument must be a string literal — variable-built keys
 *   (`t(\`mobile.\${section}\`)`) are reported but not changed.
 *
 * SCOPE
 *   Walks .ts, .svelte, .js. Skips node_modules, dist, .svelte-kit, build,
 *   *.test.ts, locale JSONs. Operates in-place; assumes git history covers
 *   the rollback.
 *
 * OUTPUT
 *   - Per-file diff count
 *   - Total rename count
 *   - Unresolved cases (template literals, computed expressions, unknown
 *     keys not in the mapping)
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SCRIPT_DIR = new URL('.', import.meta.url).pathname
const MAPPING_PATH = resolve(SCRIPT_DIR, 'i18n-mapping.json')

const MAPPING = JSON.parse(readFileSync(MAPPING_PATH, 'utf8'))

// File extensions to walk + ignore patterns
const EXTS = new Set(['.ts', '.svelte', '.js', '.mjs'])
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.svelte-kit', '.next',
  'src-tauri', 'target', 'web', 'ios', 'android',
  '__snapshots__', 'coverage', '.git',
])
const SKIP_FILES = new Set(['i18n-mapping.json'])

// Function-call patterns. Capture group $2 is the key string literal.
const PATTERNS = [
  // t('key.path'), t("key.path") — single/double quoted
  /\bt\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  // resolveForLocale('key', ...) / resolveAllLocales('key', ...)
  /\bresolveForLocale(?:Async)?\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  /\bresolveAllLocales(?:Async)?\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
  // get(t)('key') — moraya PC uses this in non-Svelte files when t is a store
  /\bget\(t\)\(\s*(['"])([\w.-]+)\1\s*[,)]/g,
]

// Standalone backtick template detection (no interpolation) — uses a separate
// pattern because the regex above only matches single/double quotes.
const BACKTICK_PATTERN = /\bt\(\s*`([\w.-]+)`\s*[,)]/g

const stats = {
  filesScanned: 0,
  filesModified: 0,
  renames: 0,
  unmappedKeys: new Map(), // key → set of files
  templateLiteralCallsites: new Map(), // file → count (for follow-up audit)
}

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
      if (SKIP_FILES.has(entry)) continue
      if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue
      processFile(path)
    }
  }
}

function processFile(path) {
  const original = readFileSync(path, 'utf8')
  let modified = original
  let fileRenames = 0

  // First, detect template-literal callsites with interpolation — flag for manual review
  const templateMatches = modified.match(/\bt\(\s*`[^`]*\$\{[^}]+\}[^`]*`\s*[,)]/g)
  if (templateMatches) {
    stats.templateLiteralCallsites.set(path, templateMatches.length)
  }

  // Apply each pattern. The replacement function looks up MAPPING and either
  // substitutes the new key or leaves the original literal in place.
  for (const pat of PATTERNS) {
    modified = modified.replace(pat, (match, quote, oldKey) => {
      const newKey = MAPPING[oldKey]
      if (newKey && newKey !== oldKey) {
        fileRenames++
        // Replace only the inner key portion, preserve quotes + trailing punctuation
        return match.replace(`${quote}${oldKey}${quote}`, `${quote}${newKey}${quote}`)
      }
      if (!newKey) {
        // Track keys that look like they might be i18n keys but aren't in our mapping.
        // Many will be false positives (variable names happens to be `t`) — review later.
        if (oldKey.includes('.')) {
          if (!stats.unmappedKeys.has(oldKey)) stats.unmappedKeys.set(oldKey, new Set())
          stats.unmappedKeys.get(oldKey).add(path)
        }
      }
      return match
    })
  }

  // Backtick literals (no interpolation)
  modified = modified.replace(BACKTICK_PATTERN, (match, oldKey) => {
    const newKey = MAPPING[oldKey]
    if (newKey && newKey !== oldKey) {
      fileRenames++
      return match.replace('`' + oldKey + '`', '`' + newKey + '`')
    }
    return match
  })

  stats.filesScanned++
  if (fileRenames > 0) {
    writeFileSync(path, modified, 'utf8')
    stats.filesModified++
    stats.renames += fileRenames
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

const root = process.argv[2]
if (!root) {
  console.error('Usage: node scripts/i18n-rename.mjs <root-dir>')
  process.exit(1)
}
const absRoot = resolve(root)
console.log(`Codemod root: ${absRoot}`)
console.log(`Mapping size: ${Object.keys(MAPPING).length} entries`)

walk(absRoot)

console.log('')
console.log('───────────── SUMMARY ─────────────')
console.log(`Files scanned:    ${stats.filesScanned}`)
console.log(`Files modified:   ${stats.filesModified}`)
console.log(`Total renames:    ${stats.renames}`)
console.log(`Unmapped dotted keys (potential false-positives or legitimate gaps):`)
console.log(`  Count: ${stats.unmappedKeys.size}`)
if (stats.unmappedKeys.size > 0 && stats.unmappedKeys.size <= 50) {
  for (const [k, fs] of stats.unmappedKeys.entries()) {
    console.log(`    ${k}  (${fs.size} file${fs.size > 1 ? 's' : ''})`)
  }
}
console.log(`Template-literal t() callsites needing manual review:`)
if (stats.templateLiteralCallsites.size > 0) {
  for (const [f, n] of stats.templateLiteralCallsites.entries()) {
    console.log(`  ${f}  (${n})`)
  }
} else {
  console.log('  (none)')
}
