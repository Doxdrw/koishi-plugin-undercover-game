import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import { WuSanGuiAuthorityPhase } from "../game/hero-state"
import type { HeroStateStore, Seat } from "../game/hero-state"

const metadata = HEROES[HERO.WU_SAN_GUI]

export interface WuSanGuiRoundResult {
  readonly awakenedNow: boolean
  readonly faReward: number
  readonly attackerSeats: readonly Seat[]
  readonly restrictionAdded: 0 | 1 | 2 | null
}

export type WuSanGuiChoiceInput =
  | { kind: "abandon" }
  | { kind: "target"; seat: Seat }
  | { kind: "invalid-target"; chosenSeat: number }

interface WuSanGuiModule extends HeroModule {
  recordAttacker(state: HeroStateStore, attackerSeat: Seat): boolean
  removeAttacker(state: HeroStateStore, attackerSeat: Seat): void
  attackerSeats(state: HeroStateStore): readonly Seat[]
  advanceAuthorityRound(state: HeroStateStore, heroActive: boolean): boolean
  resolveRoundProgress(state: HeroStateStore, input: {
    heroActive: boolean
    random?: () => number
  }): WuSanGuiRoundResult
  canChooseOvertimeTarget(state: HeroStateStore, input: {
    heroActive: boolean
    heroIsCandidate: boolean
  }): boolean
  beginChoice(state: HeroStateStore): void
  abandonChoice(state: HeroStateStore): void
  classifyChoiceInput(content: string, candidateSeats: readonly Seat[]): WuSanGuiChoiceInput
  completeChoice(state: HeroStateStore): { skipNextVote: boolean }
}

export const wuSanGuiModule = {
  id: HERO.WU_SAN_GUI,
  key: "wu-san-gui",
  ...metadata,
  windows: [HeroWindow.RoundStart, HeroWindow.VoteBallot, HeroWindow.VoteResolution, HeroWindow.Elimination],
  initializeState(state) {
    state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.Idle
    state.wuSanGui.progress = { kind: "tracking", useCount: 0 }
    state.wuSanGui.attackerSeats = []
    state.wuSanGui.restoreVoteNextRound = false
    state.wuSanGui.restrictions = [0, 0, 0]
  },
  recordAttacker(state, attackerSeat) {
    if (state.wuSanGui.attackerSeats.includes(attackerSeat)) return false
    state.wuSanGui.attackerSeats.push(attackerSeat)
    state.wuSanGui.attackerSeats.sort((left, right) => left - right)
    return true
  },
  removeAttacker(state, attackerSeat) {
    state.wuSanGui.attackerSeats = state.wuSanGui.attackerSeats
      .filter(seat => seat !== attackerSeat)
  },
  attackerSeats(state) {
    return state.wuSanGui.attackerSeats
  },
  advanceAuthorityRound(state, heroActive) {
    let restoredVote = false
    if (heroActive && state.wuSanGui.authorityPhase === WuSanGuiAuthorityPhase.UsedPreviousRound) {
      state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.Idle
      if (state.wuSanGui.restoreVoteNextRound) {
        restoredVote = true
        state.wuSanGui.restoreVoteNextRound = false
      }
    }
    else if (heroActive && state.wuSanGui.authorityPhase === WuSanGuiAuthorityPhase.UsedThisRound) {
      state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.UsedPreviousRound
    }
    return restoredVote
  },
  resolveRoundProgress(state, input) {
    const progress = state.wuSanGui.progress
    if (input.heroActive
      && progress.kind === "tracking"
      && progress.useCount > 0
      && state.wuSanGui.attackerSeats.length > progress.useCount) {
      const attackerSeats = [...state.wuSanGui.attackerSeats]
      state.wuSanGui.progress = { kind: "awakened" }
      state.wuSanGui.restrictions = [0, 0, 0]
      return {
        awakenedNow: true,
        faReward: attackerSeats.length,
        attackerSeats,
        restrictionAdded: null,
      }
    }

    if (input.heroActive && progress.kind === "awakened") {
      const restrictions = state.wuSanGui.restrictions
      const available = restrictions
        .map((value, index) => value === 0 ? index : -1)
        .filter(index => index !== -1) as Array<0 | 1 | 2>
      if (available.length > 0) {
        const random = input.random ?? Math.random
        const selected = available[Math.floor(random() * available.length)]
        restrictions[selected] = 1
        state.wuSanGui.restrictions = restrictions
        return {
          awakenedNow: false,
          faReward: 0,
          attackerSeats: [...state.wuSanGui.attackerSeats],
          restrictionAdded: selected,
        }
      }
    }
    return {
      awakenedNow: false,
      faReward: 0,
      attackerSeats: [...state.wuSanGui.attackerSeats],
      restrictionAdded: null,
    }
  },
  canChooseOvertimeTarget(state, input) {
    if (!input.heroActive) return false
    const progress = state.wuSanGui.progress
    if (progress.kind === "tracking") return true
    const [cannotSelfSave, , cannotReuse] = state.wuSanGui.restrictions
    return (state.wuSanGui.authorityPhase === WuSanGuiAuthorityPhase.Idle || cannotReuse === 0)
      && (!input.heroIsCandidate || cannotSelfSave === 0)
  },
  beginChoice(state) {
    state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.AwaitingChoice
  },
  abandonChoice(state) {
    state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.Idle
  },
  classifyChoiceInput(content, candidateSeats) {
    const normalized = content.replace(/\s/g, "")
    if (normalized === "弃" || normalized === "弃权") return { kind: "abandon" }
    const chosenSeat = Number(normalized)
    if (!candidateSeats.includes(chosenSeat)) return { kind: "invalid-target", chosenSeat }
    return { kind: "target", seat: chosenSeat }
  },
  completeChoice(state) {
    const progress = state.wuSanGui.progress
    if (progress.kind === "tracking") {
      state.wuSanGui.progress = { kind: "tracking", useCount: progress.useCount + 1 }
    }
    state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.UsedThisRound
    const skipNextVote = state.wuSanGui.restrictions[1] === 1
    if (skipNextVote) state.wuSanGui.restoreVoteNextRound = true
    return { skipNextVote }
  },
} satisfies WuSanGuiModule
