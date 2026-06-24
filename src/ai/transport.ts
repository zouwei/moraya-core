/**
 * Transport adapter — the platform seam. Core builds requests and parses
 * responses; the consumer executes them:
 *   - desktop: Tauri `ai_proxy_*` commands (key injected by Rust from Keychain)
 *   - web/mobile: direct `fetch()` + SSE (key applied per AuthDescriptor)
 *
 * Mirrors the existing `MediaResolver`/`LinkOpener` DI pattern in core.
 */
import type { AIProvider } from './types'

/** Declarative auth: tells a web transport HOW to attach the secret. The Tauri
 *  transport ignores it (Rust already encodes the same rules per `provider`). */
export interface AuthDescriptor {
  scheme: 'bearer' | 'header' | 'query' | 'none'
  /** for scheme:'header' (e.g. 'x-api-key') */
  headerName?: string
  /** for scheme:'query' (e.g. 'key') */
  queryParam?: string
}

/** A fully-built provider request EXCEPT the secret. Produced by a driver. */
export interface TransportRequest {
  /** Proxy-provider key passed to the Tauri proxy ('claude'|'openai'|'gemini'|'deepseek'|'ollama'). */
  provider: AIProvider | 'openai' | 'claude' | 'gemini' | 'deepseek' | 'ollama'
  /** configId for Keychain lookup on desktop. */
  configId: string
  /** Keychain key prefix (default 'ai-key:'). */
  keyPrefix?: string
  method: 'POST' | 'GET'
  url: string
  /** Headers WITHOUT the auth secret. */
  headers: Record<string, string>
  /** JSON-stringified request body. */
  body: string
  auth: AuthDescriptor
  /** Web transport fills this from its key store; Tauri transport ignores it
   *  (Rust holds the key). Drivers never set it. */
  apiKey?: string
}

export interface TransportResponse {
  status: number
  /** Raw response text (a driver's parseResponse parses it). */
  body: string
}

export interface StreamCallbacks {
  signal?: AbortSignal
  /** A plain text delta (desktop: Rust pre-extracted text chunk). */
  onText: (delta: string) => void
  /** A raw provider SSE envelope JSON string (web: every `data:` payload;
   *  desktop: the `\x02`-tagged non-text events). Driver folds parse it. */
  onEnvelope: (rawJson: string) => void
}

export interface AITransport {
  fetch(req: TransportRequest, signal?: AbortSignal): Promise<TransportResponse>
  stream(req: TransportRequest, cb: StreamCallbacks): Promise<void>
  /** Optional per-provider streaming capability. Defaults to true when absent.
   *  Desktop returns false for gemini/ollama (the Rust proxy has no SSE path
   *  for them) so the orchestrator one-shots them; web returns true for gemini. */
  canStream?(provider: AIProvider): boolean
}
