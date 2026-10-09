import type { Seat } from "./hero-state"

export interface SpeechEligibilityInput {
  readonly seat: Seat
  readonly activeSeats: readonly Seat[]
  readonly overtime: boolean
  readonly overtimeSeats: readonly Seat[]
}

export function isEligibleSpeechSeat(input: SpeechEligibilityInput): boolean {
  if (!input.activeSeats.includes(input.seat)) return false
  return !input.overtime || input.overtimeSeats.includes(input.seat)
}
