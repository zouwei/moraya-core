#!/usr/bin/env node
/**
 * v0.96.0 Phase 2 — Merge PC desktop + Mobile/Web locale JSONs into a single
 * unified set under `moraya-core/src/i18n/locales/*.json`, and emit a key-
 * rename mapping so the Phase 3/4 codemod can update callsites consistently.
 *
 * INPUTS
 *   PC repo:   /Users/onela/Documents/huzou/moraya/src/lib/i18n/locales/*.json (12 locales)
 *   Web repo:  /Users/onela/Documents/huzou/moraya/moraya-web/src/lib/i18n/locales/*.json (en, zh-CN)
 *
 * OUTPUTS
 *   moraya-core/src/i18n/locales/<loc>.json   ← merged + renamed bundles
 *   moraya-core/scripts/i18n-mapping.json     ← { oldKey: newKey } for codemod
 *   moraya-core/docs/v0.96.0-merge-conflicts.md ← human-readable conflict log
 *
 * MERGE STRATEGY
 *   Per top-level namespace:
 *     PC-only namespace → keep PC verbatim
 *     Web-only namespace → append Web bundle as-is
 *     Overlap → deep merge; Web wins on leaf conflict (mobile-first UX)
 *
 *   For the 10 PC-only locales (ar, de, es, fr, hi, ja, ko, pt, ru, zh-Hant),
 *   Web-only namespaces are seeded from the English baseline and the namespace
 *   gets a `"__mt": true` sentinel — marks them for human review later.
 *
 * NAMING CONVENTION
 *   `snake_case` terminal segments, `.` for hierarchy.
 *   - camelCase identifiers (e.g. `sourceMode`) → snake_case (`source_mode`)
 *   - existing snake_case stays.
 *   - already-flat dotted keys (e.g. `mobile.appbar.untitled`) untouched.
 *
 *   Applied to BOTH the merged JSON keys AND the mapping (so callsites get
 *   the same treatment by the codemod).
 *
 * USAGE
 *   node scripts/i18n-merge.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CORE_ROOT = resolve(__dirname, '..')

const PC_LOCALES_DIR  = '/Users/onela/Documents/huzou/moraya/src/lib/i18n/locales'
const WEB_LOCALES_DIR = '/Users/onela/Documents/huzou/moraya/moraya-web/src/lib/i18n/locales'
const OUT_LOCALES_DIR = join(CORE_ROOT, 'src/i18n/locales')
const MAPPING_OUT     = join(CORE_ROOT, 'scripts/i18n-mapping.json')
const CONFLICTS_OUT   = join(CORE_ROOT, 'docs/v0.96.0-merge-conflicts.md')

const PC_LOCALES = ['en','zh-CN','zh-Hant','ar','de','es','fr','hi','ja','ko','pt','ru']

// ─────────────────────────────────────────────────────────────────────────
// Naming convention helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convert a single identifier from camelCase to snake_case.
 *
 * Rule: insert `_` before an uppercase letter that follows a lowercase letter
 * or digit, then lowercase everything. This preserves acronyms-at-the-end
 * (`noKBs` → `no_kbs`, not `no_k_bs`) and acronyms-at-the-start (`URLPath`
 * stays a single token `urlpath` — acceptable because no real keys in our
 * bundles use leading acronyms).
 */
