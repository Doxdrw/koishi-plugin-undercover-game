import type { Seat } from "./hero-state"

export type Ballot = Seat | 0 | -1 | undefined

export interface VoteContext {
  readonly gameEpoch: number
  readonly round: number
  readonly overtime: boolean
  readonly activeSeats: readonly Seat[]
  readonly voterSeats: readonly Seat[]
  readonly ballots: readonly Ballot[]
  readonly poll: readonly number[]
  readonly max: number
  readonly runnerUp: number
  readonly leaderSeats: readonly Seat[]
  readonly requiredInfluence: number
}

export type EliminationSource =
  | "vote"
  | "execution"
  | "hero"
  | "timeout"
  | "kick"

export interface EliminationContext {
  readonly gameEpoch: number
  readonly round: number
  readonly source: EliminationSource
  readonly targetSeat: Seat
  readonly activeSeats: readonly Seat[]
  readonly chainDepth: number
  readonly causedByHero?: string
}

export interface RoundContext {
  readonly gameEpoch: number
  readonly round: number
  readonly activeSeats: readonly Seat[]
  readonly eliminatedSeats: readonly Seat[]
}

export function snapshotVoteContext(context: VoteContext): VoteContext {
  return {
    ...context,
    activeSeats: [...context.activeSeats],
    voterSeats: [...context.voterSeats],
    ballots: [...context.ballots],
    poll: [...context.poll],
    leaderSeats: [...context.leaderSeats],
  }
}

export function snapshotEliminationContext(
  context: EliminationContext,
): EliminationContext {
  return {
    ...context,
    activeSeats: [...context.activeSeats],
  }
}

export function snapshotRoundContext(context: RoundContext): RoundContext {
  return {
    ...context,
    activeSeats: [...context.activeSeats],
    eliminatedSeats: [...context.eliminatedSeats],
  }
}
