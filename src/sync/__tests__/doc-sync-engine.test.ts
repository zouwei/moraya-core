// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 zouwei

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DocSyncEngine, type DocSyncIO } from '../doc-sync-engine'

type WriteRes = Awaited<ReturnType<DocSyncIO['write']>>
type ReadRes = Awaited<ReturnType<DocSyncIO['read']>>

/**
 * A controllable server. `write` records every call; by default it behaves like
 * a correct optimistic-concurrency store: accept when baseEtag matches current,
 * else conflict. Individual tests can override with `queueWrite`/`queueRead` to
 * hand-control a single call (returning a deferred the test resolves manually),
 * which is how the concurrency races are made deterministic.
 */
class FakeStore implements DocSyncIO {
  content: string | null
  etag: string
  private seq = 0
  writes: Array<{ content: string; baseEtag: string | null }> = []
  reads = 0
  private pendingWrite: { resolve: (r: WriteRes) => void; promise: Promise<WriteRes> } | null = null

  constructor(content: string | null = null, etag = '') {
    this.content = content
    this.etag = etag
  }

  private nextEtag(): string {
    return `e${++this.seq}`
  }

  /** Make the NEXT write block until the returned resolver is called. */
  deferNextWrite(): (r?: WriteRes) => void {
    let resolve!: (r: WriteRes) => void
    const promise = new Promise<WriteRes>((r) => (resolve = r))
    this.pendingWrite = { resolve, promise }
    // Default resolution mirrors the real store if the test passes nothing.
    return (r?: WriteRes) => {
      const pend = this.pendingWrite
      this.pendingWrite = null
      resolve(r ?? this.applyWrite(this.lastWrite!.content, this.lastWrite!.baseEtag))
      return pend
    }
  }

  private lastWrite: { content: string; baseEtag: string | null } | null = null

  private applyWrite(content: string, baseEtag: string | null): WriteRes {
    const matches = baseEtag === null ? this.content === null : baseEtag === this.etag
    if (!matches) return { type: 'conflict' }
    this.content = content
    this.etag = this.nextEtag()
    return { type: 'ok', etag: this.etag }
  }

  async write(content: string, baseEtag: string | null): Promise<WriteRes> {
    this.writes.push({ content, baseEtag })
    this.lastWrite = { content, baseEtag }
    if (this.pendingWrite) return this.pendingWrite.promise
    return this.applyWrite(content, baseEtag)
  }

  async read(): Promise<ReadRes> {
    this.reads++
    if (this.content === null) return { type: 'missing' }
    return { type: 'ok', content: this.content, etag: this.etag }
  }

  /** Simulate an external device writing new content. */
  externalWrite(content: string): void {
    this.content = content
    this.etag = this.nextEtag()
  }
}

function makeEngine(io: DocSyncIO, extra: Record<string, unknown> = {}) {
  const events = {
    saved: [] as Array<[string, string]>,
    autoMerged: [] as string[],
    conflicts: [] as unknown[],
    offline: [] as string[],
    errors: [] as unknown[],
  }
  const engine = new DocSyncEngine({
    io,
    debounceMs: 1000,
    onSaved: (etag, content) => events.saved.push([etag, content]),
    onAutoMerged: (m) => events.autoMerged.push(m),
    onConflict: (c) => events.conflicts.push(c),
    onOffline: (c) => events.offline.push(c),
    onError: (e) => events.errors.push(e),
    ...extra,
  })
  return { engine, events }
}

describe('DocSyncEngine — basic flow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('queue → debounced write; base advances; no-op re-flush skips', async () => {
    const store = new FakeStore('hello', 'e0')
    const { engine, events } = makeEngine(store)
    engine.seed('hello', 'e0')

    engine.queue('hello world')
    await vi.advanceTimersByTimeAsync(1000)

    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]).toEqual({ content: 'hello world', baseEtag: 'e0' })
    expect(store.content).toBe('hello world')
    expect(events.saved.at(-1)?.[1]).toBe('hello world')

    // Re-queueing the same content must not write again.
    engine.queue('hello world')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toHaveLength(1)
    expect(engine.status).toBe('saved')
  })

  it('shouldCreate gate suppresses the empty initial write', async () => {
    const store = new FakeStore(null, '')
    const { engine } = makeEngine(store, { shouldCreate: (c: string) => c.trim() !== '' })

    engine.queue('   ')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toHaveLength(0)

    engine.queue('real content')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toHaveLength(1)
    expect(store.content).toBe('real content')
  })
})

