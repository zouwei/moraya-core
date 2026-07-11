// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * mhchem rendering gate — proves the \ce/\pu chemistry macros are actually
 * registered on the katex singleton (via the side-effect import in schema.ts /
 * math-node-views.ts) and that the full sample spectrum renders without
 * KaTeX's unknown-macro error markup.
 *
 * KaTeX with `throwOnError: false` renders an unknown macro as
 * `<span class="katex-error" ... style="color:#cc0000">` — exactly the red
 * `\ce` markers this suite guards against regressing.
 */
import { describe, test, expect } from 'vitest'
import katex from 'katex'
// The import under test — same side-effect module the render paths use.
import 'katex/contrib/mhchem'

const render = (latex: string, displayMode = false) =>
  katex.renderToString(latex, { displayMode, throwOnError: false })

/** The user-visible failure signature: unknown macro → katex-error span. */
function expectClean(html: string) {
  expect(html).not.toContain('katex-error')
  expect(html).not.toContain('#cc0000')
}

describe('mhchem \\ce — inline formulas and ions', () => {
  test('\\ce{H2O} parses into real markup (subscript), not an error', () => {
    const html = render('\\ce{H2O}')
    expectClean(html)
    // The 2 must be typeset as a subscript (KaTeX MathML annotation uses
    // <msub>), proving mhchem expanded the macro rather than echoing text.
    expect(html).toContain('<msub>')
  })

  test.each([
    'CO2',
    'SO4^{2-}',
    'NH4+',
    'Ca(OH)2',
    '[Cu(H2O)4]^2+',
    'CH4',
    'CH3CH2OH',
    'CH2=CH2',
    'HC\\equiv CH',
    'C6H6',
    'C6H5-',
    'C6H12O6',
  ])('\\ce{%s} renders clean', (body) => {
    expectClean(render(`\\ce{${body}}`))
  })
})

describe('mhchem \\ce — equations (display mode)', () => {
  test.each([
    // combustion, CJK above-arrow condition
    '2H2 + O2 ->[点燃] 2H2O',
    // decomposition: \Delta condition + trailing gas arrow
    '2KMnO4 ->[\\Delta] K2MnO4 + MnO2 + O2 ^',
    // precipitation arrows
    'Ag+ + Cl- -> AgCl v',
    'CO2 + Ca(OH)2 -> CaCO3 v + H2O',
    // reversible with stacked CJK conditions
    'N2 + 3H2 <=>[\\text{催化剂}][\\text{高温、高压}] 2NH3',
    // electrochemistry / redox
    'Zn - 2e- -> Zn^2+',
    'Cu^2+ + 2e- -> Cu',
    'MnO4- + 8H+ + 5e- -> Mn^2+ + 4H2O',
    // nuclear: mass/atomic number prescripts
    '^{14}_{6}C -> ^{14}_{7}N + ^{-1}_{0}e',
    '^{235}_{92}U + ^{1}_{0}n -> ^{141}_{56}Ba + ^{92}_{36}Kr + 3^{1}_{0}n',
  ])('$$\\ce{%s}$$ renders clean', (body) => {
    expectClean(render(`\\ce{${body}}`, true))
  })
})

describe('mhchem \\pu — physical units', () => {
  test.each(['123 kJ/mol', '0.1 mol/L'])('\\pu{%s} renders clean', (body) => {
    expectClean(render(`\\pu{${body}}`))
  })
})
