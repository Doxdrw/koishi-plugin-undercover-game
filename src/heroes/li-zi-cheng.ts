import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore } from "../game/hero-state"

const metadata = HEROES[HERO.LI_ZI_CHENG]

export const LiZiChengBallotOutcome = {
  Effective: "effective",
  Abandoned: "abandoned",
  SkippedOrTimedOut: "skipped-or-timed-out",
  InvalidatedByLinDanHan: "invalidated-by-lin-dan-han",
} as const

export type LiZiChengBallotOutcome =
  typeof LiZiChengBallotOutcome[keyof typeof LiZiChengBallotOutcome]

export interface LiZiChengBallotInput {
  readonly ballot: number | undefined
  readonly invalidatedByLinDanHan: boolean
}

export function classifyLiZiChengBallot(
  input: LiZiChengBallotInput,
): LiZiChengBallotOutcome {
  if (input.invalidatedByLinDanHan) {
    return LiZiChengBallotOutcome.InvalidatedByLinDanHan
  }
  if (input.ballot === 0) return LiZiChengBallotOutcome.Abandoned
  if (input.ballot !== undefined && input.ballot > 0) {
    return LiZiChengBallotOutcome.Effective
  }
  return LiZiChengBallotOutcome.SkippedOrTimedOut
}

interface LiZiChengModule extends HeroModule {
  markRewardPending(state: HeroStateStore): void
  hasRewardPending(state: HeroStateStore): boolean
  consumeRewardPending(state: HeroStateStore): boolean
  recordBallotOutcome(
    state: HeroStateStore,
    input: LiZiChengBallotInput,
  ): LiZiChengBallotOutcome
}

export const liZiChengModule = {
  id: HERO.LI_ZI_CHENG,
  key: "li-zi-cheng",
  ...metadata,
  windows: [
    HeroWindow.VoteBallot,
    HeroWindow.VoteResolution,
  ],
  initializeState(state) {
    state.liZiCheng.faRewardPending = false
  },
  markRewardPending(state) {
    state.liZiCheng.faRewardPending = true
  },
  hasRewardPending(state) {
    return state.liZiCheng.faRewardPending
  },
  consumeRewardPending(state) {
    const pending = state.liZiCheng.faRewardPending
    state.liZiCheng.faRewardPending = false
    return pending
  },
  recordBallotOutcome(state, input) {
    const outcome = classifyLiZiChengBallot(input)
    if (outcome !== LiZiChengBallotOutcome.Effective) {
      state.liZiCheng.faRewardPending = true
    }
    return outcome
  },
} satisfies LiZiChengModule
