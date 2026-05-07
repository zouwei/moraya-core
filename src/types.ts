/**
 * Dependency-injection interfaces for `@moraya/core`.
 *
 * These 4 interfaces are the **only** boundary between the core package
 * (host-agnostic, pure ESM) and the consumer environment (Tauri / browser /
 * mobile WebView). All Tauri / DOM-specific APIs that previously lived inside
 * the editor source are now accessed through these injected implementations.
 *
 * See iteration spec: `moraya/docs/iterations/v0.60.0-pre-shared-markdown-core.md` §3.3.
 */

/**
 * Loads local / remote media as a URL usable in `img.src` / `video.src` / etc.
 * Typically returns blob: URLs for local files (cached by the implementation).
 */
export interface MediaResolver {
  /** Read a local image file by absolute path; return a blob: URL (implementation caches internally). */
  loadLocalImage(absolutePath: string): Promise<string>

  /** Read a local audio/video file by absolute path; return a blob: URL. */
  loadLocalMedia(absolutePath: string): Promise<string>

  /**
   * Fetch a remote media URL.
   * Browser implementations may return the original URL directly.
   * Tauri implementations proxy through plugin-http to bypass WKWebView mixed-content.
   */
  loadRemoteMedia(url: string): Promise<string>
}

/** Opens an external link (browser = `window.open`; Tauri = plugin-opener; mobile = bridge). */
export interface LinkOpener {
  open(url: string): void
}

/**
 * Custom code-block renderer plugin (WaveDrom / D2 / Excalidraw, etc.).
 * Loaded dynamically via {@link RendererRegistry}.
 */
export interface RendererPluginModule {
  /**
   * Render `source` into `container` (async supported).
   * The caller guarantees `container` is already mounted in the DOM.
   * The implementation must clear any old content of `container` before rendering.
   *
   * Error propagation: if this method throws or rejects, the core captures the error
   * inside the NodeView (no rethrow) and inserts a fallback DOM:
   *   `<div class="renderer-error" data-language="${lang}" data-error="${msg}">[Renderer ${lang} failed]</div>`
   * Roundtrip preservation: the serializer reads the original fenced source from
   * `node.attrs.source` (NOT from the fallback DOM), so the fenced code block
   * round-trips byte-stably even if rendering fails.
   */
  render(
    source: string,
    container: HTMLElement,
    options?: { theme?: string; baseUrl?: string }
  ): void | Promise<void>

  /**
   * Destroy the rendered content within `container` (optional).
   * Called from NodeView.destroy() to free canvas / SVG / event listeners.
   *
   * Error propagation: if this method throws, the core catches and `console.warn`s
   * (does not report to Sentry, does not rethrow). This is a cleanup path; throwing
   * here would block NodeView destruction and cause memory leaks.
   */
  destroy?(container: HTMLElement): void
}

/** Code-block custom renderer registry. Implemented by consumers (Moraya desktop / Web). */
export interface RendererRegistry {
  /** Whether a renderer is registered for the given language identifier. */
  has(language: string): boolean

  /** Asynchronously load the renderer module (consumer handles CDN / local import). */
  load(language: string): Promise<RendererPluginModule>

  /**
   * Snapshot of currently registered renderer versions (language → version string).
   * Used by code-block-view to invalidate cached renders when versions change.
   */
  readonly versions: Readonly<Record<string, string>>
}

/**
 * Platform behavior parameters (carries the editor-props-plugin DI from §F2.6).
 * Desktop injects Tauri / OS truth; Web uses browser detection; mobile bridges fill.
 */
export interface Platform {
  /**
   * Absolute path of the currently open document (used for relative-image-path
   * resolution). Returns `null` when no document is open.
   */
  getCurrentFilePath: () => string | null

  /**
   * Whether the user is on macOS. Affects Option-key handling, Cmd vs Ctrl,
   * emoji popup behavior, etc.
   */
  isMacOS: boolean
}

/** SchemaConfig (re-exported from schema.ts for convenience). */
export interface SchemaConfig {
  mediaResolver: MediaResolver
  rendererRegistry?: RendererRegistry
  linkOpener?: LinkOpener
}

// ===== Internal sentinel for misuse detection (v0.60.0-pre §6.1.1) =====

/**
 * Internal symbol-tagged null MediaResolver used by core for parseMarkdown /
 * serializeMarkdown internal fallback. Consumers must NOT pass this to
 * createSchema(); doing so throws with a descriptive error.
 */
export const NULL_MEDIA_RESOLVER_SENTINEL = Symbol('@moraya/core:null-media-resolver')

export interface NullMediaResolver extends MediaResolver {
  readonly [NULL_MEDIA_RESOLVER_SENTINEL]: true
}

export function isNullMediaResolver(r: MediaResolver): r is NullMediaResolver {
  return (r as NullMediaResolver)[NULL_MEDIA_RESOLVER_SENTINEL] === true
}