function camelToSnake(ident) {
  if (!/[A-Z]/.test(ident)) return ident // already lowercase / snake_case
  return ident.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Apply camelToSnake to each dot-separated segment of a dotted key.
 * `editor.sourceMode` → `editor.source_mode`
 * `aiBudget.title`    → `ai_budget.title`
 * `mobile.appbar.untitled` → unchanged
 */
function renameDottedKey(key) {
  return key.split('.').map(camelToSnake).join('.')
}

/**
 * Walk a nested bundle and rebuild it with renamed keys. Returns:
 *   { bundle: renamedBundle, mapping: { oldDotted: newDotted } }
 * where `mapping` accumulates dotted-path renames (only non-identity).
 */
function renameBundle(bundle, prefix = '', mapping = {}) {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
    return { bundle, mapping }
  }
  const out = {}
  for (const [k, v] of Object.entries(bundle)) {
    const newK = camelToSnake(k)
    const oldPath = prefix ? `${prefix}.${k}` : k
    const newPath = prefix ? `${prefix}.${newK}` : newK
    if (oldPath !== newPath && typeof v === 'string') {
      mapping[oldPath] = newPath
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const r = renameBundle(v, newPath, mapping)
      out[newK] = r.bundle
      // Walk the subtree to capture leaf renames even where the parent didn't change
      const subRenames = collectLeafRenames(v, oldPath, newPath)
      for (const [o, n] of Object.entries(subRenames)) {
        if (o !== n) mapping[o] = n
      }
    } else {
      out[newK] = v
    }
  }
  return { bundle: out, mapping }
}

function collectLeafRenames(obj, oldPrefix, newPrefix, acc = {}) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return acc
  for (const [k, v] of Object.entries(obj)) {
    const newK = camelToSnake(k)
    const oldP = `${oldPrefix}.${k}`
    const newP = `${newPrefix}.${newK}`
    if (typeof v === 'string') {
      if (oldP !== newP) acc[oldP] = newP
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      collectLeafRenames(v, oldP, newP, acc)
    }
  }
  return acc
}

// ─────────────────────────────────────────────────────────────────────────
// Deep merge with conflict logging
// ─────────────────────────────────────────────────────────────────────────

/**
 * Recursively merge `overlay` onto `base`. Web (overlay) wins on leaf
 * conflict. Records every conflict it observed for the conflict log.
 */
