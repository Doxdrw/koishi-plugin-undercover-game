export type MessageDeliveryFailureHandler = (label: string, error: unknown) => void
export type MessageDeliveryOutcome = { status: 'confirmed'; value: unknown } | { status: 'unknown'; error: unknown }
const emptyReceipt = (value: unknown) => Array.isArray(value)
  && !value.some(id => typeof id === 'string' ? !!id.trim() : typeof id === 'number' && Number.isFinite(id))

export class GameMessageDelivery {
  constructor(private readonly onFailure: MessageDeliveryFailureHandler) {}

  async outcome(label: string, send: () => Promise<unknown>): Promise<MessageDeliveryOutcome> {
    try {
      const value = await send()
      if (emptyReceipt(value)) throw new Error('No API message receipt')
      return { status: 'confirmed', value }
    }
    catch (error) {
      this.onFailure(label, error)
      return { status: 'unknown', error }
    }
  }

  async state(label: string, send: () => Promise<unknown>): Promise<boolean> {
    return (await this.outcome(label, send)).status === 'confirmed'
  }

  bestEffort(label: string, send: () => Promise<unknown>): void {
    void this.state(label, send)
  }

  async required<T>(label: string, send: () => Promise<T>): Promise<T> {
    try {
      const value = await send()
      if (emptyReceipt(value)) throw new Error('No API message receipt')
      return value
    }
    catch (error) {
      this.onFailure(label, error)
      throw error
    }
  }
}
