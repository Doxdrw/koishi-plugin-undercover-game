import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat } from "../game/hero-state"

const metadata = HEROES[HERO.HUANG_TAI_JI]

export type HuangTaiJiQuanMode =
  | "choose-tied-leader"
  | "reduce-to-runner-up"
  | "reduce-below-runner-up"

export interface HuangTaiJiQuanPromptInput {
  readonly heroActive: boolean
  readonly quan: number
  readonly requiredInfluence: number
  readonly leaderCount: number
  readonly runnerUp: number
  readonly overtime: boolean
  readonly playerCount: number
}

export type HuangTaiJiQuanChoice =
  | { kind: "abandon" }
  | { kind: "apply"; targetSeat: Seat; cost: number; reduction: number }
  | { kind: "invalid-leader" }
  | { kind: "invalid-option"; maximumOption: 2 | 3 }

interface HuangTaiJiModule extends HeroModule {
  trackedVoteTarget(state: HeroStateStore): Seat | null
  recordVoteTarget(state: HeroStateStore, target: Seat | null): void
  replaceTrackedVoteTarget(state: HeroStateStore, target: Seat): void
  consumePredictionReward(
    state: HeroStateStore,
    input: { activeSeats: readonly Seat[]; heroActive: boolean },
  ): Seat | null
  chooseQuanMode(input: HuangTaiJiQuanPromptInput): HuangTaiJiQuanMode | null
  classifyQuanChoice(input: {
    content: string
    mode: HuangTaiJiQuanMode
    leaderSeats: readonly Seat[]
    requiredInfluence: number
  }): HuangTaiJiQuanChoice
}

export const huangTaiJiModule = {
  id: HERO.HUANG_TAI_JI,
  key: "huang-tai-ji",
  ...metadata,
  windows: [HeroWindow.RoundStart, HeroWindow.VoteBallot, HeroWindow.VoteResolution],
  initializeState(state) {
    state.huangTaiJi.trackedVoteTarget = null
  },
  trackedVoteTarget(state) {
    return state.huangTaiJi.trackedVoteTarget
  },
  recordVoteTarget(state, target) {
    state.huangTaiJi.trackedVoteTarget = target
  },
  replaceTrackedVoteTarget(state, target) {
    state.huangTaiJi.trackedVoteTarget = target || null
  },
  consumePredictionReward(state, input) {
    const target = state.huangTaiJi.trackedVoteTarget
    state.huangTaiJi.trackedVoteTarget = null
    if (target === null || input.activeSeats.includes(target) || !input.heroActive) return null
    return target
  },
  chooseQuanMode(input) {
    const eligibleLeaders = input.leaderCount === 1
      || (input.overtime && input.leaderCount === 2)
      || (!input.overtime && input.leaderCount - 1 <= input.playerCount / 2)
    if (!input.heroActive
      || input.quan === 0
      || input.quan < input.requiredInfluence
      || !eligibleLeaders) return null
    if (input.leaderCount > 1) return "choose-tied-leader"
    if (input.quan === input.requiredInfluence || input.runnerUp === 0) {
      return "reduce-to-runner-up"
    }
    if (input.quan > input.requiredInfluence) return "reduce-below-runner-up"
    return null
  },
  classifyQuanChoice(input) {
    const normalized = input.content.replace(/\s/g, "")
    if (normalized === "弃" || normalized === "弃权") return { kind: "abandon" }
    const choice = Number(normalized)
    if (input.mode === "choose-tied-leader") {
      if (!input.leaderSeats.includes(choice)) return { kind: "invalid-leader" }
      return { kind: "apply", targetSeat: choice, cost: 1, reduction: 1 }
    }
    const targetSeat = input.leaderSeats[0]
    if (input.mode === "reduce-to-runner-up") {
      if (choice === 1) {
        return {
          kind: "apply",
          targetSeat,
          cost: input.requiredInfluence,
          reduction: input.requiredInfluence,
        }
      }
      if (choice === 2) return { kind: "abandon" }
      return { kind: "invalid-option", maximumOption: 2 }
    }
    if (choice === 1) {
      return {
        kind: "apply",
        targetSeat,
        cost: input.requiredInfluence,
        reduction: input.requiredInfluence,
      }
    }
    if (choice === 2) {
      return {
        kind: "apply",
        targetSeat,
        cost: input.requiredInfluence + 1,
        reduction: input.requiredInfluence + 1,
      }
    }
    if (choice === 3) return { kind: "abandon" }
    return { kind: "invalid-option", maximumOption: 3 }
  },
} satisfies HuangTaiJiModule
