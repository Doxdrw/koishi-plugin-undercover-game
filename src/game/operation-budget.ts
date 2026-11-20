export class OperationDeadlineError extends Error {
  constructor() { super('Operation did not complete within its wait budget') }
}

/** Bounds the caller's wait, not the underlying I/O or its side effects. */
export async function withinBudget<T>(work: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new OperationDeadlineError()), milliseconds)
    })])
  } finally {
    clearTimeout(timer)
  }
}
