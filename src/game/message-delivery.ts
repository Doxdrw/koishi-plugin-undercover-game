export type MessageDeliveryFailureHandler = (label: string, error: unknown) => void

export class GameMessageDelivery {
  constructor(private readonly onFailure: MessageDeliveryFailureHandler) {}

  async state(label: string, send: () => Promise<unknown>): Promise<boolean> {
    try {
      await send()
      return true
    }
    catch (error) {
      this.onFailure(label, error)
      return false
    }
  }

  bestEffort(label: string, send: () => Promise<unknown>): void {
    void this.state(label, send)
  }

  async required<T>(label: string, send: () => Promise<T>): Promise<T> {
    try {
      return await send()
    }
    catch (error) {
      this.onFailure(label, error)
      throw error
    }
  }
}