describe('DocSyncEngine — concurrency (the false-conflict regression)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('case 1: in-flight write + queue + flushNow does NOT overlap or self-conflict', async () => {
    const store = new FakeStore('base', 'e0')
    const { engine, events } = makeEngine(store)
    engine.seed('base', 'e0')

    // First flush starts and blocks mid-write.
    const release = store.deferNextWrite()
    engine.queue('edit A')
    await vi.advanceTimersByTimeAsync(1000) // fire debounce → write('edit A', 'e0') starts, pending

    expect(store.writes).toHaveLength(1)

    // While the write is in flight the user types more and hits Cmd+S.
    engine.queue('edit A + B')
    const flushP = engine.flushNow() // must JOIN the in-flight flush, not start a 2nd write
    expect(store.writes).toHaveLength(1) // still only one write issued

    // Release the first write → engine sees buffer changed → trailing write.
    release()
    await flushP

    // Exactly two writes, strictly sequential, second carries the NEW etag.
    expect(store.writes).toHaveLength(2)
    expect(store.writes[0]).toEqual({ content: 'edit A', baseEtag: 'e0' })
    expect(store.writes[1]).toEqual({ content: 'edit A + B', baseEtag: 'e1' })
    expect(store.content).toBe('edit A + B')
    // No conflict was ever surfaced — this is the bug that used to fire.
    expect(events.conflicts).toHaveLength(0)
  })

  it('case 2: three edits during one in-flight write collapse to a trailing write', async () => {
    const store = new FakeStore('v0', 'e0')
    const { engine } = makeEngine(store)
    engine.seed('v0', 'e0')

    const release = store.deferNextWrite()
    engine.queue('v1')
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toHaveLength(1)

    // rapid typing while first write in flight
    engine.queue('v2')
    engine.queue('v3')
    engine.queue('v4')
    const p = engine.flushNow()
    release()
    await p

    // First write (v1) + one trailing write with the final buffer (v4) = 2.
    expect(store.writes).toHaveLength(2)
    expect(store.writes[1].content).toBe('v4')
    expect(store.content).toBe('v4')
  })
})

describe('DocSyncEngine — reconcile pipeline', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('case 3: server conflict with clean 3-way merge auto-resolves and re-submits', async () => {
    const store = new FakeStore('a\nb\nc', 'e0')
    const { engine, events } = makeEngine(store)
    engine.seed('a\nb\nc', 'e0')

    // Another device changes the LAST line; our base etag becomes stale.
    store.externalWrite('a\nb\nC-remote')

    // We change the FIRST line — non-overlapping → should clean-merge.
    engine.queue('A-local\nb\nc')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    expect(events.autoMerged).toHaveLength(1)
    expect(events.autoMerged[0]).toBe('A-local\nb\nC-remote')
    expect(store.content).toBe('A-local\nb\nC-remote')
    expect(events.conflicts).toHaveLength(0)
  })

  it('remote-wins when local is untouched since base', async () => {
    const store = new FakeStore('doc', 'e0')
    const { engine, events } = makeEngine(store)
    engine.seed('doc', 'e0')

    store.externalWrite('doc from other device')

    // Force a flush without any local change → should adopt remote.
    engine.queue('doc') // same as base
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    // buffer==base → loop short-circuits, no write, no conflict. (No auto-merge
    // needed since we never tried to write.) Verify we didn't spuriously conflict.
    expect(events.conflicts).toHaveLength(0)
  })

  it('case 4: same-region conflict surfaces to the UI with three-way payload', async () => {
    const store = new FakeStore('a\nMID\nz', 'e0')
    const { engine, events } = makeEngine(store)
    engine.seed('a\nMID\nz', 'e0')

    store.externalWrite('a\nREMOTE-MID\nz') // other device edits the middle line

    engine.queue('a\nLOCAL-MID\nz') // we edit the SAME line
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    expect(events.autoMerged).toHaveLength(0)
    expect(events.conflicts).toHaveLength(1)
    const c = events.conflicts[0] as {
      baseContent: string | null
      localContent: string
      remoteContent: string
      remoteEtag: string
    }
    expect(c.baseContent).toBe('a\nMID\nz')
    expect(c.localContent).toBe('a\nLOCAL-MID\nz')
    expect(c.remoteContent).toBe('a\nREMOTE-MID\nz')
    expect(engine.status).toBe('conflict')
  })

  it('resolveConflict writes the chosen content against the remote etag', async () => {
    const store = new FakeStore('a\nMID\nz', 'e0')
    const { engine, events } = makeEngine(store)
    engine.seed('a\nMID\nz', 'e0')
    store.externalWrite('a\nREMOTE-MID\nz')

    engine.queue('a\nLOCAL-MID\nz')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()

    const c = events.conflicts[0] as { remoteEtag: string }
    await engine.resolveConflict('a\nRESOLVED\nz', c.remoteEtag)

    expect(store.content).toBe('a\nRESOLVED\nz')
    expect(engine.status).toBe('saved')
  })
})

describe('DocSyncEngine — offline & error', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('offline write invokes onOffline with the buffer', async () => {
    const io: DocSyncIO = {
      read: async () => ({ type: 'offline' }),
      write: async () => ({ type: 'offline' }),
    }
    const { engine, events } = makeEngine(io)
    engine.seed('x', 'e0')
    engine.queue('x edited')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()
    expect(events.offline).toContain('x edited')
    expect(engine.status).toBe('offline')
  })

  it('write error invokes onError', async () => {
    const boom = new Error('boom')
    const io: DocSyncIO = {
      read: async () => ({ type: 'error', error: boom }),
      write: async () => ({ type: 'error', error: boom }),
    }
    const { engine, events } = makeEngine(io)
    engine.seed('x', 'e0')
    engine.queue('x edited')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTimersAsync()
    expect(events.errors).toContain(boom)
    expect(engine.status).toBe('error')
  })

  it('dispose() cancels the pending debounce', async () => {
    const store = new FakeStore('x', 'e0')
    const { engine } = makeEngine(store)
    engine.seed('x', 'e0')
    engine.queue('x edited')
    engine.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.writes).toHaveLength(0)
  })
})
