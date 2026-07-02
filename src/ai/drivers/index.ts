// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import type { AIProvider } from '../types'
import type { AIDriver } from './types'
import { claudeDriver } from './claude'
import { openaiDriver } from './openai'
import { geminiDriver } from './gemini'
import { ollamaDriver } from './ollama'

/** Resolve the driver for an HTTP provider. On-device providers (local-mlx /
 *  local-llama) are NOT HTTP — consumers handle those locally and never call
 *  the orchestrator for them, so this throws to catch misuse. */
export function getDriver(provider: AIProvider): AIDriver {
  switch (provider) {
    case 'claude':
      return claudeDriver
    case 'gemini':
      return geminiDriver
    case 'ollama':
      return ollamaDriver
    case 'openai':
    case 'deepseek':
    case 'grok':
    case 'mistral':
    case 'glm':
    case 'minimax':
    case 'doubao':
    case 'custom':
      return openaiDriver
    default:
      throw new Error(`No HTTP driver for provider: ${provider}`)
  }
}

export { claudeDriver, openaiDriver, geminiDriver, ollamaDriver }
export type { AIDriver, StreamFold } from './types'
