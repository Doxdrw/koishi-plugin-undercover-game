export type SpeechPhaseKind = "regular" | "overtime"

export interface SpeechPhaseContext {
  readonly revision: number
  readonly gameEpoch: number
  readonly round: number
  readonly kind: SpeechPhaseKind
  readonly eligibleSeats: readonly number[]
}

export class SpeechPhaseCoordinator {
  private revision = 0
  private active?: SpeechPhaseContext

  begin(input: Omit<SpeechPhaseContext, "revision">): SpeechPhaseContext {
    this.revision += 1
    this.active = Object.freeze({
      ...input,
      revision: this.revision,
      eligibleSeats: Object.freeze([...input.eligibleSeats]),
    })
    return this.active
  }

  invalidate(): void {
    this.revision += 1
    this.active = undefined
  }

  current(): SpeechPhaseContext | undefined {
    return this.active
  }

  matches(context: SpeechPhaseContext | undefined): boolean {
    return !!context
      && !!this.active
      && context.revision === this.active.revision
      && context.gameEpoch === this.active.gameEpoch
  }
}
