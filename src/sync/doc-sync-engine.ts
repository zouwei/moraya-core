// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

/**
 * DocSyncEngine — single-document optimistic-concurrency sync state machine.
 *
 * Shared by every Moraya frontend for "edit a note, autosave to a cloud object
 * store" (Picora, S3, …). It replaces the ad-hoc per-consumer autosave loops
 * that leaked a class of false "conflict detected" prompts.
 *
 * MODEL (industry-standard for single-user, multi-device — no OT/CRDT needed):
 *   optimistic concurrency (conditional write on a base etag)
 *   + client-side single-flight serialization
 *   + git-style 3-way auto-merge on conflict.
 *
 * The three invariants that kill the false-conflict bug:
 *
 *   1. SINGLE-FLIGHT. At most one write is ever in flight. A `flushNow()` while
 *      a write is running joins the same promise instead of starting a second,
 *      overlapping write that would carry a now-stale base etag (→ the server
 *      would judge it REMOTE_NEWER = a self-conflict).
 *
 *   2. ATOMIC BASE ADVANCE. The base is a `{ etag, content }` pair advanced
 *      together, only after a write round-trip succeeds. etag and content can
 *      never drift apart, so the next conditional write always carries the etag
 *      that actually matches the content the server last accepted.
 *
 *   3. TRAILING-WRITE LOOP. If the buffer changed while a write was in flight,
 *      the loop immediately writes again with the fresh base — no debounce race,
 *      no lost trailing keystroke.
 *
 * On a genuine conflict (server moved under us) the reconcile pipeline tries, in
 * order: adopt-identical → remote-wins (local untouched) → 3-way clean merge →
 * surface to the UI. A progress-based circuit breaker (not a cross-flush streak
 * counter) escalates to manual resolution only when the server keeps rejecting
 * writes without its etag moving — i.e. a real external writer or a systemic
 * fault, never a self-conflict.
 *
 * Pure: no host imports. IO is injected (see `DocSyncIO`), mirroring the
 * AITransport DI pattern. Timers use the ambient setTimeout/clearTimeout so
 * vitest fake timers drive the tests deterministically.
 */

import { threeWayMergeLines } from './merge'

/**
 * Injected IO. All failures are expressed as return values — implementations
 * MUST NOT throw. Error classification (offline vs conflict vs other) is the
 * platform's job, keeping the engine pure and avoiding cross-package
 * instanceof checks.
 */
export interface DocSyncIO {
  /** Read the server's current version of this document. */
  read(): Promise<
    | { type: 'ok'; content: string; etag: string }
    | { type: 'missing' }
    | { type: 'offline' }
    | { type: 'error'; error: unknown }
  >
  /**
   * Conditional write. `baseEtag === null` means "create" (no precondition);
   * a non-null etag means "overwrite only if the server still holds this etag".
   * `conflict` = the precondition failed (server moved).
   */
  write(
    content: string,
    baseEtag: string | null,
  ): Promise<
    | { type: 'ok'; etag: string }
    | { type: 'conflict' }
    | { type: 'offline' }
    | { type: 'error'; error: unknown }
  >
}

export type DocSyncStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'offline' | 'error'

/** Emitted to the UI when auto-reconcile can't resolve a divergence. */
export interface DocConflict {
  /** Last agreed version (common ancestor); null → UI uses twoWayMergeLines. */
  baseContent: string | null
  /** The latest edit buffer (not the flushed snapshot). */
  localContent: string
  /** The server's current content. */
  remoteContent: string
  /** The server's current etag — pass back to `resolveConflict`. */
  remoteEtag: string
}

export interface DocSyncEngineOptions {
  io: DocSyncIO
  /** Debounce before an idle-triggered flush. Default 1500ms. */
  debounceMs?: number
  /**
   * When there is no base (create path), gate whether this content may be sent.
   * Web passes `(c) => c.trim() !== ''` to suppress the empty initial write of a
   * freshly-created Untitled doc. Default: always allow.
   */
  shouldCreate?: (content: string) => boolean
  onStatusChange?: (status: DocSyncStatus) => void
  onSaved?: (etag: string, content: string) => void
  /** Auto-merge landed: the editor MUST replace its content with `merged`. */
  onAutoMerged?: (merged: string) => void
  onConflict?: (conflict: DocConflict) => void
  /** Write hit offline; consumer should enqueue `content` for later replay. */
  onOffline?: (content: string) => void
  onError?: (error: unknown) => void
}

