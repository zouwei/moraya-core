/**
 * Minimal pub/sub primitive compatible with Svelte's `Readable<T>` contract
 * (`{ subscribe(run) => unsub }`) — without importing svelte/store.
 *
 * Why a custom primitive: this package must stay framework-agnostic so it
 * can be lifted to a standalone `@moraya/i18n` package later without
 * dragging a svelte peer-dep along. Consumers that DO use Svelte can pass
 * the returned store straight into `derived()` from `svelte/store` because
 * the subscribe signature matches.
 */

export type Subscriber<T> = (value: T) => void
export type Unsubscriber = () => void

export interface Readable<T> {
  subscribe(run: Subscriber<T>): Unsubscriber
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void
  /** Like `set` but only fires subscribers when the value actually changed. */
  setIfChanged(value: T): void
  /** Sync snapshot — escape hatch for code paths that can't subscribe. */
  get(): T
}

export function createWritable<T>(initial: T): Writable<T> {
  let value = initial
  const subs = new Set<Subscriber<T>>()
  return {
    subscribe(run) {
      run(value)
      subs.add(run)
      return () => { subs.delete(run) }
    },
    set(v) {
      value = v
      for (const fn of subs) fn(value)
    },
    setIfChanged(v) {
      if (Object.is(value, v)) return
      value = v
      for (const fn of subs) fn(value)
    },
    get() { return value },
  }
}

/** Read-only view of a writable; hides `set` from public exports. */
export function asReadable<T>(w: Writable<T>): Readable<T> {
  return { subscribe: w.subscribe.bind(w) }
}
