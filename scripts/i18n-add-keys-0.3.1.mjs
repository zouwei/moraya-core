#!/usr/bin/env node
/**
 * v0.3.1 — Backfill the 23 undefined keys surfaced by Phase 1 of the
 * coverage gate. These were pre-existing `t()` calls in moraya-web (OCR,
 * biometric unlock, voice-recorder, etc.) whose locale entries were never
 * authored. The engine's fallback chain made them silently render as the
 * raw key string in production.
 *
 * Locales touched: en, zh-CN. Other 10 locales rely on the engine's
 * automatic English fallback — adding stubs to them now would be churn
 * with no functional benefit (and would block the human translator
 * from seeing them as work-to-do via the `__mt` mechanism).
 *
 * USAGE
 *   node scripts/i18n-add-keys-0.3.1.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const TARGETS = ['en', 'zh-CN']

const ADDITIONS = {
  // MicFAB — push-to-talk recording overlay
  voice: {
    hold_to_record:    { en: 'Hold to record',        'zh-CN': '按住录音' },
    release_to_send:   { en: 'Release to send',       'zh-CN': '松开发送' },
    cancel:            { en: 'Slide to cancel',       'zh-CN': '滑动取消' },
    permission_denied: { en: 'Microphone permission denied',
                          'zh-CN': '麦克风权限被拒绝' },
  },
  // BiometricUnlockButton — Face ID / Touch ID / Passkey / etc.
  security: {
    biometric_unlock_title:     { en: 'Unlock Moraya',
                                   'zh-CN': '解锁 Moraya' },
    biometric_unlock_subtitle:  { en: 'Authenticate to access your data',
                                   'zh-CN': '验证身份以访问数据' },
    biometric_failed:           { en: 'Authentication failed',
                                   'zh-CN': '身份验证失败' },
    unlock_with_biometric:      { en: 'Unlock with biometric',
                                   'zh-CN': '生物识别解锁' },
    unlock_with_face_id:        { en: 'Unlock with Face ID',
                                   'zh-CN': '使用 Face ID 解锁' },
    unlock_with_touch_id:       { en: 'Unlock with Touch ID',
                                   'zh-CN': '使用 Touch ID 解锁' },
    unlock_with_fingerprint:    { en: 'Unlock with fingerprint',
                                   'zh-CN': '指纹解锁' },
    unlock_with_iris:           { en: 'Unlock with iris scan',
                                   'zh-CN': '虹膜识别解锁' },
    unlock_with_passkey:        { en: 'Unlock with passkey',
                                   'zh-CN': '通行密钥解锁' },
    use_passphrase_fallback:    { en: 'Use passphrase instead',
                                   'zh-CN': '改用密码' },
  },
  // CameraButton — on-device OCR capture flow
  ocr: {
    capture_button:     { en: 'Capture & extract text', 'zh-CN': '拍照识别文字' },
    capture_short:      { en: 'Capture',                'zh-CN': '拍照' },
    recognizing:        { en: 'Recognizing text…',      'zh-CN': '正在识别…' },
    empty_result:       { en: 'No text detected',       'zh-CN': '未检测到文字' },
    failed:             { en: 'OCR failed',             'zh-CN': '识别失败' },
    engine_unavailable: { en: 'OCR not available on this device',
                          'zh-CN': '本设备不支持文字识别' },
  },
  // NotificationCenter
  notifications: {
    recent: { en: 'Recent notifications', 'zh-CN': '最近通知' },
  },
  // Agents page upgrade CTA
  billing: {
    upgrade: { en: 'Upgrade', 'zh-CN': '升级' },
  },
  // ConversationDrawer — single new key inside the existing mobile.ai bundle
  mobile: {
    ai: {
      delete: { en: 'Delete', 'zh-CN': '删除' },
    },
  },
}

function deepMerge(base, overlay, lang) {
  // Treat ADDITIONS leaves (`{ en, 'zh-CN' }`) specially: pick the language value.
  if (
    typeof overlay === 'object' && overlay !== null &&
    Object.keys(overlay).every((k) => k === 'en' || k === 'zh-CN' || k === 'zh-Hant')
  ) {
    // It's a leaf descriptor — return the localized string.
    return overlay[lang] ?? overlay.en
  }
  if (typeof overlay !== 'object' || overlay === null) return overlay
  const out = { ...base }
  for (const [k, v] of Object.entries(overlay)) {
    if (k in out && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])
        && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = deepMerge(out[k], v, lang)
    } else {
      out[k] = deepMerge(out[k], v, lang)
    }
  }
  return out
}

for (const lang of TARGETS) {
  const path = `/Users/onela/Documents/huzou/moraya/moraya-core/src/i18n/locales/${lang}.json`
  const current = JSON.parse(readFileSync(path, 'utf8'))
  const merged = deepMerge(current, ADDITIONS, lang)
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  console.log(`✅ ${lang}: 23 keys added`)
}