/** Hard ceiling on reconcile rounds within one flush, to prevent a livelock. */
const MAX_RECONCILE_ROUNDS = 4

export class DocSyncEngine {
  private readonly io: DocSyncIO
  private readonly debounceMs: number
  private readonly shouldCreate: (content: string) => boolean
  private readonly opts: DocSyncEngineOptions

  /**
   * Base is advanced atomically (etag + content together), only on write ok.
   * `content: null` means "we hold a base etag to write against, but no known
   * ancestor text to merge with" (the post-`resolveConflict` state); distinct
   * from `base === null` which means "no base at all → create path".
   */
  private base: { etag: string; content: string | null } | null = null
  /** Latest content handed in via queue()/flushNow(); the write target. */
  private buffer = ''
  /** Non-null while a flush loop is running → single-flight guard. */
  private flight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private _status: DocSyncStatus = 'idle'
  private disposed = false

  constructor(opts: DocSyncEngineOptions) {
    this.opts = opts
    this.io = opts.io
    this.debounceMs = opts.debounceMs ?? 1500
    this.shouldCreate = opts.shouldCreate ?? (() => true)
  }

  get status(): DocSyncStatus {
    return this._status
  }

  /** Load an already-persisted document as the initial base. Call once. */
  seed(content: string, etag: string): void {
    this.base = { etag, content }
    this.buffer = content
  }

  /** Debounced entry point — resets the timer on every keystroke. */
  queue(content: string): void {
    if (this.disposed) return
    this.buffer = content
    this.clearTimer()
    this.timer = setTimeout(() => {
      void this.flushNow()
    }, this.debounceMs)
  }

  /**
   * Flush immediately (e.g. Cmd+S): clears the debounce timer and runs — or, if
   * a write is already in flight, joins it. Returns the promise that settles
   * when the current flush cycle completes.
   */
  flushNow(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.clearTimer()
    if (this.flight) return this.flight
    this.flight = this.runFlushLoop().finally(() => {
      this.flight = null
    })
    return this.flight
  }

  /**
   * Resolve a surfaced conflict with `content`, using `remoteEtag` as the new
   * base. Runs through the normal single-flight path — no overlap with any
   * lingering write.
   */
  resolveConflict(content: string, remoteEtag: string): Promise<void> {
    if (this.disposed) return Promise.resolve()
    // Write `content` against the server's current etag. Base content is
    // unknown (the user's choice supersedes any ancestor), so it stays null:
    // the flush loop won't short-circuit and the write carries `remoteEtag`.
    this.base = { etag: remoteEtag, content: null }
    this.buffer = content
    return this.flushNow()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private setStatus(s: DocSyncStatus): void {
    if (this._status === s) return
    this._status = s
    this.opts.onStatusChange?.(s)
  }

  private async runFlushLoop(): Promise<void> {
    // Reconcile progress guard for THIS flush cycle.
    let lastConflictEtag: string | null = null
    let reconcileRounds = 0

    // Loop absorbs "buffer changed while writing" (trailing writes) and
    // "conflict auto-reconciled, re-submit" without ever overlapping writes.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.disposed) return

      const snapshot = this.buffer

      // Nothing to do: buffer already equals the last accepted content.
      if (this.base !== null && snapshot === this.base.content) {
        this.setStatus('saved')
        return
      }
      // Create path gated by the empty-doc guard.
      if (this.base === null && !this.shouldCreate(snapshot)) {
        this.setStatus('idle')
        return
      }

      this.setStatus('saving')
      const res = await this.io.write(snapshot, this.base?.etag ?? null)
      if (this.disposed) return

      if (res.type === 'ok') {
        this.base = { etag: res.etag, content: snapshot } // atomic advance
        this.opts.onSaved?.(res.etag, snapshot)
        if (this.buffer !== snapshot) continue // trailing write
        this.setStatus('saved')
        return
      }

      if (res.type === 'offline') {
        this.opts.onOffline?.(this.buffer)
        this.setStatus('offline')
        return
      }

      if (res.type === 'error') {
        this.opts.onError?.(res.error)
        this.setStatus('error')
        return
      }

      // res.type === 'conflict' → reconcile.
      if (++reconcileRounds > MAX_RECONCILE_ROUNDS) {
        return this.surfaceConflictFromServer(lastConflictEtag)
      }
      const outcome = await this.reconcile(lastConflictEtag)
      if (this.disposed) return
      if (outcome.type === 'resubmit') {
        lastConflictEtag = outcome.remoteEtag
        continue // loop re-writes with the freshly-advanced base
      }
      if (outcome.type === 'settled') {
        this.setStatus('saved')
        return
      }
      // outcome.type === 'stop' — offline/error/surfaced-conflict already handled.
      return
    }
  }

