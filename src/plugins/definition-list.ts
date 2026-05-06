/**
 * Definition list input rule.
 *
 * Typing `:   ` (colon + 3 spaces) at the start of a line wraps the current
 * block in a definition description inside a definition list.
 *
 * Note: node schemas are defined in `schema.ts`, markdown parsing is handled
 * by `markdown-it-deflist` in `markdown.ts`.
 */

import { wrappingInputRule, type InputRule } from 'prosemirror-inputrules'
import type { Schema } from 'prosemirror-model'

/**
 * Create the def-list input rule against a specific schema.
 *
 * The schema parameter is required because the rule binds to a NodeType, and
 * each consumer-injected schema (per `createSchema(config)`) is a distinct
 * Schema instance with its own NodeTypes.
 */
export function createDefListInputRule(schema: Schema): InputRule {
  return wrappingInputRule(
    /^:\s{3}$/,
    schema.nodes.defListDescription!,
  )
}
