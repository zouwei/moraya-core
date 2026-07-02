#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * SPDX header gate for `@moraya/core`.
 *
 * Since `@moraya/core` is licensed GPL-3.0 with a dual-license option,
 * every source file MUST carry an SPDX identifier so the license is
 * unambiguous even when a single file is copied out of the repo.
 *
 * INVARIANT
 *   Every `.ts` / `.tsx` / `.js` / `.mjs` file under `src/` must start with:
 *
 *     // SPDX-License-Identifier: GPL-3.0-only
 *     // Copyright (C) <year> <author>
 *
 *   (A leading `#!/usr/bin/env node` shebang is permitted above the header.)
 *
 * USAGE
 *   node scripts/check-spdx.mjs         # verify (exit 1 on missing)
 *   node scripts/check-spdx.mjs --fix   # auto-prepend missing headers
 *
 * Wired into `pnpm test` gates and CI. Also runs via `prepublishOnly` so
 * `npm publish` refuses to ship a file without an SPDX header.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = resolve(__dirname, '../src')

const SPDX_LINE = '// SPDX-License-Identifier: GPL-3.0-only'
const COPYRIGHT_LINE = '// Copyright (C) 2026 zouwei'
const HEADER = `${SPDX_LINE}\n${COPYRIGHT_LINE}\n\n`

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs'])

/** Recursively yield every source file path under `dir`. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      yield* walk(p)
    } else if (st.isFile()) {
      const dot = name.lastIndexOf('.')
      if (dot > 0) {
        const ext = name.slice(dot)
        // Match both `.ts` and `.d.ts` — both need the header.
        if (SOURCE_EXTS.has(ext)) yield p
      }
    }
  }
}

/** True iff `text` begins with the SPDX line (allowing an optional shebang). */
function hasSpdxHeader(text) {
  let body = text
  if (body.startsWith('#!')) {
    const nl = body.indexOf('\n')
    if (nl < 0) return false
    body = body.slice(nl + 1)
  }
  return body.startsWith(SPDX_LINE)
}

/** Prepend the header to `text` (preserving a leading shebang if present). */
function prependHeader(text) {
  if (text.startsWith('#!')) {
    const nl = text.indexOf('\n')
    return text.slice(0, nl + 1) + HEADER + text.slice(nl + 1)
  }
  return HEADER + text
}

const fix = process.argv.includes('--fix')
const missing = []
let patched = 0

for (const file of walk(SRC_ROOT)) {
  const text = readFileSync(file, 'utf-8')
  if (hasSpdxHeader(text)) continue
  if (fix) {
    writeFileSync(file, prependHeader(text), 'utf-8')
    patched += 1
  }
  missing.push(relative(process.cwd(), file))
}

if (fix) {
  console.log(`[check-spdx] patched ${patched} file(s):`)
  for (const p of missing) console.log(`  + ${p}`)
  process.exit(0)
}

if (missing.length > 0) {
  console.error(
    `\n::error::${missing.length} source file(s) missing SPDX header.\n` +
      `Expected first line:\n  ${SPDX_LINE}\n\n` +
      `Missing:`,
  )
  for (const p of missing) console.error(`  - ${p}`)
  console.error(
    `\nFix: node scripts/check-spdx.mjs --fix\n` +
      `Or add the two-line header manually at the top of each file.`,
  )
  process.exit(1)
}

console.log(`[check-spdx] OK — SPDX header present on all source files under src/`)
