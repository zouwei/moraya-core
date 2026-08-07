#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Regenerate src/styles/plugins/syntax.css from src/syntax-palette.ts.
 *
 * The stylesheet is checked in — consumers import the file directly, and
 * tsup's publicDir copies src/styles verbatim into dist — but the palette
 * lives in TS so the export path can inline the same values without parsing
 * CSS at runtime. Run this after editing the palette; syntax-palette.spec.ts
 * fails if you forget.
 *
 * Transpiled with the TypeScript compiler already in devDependencies, rather
 * than adding a loader. syntax-palette.ts imports nothing, so single-file
 * transpilation is all this needs.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')

const src = resolve(here, '../src/syntax-palette.ts')
const js = ts.transpileModule(readFileSync(src, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText

const { syntaxStylesheet } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)

writeFileSync(resolve(here, '../src/styles/plugins/syntax.css'), syntaxStylesheet())
console.log('[gen-syntax-css] wrote src/styles/plugins/syntax.css')
