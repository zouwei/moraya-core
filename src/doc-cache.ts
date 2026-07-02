// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import type { Node } from 'prosemirror-model'

/**
 * ProseMirror Doc LRU cache (v0.19.0 perf optimization, ported here).
 *
 * Per v0.60.0-pre §3 file tree note:
 *   - Factory `createDocCache(maxEntries?)` (no module-level singleton)
 *   - Consumers inject via `createEditor(opts.docCache)`; default = createDocCache(10)
 *   - Moraya desktop multi-tab: one app-level instance keyed by filePath hash
 *   - Moraya Web note list: shared app-level instance with createDocCache(50)
 */

export interface DocCache {
  get(hash: number): Node | undefined
  set(hash: number, doc: Node): void
  clear(): void
  /** Current entry count (read-only). */
  readonly size: number
}

class LRUDocCache implements DocCache {
  private readonly map = new Map<number, Node>()
  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) throw new RangeError('docCache maxEntries must be ≥ 1')
  }

  get size(): number {
    return this.map.size
  }

  get(hash: number): Node | undefined {
    const v = this.map.get(hash)
    if (v !== undefined) {
      // LRU touch: re-insert to mark as most-recently-used
      this.map.delete(hash)
      this.map.set(hash, v)
    }
    return v
  }

  set(hash: number, doc: Node): void {
    if (this.map.has(hash)) {
      this.map.delete(hash)
    }
    this.map.set(hash, doc)
    if (this.map.size > this.maxEntries) {
      // Evict oldest
      const firstKey = this.map.keys().next().value
      if (firstKey !== undefined) {
        this.map.delete(firstKey)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/**
 * Create an LRU-bounded ProseMirror Doc cache.
 *
 * @param maxEntries Max docs to retain. Default 10 (matches Moraya desktop's
 *   per-Editor instance size; Moraya Web with note list typically uses 50).
 */
export function createDocCache(maxEntries = 10): DocCache {
  return new LRUDocCache(maxEntries)
}

/** djb2 hash (matches Moraya desktop's existing hash to keep cache key compat). */
export function djb2Hash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return hash >>> 0
}
