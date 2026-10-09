import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat } from "../game/hero-state"
import {
  decideMaoWenLongLateVote,
  type MaoWenLongLateVoteDecision,
  type MaoWenLongLateVoteInput,
} from "../game/vote-leaders"

const metadata = HEROES[HERO.MAO_WEN_LONG]

export type MaoWenLongTargetInput =
  | { kind: "abandon" }
  | { kind: "target"; seat: Seat }
  | { kind: "invalid-target"; chosenSeat: number }

export interface MaoWenLongTargetInputContext {
  readonly content: string
  readonly activeSeats: readonly Seat[]
  readonly overtime: boolean
  readonly overtimeCandidateSeats: readonly Seat[]
}

interface MaoWenLongModule extends HeroModule {
  isLateVotePending(state: HeroStateStore): boolean
  beginLateVote(state: HeroStateStore): void
  finishLateVote(state: HeroStateStore): void
  decideLateVote(input: MaoWenLongLateVoteInput): MaoWenLongLateVoteDecision
  classifyTargetInput(input: MaoWenLongTargetInputContext): MaoWenLongTargetInput
}

export const maoWenLongModule = {
  id: HERO.MAO_WEN_LONG,
  key: "mao-wen-long",
  ...metadata,
  windows: [HeroWindow.VoteBallot, HeroWindow.VoteResolution],
  initializeState(state) {
    state.maoWenLong.lateVotePending = false
  },
  isLateVotePending(state) {
    return state.maoWenLong.lateVotePending
  },
  beginLateVote(state) {
    state.maoWenLong.lateVotePending = true
  },
  finishLateVote(state) {
    state.maoWenLong.lateVotePending = false
  },
  decideLateVote(input) {
    return decideMaoWenLongLateVote(input)
  },
  classifyTargetInput(input) {
    const normalized = input.content.replace(/\s/g, "")
    if (normalized === "弃" || normalized === "弃权") return { kind: "abandon" }
    const chosenSeat = Number(normalized)
    if (!input.activeSeats.includes(chosenSeat)) return { kind: "invalid-target", chosenSeat }
    if (input.overtime && !input.overtimeCandidateSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat }
    }
    return { kind: "target", seat: chosenSeat }
  },
} satisfies MaoWenLongModule
