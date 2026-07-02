// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * Voice/STT + realtime (端到端) provider TYPES + catalogs — shared so the
 * provider definitions live in one place. NOTE: the functional transports
 * (WebSocket for STT/realtime) stay platform-specific and are NOT in core yet:
 * desktop uses a Rust WS proxy (keys hidden); the web/mobile app has no cloud
 * voice backend, and a browser WS would expose API keys (against Moraya's
 * security model). When a backend exists, an AIRealtimeTransport adapter slots
 * in alongside the chat AITransport.
 */

// ── Speech-to-text ──────────────────────────────────────────────────────────
export type SpeechProvider =
  | 'deepgram'
  | 'gladia'
  | 'assemblyai'
  | 'azure-speech'
  | 'aws-transcribe'
  | 'custom'

export interface SpeechProviderConfig {
  id: string
  provider: SpeechProvider
  apiKey: string
  baseUrl?: string
  model: string
  language: string
  region?: string
  awsAccessKey?: string
  awsSecretKey?: string
}

// ── Realtime full-duplex voice (端到端) ───────────────────────────────────────
export type RealtimeVoiceProvider =
  | 'gemini-live'
  | 'openai-realtime'
  | 'doubao-realtime'
  | 'qwen-realtime'
  | 'stepfun-realtime'
  | 'tongyi-bailing'
  | 'amazon-nova-sonic'

export interface RealtimeVoiceAIConfig {
  id: string
  provider: RealtimeVoiceProvider
  apiKey?: string
  baseUrl?: string
  model: string
  voice?: string
  region?: string
  /** Doubao Realtime: X-Api-App-ID. */
  appId?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  extra?: Record<string, string>
}

export const REALTIME_VOICE_DEFAULT_MODELS: Record<RealtimeVoiceProvider, string[]> = {
  'gemini-live': ['gemini-live-2.5-flash-preview-native-audio'],
  'openai-realtime': ['gpt-realtime'],
  'doubao-realtime': ['doubao-realtime'],
  'qwen-realtime': ['qwen-realtime'],
  'stepfun-realtime': ['step-audio-chat'],
  'tongyi-bailing': ['tongyi-bailing-realtime'],
  'amazon-nova-sonic': ['amazon.nova-sonic-v1'],
}

export const REALTIME_VOICE_BASE_URLS: Record<RealtimeVoiceProvider, string> = {
  'gemini-live': 'wss://generativelanguage.googleapis.com/ws',
  'openai-realtime': 'wss://api.openai.com/v1/realtime',
  'doubao-realtime': 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
  'qwen-realtime': 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  'stepfun-realtime': 'wss://api.stepfun.com/v1/realtime',
  'tongyi-bailing': 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
  'amazon-nova-sonic': 'wss://transcribestreaming.{region}.amazonaws.com:8443',
}

export const REALTIME_VOICE_PROVIDER_NAMES: Record<RealtimeVoiceProvider, string> = {
  'gemini-live': 'Gemini Live',
  'openai-realtime': 'OpenAI Realtime',
  'doubao-realtime': 'Doubao Realtime',
  'qwen-realtime': 'Qwen Realtime',
  'stepfun-realtime': 'StepFun Realtime',
  'tongyi-bailing': 'Tongyi Bailing',
  'amazon-nova-sonic': 'Amazon Nova Sonic',
}
