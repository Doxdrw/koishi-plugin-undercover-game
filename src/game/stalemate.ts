import type { HeroStateStore, Seat } from './hero-state'
import { linDanHanModule } from '../heroes/lin-dan-han'

/** Evaluate permanent target restrictions, never the temporary overtime ballot. */
export function isStalemateEligible(
  activeSeats: readonly Seat[], undercoverSeats: readonly Seat[],
  linSeat: Seat, state: HeroStateStore,
): boolean {
  const undercovers = undercoverSeats.filter(seat => activeSeats.includes(seat))
  if (!undercovers.length) return false
  if (activeSeats.length === 2 * undercovers.length) return true
  return activeSeats.length === 2 * undercovers.length + 1
    && activeSeats.includes(linSeat)
    && !undercovers.includes(linSeat)
    && linDanHanModule.isAwakened(state)
    && linDanHanModule.votableTargets(state, undercovers).length === 0
}

/** One final safe night per round; every successful roster mutation resets it. */
export class StalemateTracker {
  private lastRound = -1
  private count = 0

  reset(): void {
    this.lastRound = -1
    this.count = 0
  }

  recordSafeNight(round: number, eligible: boolean): boolean {
    if (round <= this.lastRound) return false
    this.count = eligible ? (round === this.lastRound + 1 ? this.count + 1 : 1) : 0
    this.lastRound = round
    return this.count >= 2
  }
}
