export class AsyncSerialQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
