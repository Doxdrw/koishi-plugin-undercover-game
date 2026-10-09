import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat } from "../game/hero-state"

const metadata = HEROES[HERO.LIN_DAN_HAN]

export interface LinDanHanRoundReport {
  readonly attackedSeats: Seat[]
  readonly unattackedSeats: Seat[]
}

export interface LinDanHanVoteAwakeningInput {
  readonly heroActive: boolean
  readonly heroPoll: number
  readonly preventedVotePower: number
  readonly maximumPoll: number
  readonly unvote: number
  readonly shielded: boolean
}

export interface LinDanHanRebuiltBallotState {
  readonly realityRecords: readonly Seat[]
  readonly ownVoteInvalidated: boolean
  readonly preventedVotePower: number
}

interface LinDanHanModule extends HeroModule {
  initializeRealityRecords(state: HeroStateStore, seats: readonly Seat[], heroSeat: Seat): void
  isAwakened(state: HeroStateStore): boolean
  awaken(state: HeroStateStore): boolean
  beginVoteWindow(state: HeroStateStore): void
  realityRecords(state: HeroStateStore): readonly Seat[]
  replaceBallotState(state: HeroStateStore, rebuilt: LinDanHanRebuiltBallotState): void
  calculatePreventedVotePower(state: HeroStateStore, votePower: readonly number[]): number
  hasPendingVoteAttack(state: HeroStateStore, attackerSeat: Seat): boolean
  markVoteAttack(state: HeroStateStore, attackerSeat: Seat): boolean
  undoVoteAttack(state: HeroStateStore, attackerSeat: Seat): boolean
  consumeVoteAttack(state: HeroStateStore, attackerSeat: Seat): boolean
  isOwnVoteInvalidated(state: HeroStateStore): boolean
  invalidateOwnVote(state: HeroStateStore): boolean
  restoreOwnVote(state: HeroStateStore): boolean
  roundReport(
    state: HeroStateStore,
    activeSeats: readonly Seat[],
    heroSeat: Seat,
  ): LinDanHanRoundReport
  votableTargets(state: HeroStateStore, candidateSeats: readonly Seat[]): Seat[]
  promptTargets(state: HeroStateStore, candidateSeats: readonly Seat[]): Seat[]
  protectFromSkill(state: HeroStateStore, attackerSeat: Seat): {
    protected: boolean
    awakenedNow: boolean
  }
  shouldAwakenFromVote(
    state: HeroStateStore,
    input: LinDanHanVoteAwakeningInput,
  ): boolean
}

export const linDanHanModule = {
  id: HERO.LIN_DAN_HAN,
  key: "lin-dan-han",
  ...metadata,
  windows: [
    HeroWindow.RoundStart,
    HeroWindow.SpeechAction,
    HeroWindow.VoteBallot,
    HeroWindow.VoteResolution,
    HeroWindow.Elimination,
  ],
  initializeState(state) {
    state.linDanHan.ownVoteInvalidated = false
    state.linDanHan.awakened = false
    state.linDanHan.realityRecords = []
    state.linDanHan.preventedVotePower = 0
  },
  initializeRealityRecords(state, seats, heroSeat) {
    state.linDanHan.realityRecords = seats.filter(seat => seat !== heroSeat)
  },
  isAwakened(state) {
    return state.linDanHan.awakened
  },
  awaken(state) {
    if (state.linDanHan.awakened) return false
    state.linDanHan.awakened = true
    return true
  },
  beginVoteWindow(state) {
    state.linDanHan.ownVoteInvalidated = false
    state.linDanHan.preventedVotePower = 0
  },
  realityRecords(state) {
    return state.linDanHan.realityRecords
  },
  replaceBallotState(state, rebuilt) {
    state.linDanHan.realityRecords = [...rebuilt.realityRecords]
    state.linDanHan.ownVoteInvalidated = rebuilt.ownVoteInvalidated
    state.linDanHan.preventedVotePower = rebuilt.preventedVotePower
  },
  calculatePreventedVotePower(state, votePower) {
    const prevented = state.linDanHan.realityRecords.reduce((total, record) =>
      record < 0 ? total + (votePower[-record - 1] ?? 0) : total, 0)
    state.linDanHan.preventedVotePower = prevented
    return prevented
  },
  hasPendingVoteAttack(state, attackerSeat) {
    return state.linDanHan.realityRecords.includes(-attackerSeat)
  },
  markVoteAttack(state, attackerSeat) {
    const index = state.linDanHan.realityRecords.indexOf(attackerSeat)
    if (index === -1) return false
    state.linDanHan.realityRecords[index] = -attackerSeat
    return true
  },
  undoVoteAttack(state, attackerSeat) {
    const index = state.linDanHan.realityRecords.indexOf(-attackerSeat)
    if (index === -1) return false
    state.linDanHan.realityRecords[index] = attackerSeat
    return true
  },
  consumeVoteAttack(state, attackerSeat) {
    const index = state.linDanHan.realityRecords.indexOf(-attackerSeat)
    if (index === -1) return false
    state.linDanHan.realityRecords.splice(index, 1)
    return true
  },
  isOwnVoteInvalidated(state) {
    return state.linDanHan.ownVoteInvalidated
  },
  invalidateOwnVote(state) {
    if (state.linDanHan.ownVoteInvalidated) return false
    state.linDanHan.ownVoteInvalidated = true
    return true
  },
  restoreOwnVote(state) {
    if (!state.linDanHan.ownVoteInvalidated) return false
    state.linDanHan.ownVoteInvalidated = false
    return true
  },
  roundReport(state, activeSeats, heroSeat) {
    const unattackedSeats = activeSeats.filter(seat =>
      seat !== heroSeat && state.linDanHan.realityRecords.includes(seat),
    )
    const attackedSeats = activeSeats.filter(seat =>
      seat !== heroSeat && !state.linDanHan.realityRecords.includes(seat),
    )
    return { attackedSeats, unattackedSeats }
  },
  votableTargets(state, candidateSeats) {
    if (!state.linDanHan.awakened) return [...candidateSeats]
    const recordedSeats = new Set(state.linDanHan.realityRecords.map(seat => Math.abs(seat)))
    return candidateSeats.filter(seat => recordedSeats.has(seat))
  },
  promptTargets(state, candidateSeats) {
    if (!state.linDanHan.awakened) return [...candidateSeats]
    return candidateSeats.filter(seat => state.linDanHan.realityRecords.includes(seat))
  },
  protectFromSkill(state, attackerSeat) {
    const index = state.linDanHan.realityRecords.indexOf(attackerSeat)
    if (index === -1) return { protected: false, awakenedNow: false }
    state.linDanHan.realityRecords.splice(index, 1)
    const awakenedNow = !state.linDanHan.awakened
    state.linDanHan.awakened = true
    return { protected: true, awakenedNow }
  },
  shouldAwakenFromVote(state, input) {
    return input.heroActive
      && !state.linDanHan.awakened
      && input.preventedVotePower + input.heroPoll > input.maximumPoll + input.unvote
      && input.heroPoll <= input.maximumPoll
      && !input.shielded
  },
} satisfies LinDanHanModule
