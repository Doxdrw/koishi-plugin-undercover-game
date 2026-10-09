export class VoteSettlementCoordinator {
  private active?: { key: string, promise: Promise<void> }

  get key(): string | undefined {
    return this.active?.key
  }

  isRunning(key?: string): boolean {
    return this.active !== undefined && (key === undefined || this.active.key === key)
  }

  run(key: string, task: () => Promise<void>): Promise<void> {
    if (this.active) return this.active.promise

    const promise = Promise.resolve().then(task)
    const entry = { key, promise }
    this.active = entry
    void promise.finally(() => {
      if (this.active === entry) this.active = undefined
    }).catch(() => undefined)
    return promise
  }

  clear(): void {
    this.active = undefined
  }
}
