// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import type { MediaResolver } from '../types'

/**
 * Default browser-side {@link MediaResolver}.
 *
 * - Local file paths are not meaningful in a pure browser (no FS access);
 *   returns a 1×1 transparent PNG fallback URL with a warning.
 * - Remote URLs are returned as-is (browser handles via native `img.src`).
 *
 * Per v0.60.0-pre §3.7: errors **resolve** with a fallback URL rather than
 * reject, to prevent NodeView crashes on missing assets.
 */
export class BrowserMediaResolver implements MediaResolver {
  /** 1×1 transparent PNG used as fallback for missing local assets. */
  static readonly FALLBACK_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII='

  async loadLocalImage(_absolutePath: string): Promise<string> {
    // Pure browser cannot read local FS paths. Return fallback so the NodeView
    // renders something instead of breaking. Consumers wanting browser-side
    // upload (drag-drop) should pre-convert to data: URL or blob: URL first.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[BrowserMediaResolver] loadLocalImage called with local path; returning fallback PNG')
    }
    return BrowserMediaResolver.FALLBACK_PNG
  }

  async loadLocalMedia(_absolutePath: string): Promise<string> {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[BrowserMediaResolver] loadLocalMedia called with local path; returning empty fallback')
    }
    return BrowserMediaResolver.FALLBACK_PNG
  }

  async loadRemoteMedia(url: string): Promise<string> {
    // Trust the browser to fetch http(s)/data:/blob: URLs directly.
    return url
  }
}
