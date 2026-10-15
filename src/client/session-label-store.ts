/**
 * Client poll of host session-label map.
 */

import { SESSION_LABELS_ROUTE } from '../label.ts'

export type SessionLabelMap = Readonly<Record<string, string>>

/** Content equality for the small label map; skips no-op emits. */
function sameLabels(a: SessionLabelMap, b: SessionLabelMap): boolean {
  const aKeys = Object.keys(a)
  return aKeys.length === Object.keys(b).length && aKeys.every(key => a[key] === b[key])
}

interface Snapshot {
  value: SessionLabelMap
  error: string | null
  version: number
}

/**
 * Poll `/_dsh/model-switch/session-labels` for catalog + header badges.
 */
export class SessionLabelStore {
  private snap: Snapshot = { value: {}, error: null, version: 0 }
  private readonly listeners = new Set<() => void>()
  private timer: number | undefined
  private refs = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): Snapshot => this.snap

  start(intervalMs = 2000): void {
    this.refs += 1
    if (this.refs > 1) return
    void this.refresh()
    this.timer = window.setInterval(() => { void this.refresh() }, intervalMs)
  }

  stop(): void {
    this.refs = Math.max(0, this.refs - 1)
    if (this.refs > 0 || this.timer === undefined) return
    window.clearInterval(this.timer)
    this.timer = undefined
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch(SESSION_LABELS_ROUTE, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as { ok?: boolean; value?: SessionLabelMap }
      if (body.ok !== true || body.value === undefined) {
        throw new Error('bad session-labels payload')
      }
      // Unchanged maps are common between polls; keep the old snapshot so
      // useSyncExternalStore subscribers are not re-rendered for nothing.
      if (this.snap.error === null && sameLabels(this.snap.value, body.value)) return
      this.snap = { value: body.value, error: null, version: this.snap.version + 1 }
      this.emit()
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause.message : String(cause)
      if (this.snap.error === error) return
      this.snap = { value: this.snap.value, error, version: this.snap.version + 1 }
      this.emit()
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
