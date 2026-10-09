export type GameTimerHandle = ReturnType<typeof setTimeout>

export interface GameTimerManagerOptions {
  readonly isActive: () => boolean
  readonly onError: (error: unknown) => void
  readonly schedule?: (callback: () => void, delay: number) => GameTimerHandle
  readonly cancel?: (handle: GameTimerHandle) => void
}

export class GameTimerManager {
  private readonly handles = new Set<GameTimerHandle>()
  private currentEpoch = 0

  constructor(private readonly options: GameTimerManagerOptions) {}

  get epoch(): number {
    return this.currentEpoch
  }

  advanceEpoch(): number {
    this.cancelAll()
    this.currentEpoch += 1
    return this.currentEpoch
  }

  schedule(callback: () => void | Promise<void>, delay: number): GameTimerHandle {
    const scheduledEpoch = this.currentEpoch
    let handle: GameTimerHandle
    const schedule = this.options.schedule ?? setTimeout
    handle = schedule(() => {
      this.handles.delete(handle)
      if (!this.isCurrent(scheduledEpoch)) return
      Promise.resolve()
        .then(callback)
        .catch(error => {
          if (!this.isCurrent(scheduledEpoch)) return
          this.options.onError(error)
        })
    }, delay) as GameTimerHandle
    this.handles.add(handle)
    return handle
  }

  cancel(handle: GameTimerHandle | null | undefined): void {
    if (handle == null) return
    this.handles.delete(handle)
    const cancel = this.options.cancel ?? clearTimeout
    cancel(handle)
  }

  cancelAll(): void {
    const cancel = this.options.cancel ?? clearTimeout
    for (const handle of this.handles) cancel(handle)
    this.handles.clear()
  }

  private isCurrent(epoch: number): boolean {
    return this.options.isActive() && epoch === this.currentEpoch
  }
}
