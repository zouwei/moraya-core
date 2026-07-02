// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/** Per-provider driver contract. Drivers are PURE: build a request (no secret)
 *  and parse responses/streams. */
import type { AIProviderConfig, AIRequest, AIResponse, ToolCallRequest, AIUsage } from '../types'
import type { TransportRequest } from '../transport'

/** Stateful streaming accumulator. The SAME parser runs on desktop chunks and
 *  web SSE envelopes. */
export interface StreamFold {
  /** Feed a raw provider SSE envelope JSON; return any text delta to surface. */
  pushEnvelope(rawJson: string): string | undefined
  /** Finalize after the stream ends. */
  finish(): { toolCalls?: ToolCallRequest[]; stopReason: string; usage?: AIUsage }
}

export interface AIDriver {
  /** Build the wire request WITHOUT the secret. */
  buildChatRequest(config: AIProviderConfig, request: AIRequest, stream: boolean): TransportRequest
  /** Parse a non-streaming JSON response (already JSON.parsed). */
  parseResponse(json: Record<string, unknown>, config: AIProviderConfig): AIResponse
  /** Create a streaming folder. */
  createStreamFold(): StreamFold
  /** Whether this provider can stream at all (gated further by transport.canStream). */
  readonly supportsStreaming: boolean
}
