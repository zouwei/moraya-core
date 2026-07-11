// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Shared KaTeX strictness policy for every render site (schema toDOM,
 * math NodeViews).
 *
 * `unicodeTextInMathMode` is downgraded to 'ignore': CJK text inside math
 * is legitimate, expected content here — chemistry notes routinely write
 * reaction conditions in Chinese above arrows (`\ce{... ->[点燃] ...}`,
 * `\xrightarrow{加热}`), which KaTeX renders correctly but, at the default
 * strict:'warn', logs a console.warn PER CHARACTER PER RENDER. A document
 * with a handful of such formulas floods the console with hundreds of
 * warnings on every doc switch. Everything else stays at 'warn'.
 */
export const katexStrict = (errorCode: string): 'ignore' | 'warn' =>
  errorCode === 'unicodeTextInMathMode' ? 'ignore' : 'warn'