  /**
   * One reconcile round. Reads the server, then:
   *   ① identical content, stale base only → adopt server etag, settle
   *   ② local untouched since base → remote wins (onAutoMerged)
   *   ③ both changed + base present + clean 3-way → auto-merge, resubmit
   *   ④ true conflict / no base / no progress → surface to UI, stop
   */
  private async reconcile(
    lastConflictEtag: string | null,
  ): Promise<
    | { type: 'resubmit'; remoteEtag: string }
    | { type: 'settled' }
    | { type: 'stop' }
  > {
    const remote = await this.io.read()
    if (this.disposed) return { type: 'stop' }

    if (remote.type === 'missing') {
      // Server deleted the doc → drop base, next loop takes the create path.
      this.base = null
      return { type: 'resubmit', remoteEtag: '' }
    }
    if (remote.type === 'offline') {
      this.opts.onOffline?.(this.buffer)
      this.setStatus('offline')
      return { type: 'stop' }
    }
    if (remote.type === 'error') {
      this.opts.onError?.(remote.error)
      this.setStatus('error')
      return { type: 'stop' }
    }

    // Progress guard: same server etag as the previous rejected round means the
    // server hasn't moved yet we still can't write → escalate (systemic fault
    // or a real concurrent writer holding a version we can't reconcile against).
    if (lastConflictEtag !== null && remote.etag === lastConflictEtag) {
      this.surfaceConflict(remote.content, remote.etag)
      return { type: 'stop' }
    }

    // ① Identical content — only the base etag was stale.
    if (remote.content === this.buffer) {
      this.base = { etag: remote.etag, content: remote.content }
      return { type: 'settled' }
    }

    // ② Local untouched since the last agreed base → take the remote wholesale.
    if (this.base !== null && this.buffer === this.base.content) {
      this.base = { etag: remote.etag, content: remote.content }
      this.buffer = remote.content
      this.opts.onAutoMerged?.(remote.content)
      return { type: 'settled' }
    }

    // ③ Both moved and we have a real base → attempt a clean 3-way merge.
    if (this.base !== null && this.base.content !== null) {
      const merged = threeWayMergeLines(this.buffer, this.base.content, remote.content)
      if (!merged.hasConflict && merged.mergedText !== null) {
        this.buffer = merged.mergedText
        this.opts.onAutoMerged?.(merged.mergedText)
        // Rebase onto the remote so the resubmit's conditional write matches.
        this.base = { etag: remote.etag, content: remote.content }
        return { type: 'resubmit', remoteEtag: remote.etag }
      }
    }

    // ④ Genuine same-region conflict, or no usable base → hand to the UI.
    this.surfaceConflict(remote.content, remote.etag)
    return { type: 'stop' }
  }

  private surfaceConflict(remoteContent: string, remoteEtag: string): void {
    this.setStatus('conflict')
    this.opts.onConflict?.({
      baseContent: this.base?.content ?? null,
      localContent: this.buffer,
      remoteContent,
      remoteEtag,
    })
  }

  /** Circuit-breaker path: re-read once to hand the UI the freshest remote. */
  private async surfaceConflictFromServer(_lastConflictEtag: string | null): Promise<void> {
    const remote = await this.io.read()
    if (this.disposed) return
    if (remote.type === 'ok') {
      this.surfaceConflict(remote.content, remote.etag)
    } else if (remote.type === 'offline') {
      this.opts.onOffline?.(this.buffer)
      this.setStatus('offline')
    } else if (remote.type === 'error') {
      this.opts.onError?.(remote.error)
      this.setStatus('error')
    } else {
      // missing — nothing to conflict against; leave status as-is.
      this.setStatus('error')
    }
  }
}