function deepMerge(base, overlay, path = '', conflicts = []) {
  if (typeof overlay !== 'object' || overlay === null || Array.isArray(overlay)) return overlay
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return overlay
  const out = { ...base }
  for (const [k, v] of Object.entries(overlay)) {
    const p = path ? `${path}.${k}` : k
    if (k in out) {
      const ov = out[k]
      if (typeof ov === 'string' && typeof v === 'string' && ov !== v) {
        conflicts.push({ path: p, pc: ov, web: v })
        out[k] = v
      } else if (
        typeof ov === 'object' && ov !== null && !Array.isArray(ov) &&
        typeof v === 'object' && v !== null && !Array.isArray(v)
      ) {
        out[k] = deepMerge(ov, v, p, conflicts)
      } else {
        if (typeof ov !== typeof v) {
          conflicts.push({ path: p, pc: JSON.stringify(ov), web: JSON.stringify(v), note: 'type mismatch' })
        }
        out[k] = v
      }
    } else {
      out[k] = v
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Per-locale merge
// ─────────────────────────────────────────────────────────────────────────

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function getWebKeys(webBundle) {
  return new Set(Object.keys(webBundle))
}

function getPCKeys(pcBundle) {
  return new Set(Object.keys(pcBundle))
}

/**
 * Mark a Web-only namespace block as machine-translated (sentinel at the
 * namespace root). Non-mutating.
 */
function markMT(nsBundle) {
  return { __mt: true, ...nsBundle }
}

function mergeLocale(loc, pcBundle, webEnBundle, webLocaleBundle, allConflicts) {
  const pcKeys = getPCKeys(pcBundle)
  const webKeys = getWebKeys(webEnBundle)
  const merged = {}

  // 1. PC-only namespaces → keep verbatim
  for (const ns of pcKeys) {
    if (!webKeys.has(ns)) merged[ns] = pcBundle[ns]
  }

  // 2. Web-only namespaces → append; for non-en/zh-CN locales, mark __mt
  for (const ns of webKeys) {
    if (!pcKeys.has(ns)) {
      const block = webLocaleBundle?.[ns] ?? webEnBundle[ns]
      const isMachineTranslated = loc !== 'en' && loc !== 'zh-CN' && webLocaleBundle === null
      merged[ns] = isMachineTranslated ? markMT(block) : block
    }
  }

  // 3. Overlap: PC base, Web overlay (Web wins on conflict)
  for (const ns of pcKeys) {
    if (webKeys.has(ns)) {
      const base = pcBundle[ns]
      const overlay = (webLocaleBundle?.[ns]) ?? webEnBundle[ns]
      const conflicts = []
      merged[ns] = deepMerge(base, overlay, ns, conflicts)
      for (const c of conflicts) allConflicts.push({ locale: loc, ...c })
    }
  }

  return merged
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

function main() {
  // Read PC bundles
  const pcBundles = {}
  for (const loc of PC_LOCALES) {
    const path = join(PC_LOCALES_DIR, `${loc}.json`)
    pcBundles[loc] = readJSON(path)
  }

  // Read Web bundles
  const webEn = readJSON(join(WEB_LOCALES_DIR, 'en.json'))
  const webZhCN = readJSON(join(WEB_LOCALES_DIR, 'zh-CN.json'))

  if (!existsSync(OUT_LOCALES_DIR)) mkdirSync(OUT_LOCALES_DIR, { recursive: true })

  const allConflicts = []
  const renameMapping = {}

  for (const loc of PC_LOCALES) {
    let webLocaleBundle = null
    if (loc === 'en') webLocaleBundle = webEn
    else if (loc === 'zh-CN') webLocaleBundle = webZhCN

    const merged = mergeLocale(loc, pcBundles[loc], webEn, webLocaleBundle, allConflicts)

    // Apply naming convention rename
    const { bundle: renamed, mapping: localMapping } = renameBundle(merged)

    // Accumulate mapping across locales (should be consistent since key set is mirror)
    Object.assign(renameMapping, localMapping)

    // Sort top-level keys alphabetically for diff stability
    const sortedKeys = Object.keys(renamed).sort()
    const sortedBundle = {}
    for (const k of sortedKeys) sortedBundle[k] = renamed[k]

    writeFileSync(
      join(OUT_LOCALES_DIR, `${loc}.json`),
      JSON.stringify(sortedBundle, null, 2) + '\n',
      'utf8',
    )
  }

  // Write mapping
  const sortedMapping = {}
  for (const k of Object.keys(renameMapping).sort()) sortedMapping[k] = renameMapping[k]
  writeFileSync(MAPPING_OUT, JSON.stringify(sortedMapping, null, 2) + '\n', 'utf8')

  // Write conflict log
  const conflictLines = [
    '# v0.96.0 — Merge conflict log',
    '',
    'Generated by `scripts/i18n-merge.mjs`. Web (overlay) value won on every',
    'conflict listed below. Review each row and either accept the Web value',
    '(do nothing) or override by manually editing the merged locale JSON.',
    '',
    `Total conflicts: **${allConflicts.length}**`,
    '',
  ]
  if (allConflicts.length > 0) {
    conflictLines.push('| Locale | Key | PC value | Web value | Note |')
    conflictLines.push('|---|---|---|---|---|')
    for (const c of allConflicts.slice(0, 500)) {
      const trunc = (s) => String(s).replace(/\|/g, '\\|').slice(0, 80)
      conflictLines.push(`| \`${c.locale}\` | \`${c.path}\` | ${trunc(c.pc)} | ${trunc(c.web)} | ${c.note ?? ''} |`)
    }
    if (allConflicts.length > 500) {
      conflictLines.push('')
      conflictLines.push(`*(${allConflicts.length - 500} more conflicts omitted — see full list in script output)*`)
    }
  } else {
    conflictLines.push('No conflicts found.')
  }
  conflictLines.push('')
  writeFileSync(CONFLICTS_OUT, conflictLines.join('\n'), 'utf8')

  // Summary to stdout
  console.log(`✅ Merged 12 locales → ${OUT_LOCALES_DIR}`)
  console.log(`✅ Wrote ${Object.keys(sortedMapping).length} rename mappings → ${MAPPING_OUT}`)
  console.log(`✅ Logged ${allConflicts.length} conflicts → ${CONFLICTS_OUT}`)
}

main()
