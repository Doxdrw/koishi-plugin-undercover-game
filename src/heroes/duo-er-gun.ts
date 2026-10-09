import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type {
  DuoErGunStrategyMark,
  HeroStateStore,
  Seat,
} from "../game/hero-state"
import {
  resolveDuoErGunProtection,
  type DuoErGunProtectionResult,
} from "../game/vote-modifiers"

const metadata = HEROES[HERO.DUO_ER_GUN]

export interface DuoErGunStrategyInput {
  readonly content: string
  readonly activeSeats: readonly Seat[]
  readonly heroSeat: Seat
}

export type DuoErGunStrategyAction =
  | { kind: "ignore" }
  | { kind: "skill-spent" }
  | { kind: "invalid-target"; chosenSeat: number }
  | { kind: "established-target-unchanged"; seat: Seat }
  | { kind: "self-forbidden"; seat: Seat }
  | { kind: "established-target-locked"; seat: Seat }
  | {
    kind: "select"
    seat: Seat
    previousSeat: Seat | null
    replacesNewMark: boolean
  }

export interface DuoErGunProtectionInput {
  readonly activeSeats: readonly Seat[]
  readonly poll: readonly number[]
  readonly heroSeat: Seat
}

export interface DuoErGunRoundStartInput {
  readonly heroActive: boolean
  readonly hasNonVoteElimination: boolean
}

export interface DuoErGunRoundStartResult {
  readonly strategySeat: Seat | null
  readonly strategyEstablished: boolean
  readonly regencyReopened: boolean
  readonly awakened: boolean
}

export interface DuoErGunRegencyInput {
  readonly content: string
  readonly activeSeats: readonly Seat[]
}

export type DuoErGunRegencyAction =
  | { kind: "ignore" }
  | { kind: "skill-spent" }
  | { kind: "not-awakened" }
  | { kind: "new-strategy-not-established"; seat: Seat }
  | { kind: "already-armed"; strategySeat: Seat }
  | { kind: "strategy-missing" }
  | { kind: "same-target"; seat: Seat }
  | { kind: "invalid-target" }
  | { kind: "strategy-not-in-pair"; strategySeat: Seat }
  | { kind: "arm"; discardSeat: Seat; keepSeat: Seat }

export interface DuoErGunRegencySwapInput {
  readonly activeSeats: readonly Seat[]
  readonly poll: readonly number[]
  readonly heroSeat: Seat
  readonly leaderSeat: Seat
  readonly uniqueLeader: boolean
  readonly overtime: boolean
  readonly overtimeCandidateSeats: readonly Seat[]
}

export type DuoErGunRegencySwapResult =
  | { kind: "none" }
  | {
    kind: "swap"
    discardSeat: Seat
    keepSeat: Seat
    encodedVoteDifference: number
  }

interface DuoErGunModule extends HeroModule {
  strategyMark(state: HeroStateStore): DuoErGunStrategyMark
  strategySeat(state: HeroStateStore): Seat | null
  classifyStrategyInput(
    state: HeroStateStore,
    input: DuoErGunStrategyInput,
  ): DuoErGunStrategyAction
  selectStrategy(
    state: HeroStateStore,
    action: Extract<DuoErGunStrategyAction, { kind: "select" }>,
  ): void
  beginRound(
    state: HeroStateStore,
    input: DuoErGunRoundStartInput,
  ): DuoErGunRoundStartResult
  classifyRegencyInput(
    state: HeroStateStore,
    input: DuoErGunRegencyInput,
  ): DuoErGunRegencyAction
  armRegency(
    state: HeroStateStore,
    action: Extract<DuoErGunRegencyAction, { kind: "arm" }>,
  ): void
  resolveRegencySwap(
    state: HeroStateStore,
    input: DuoErGunRegencySwapInput,
  ): DuoErGunRegencySwapResult
  resolveProtection(
    state: HeroStateStore,
    input: DuoErGunProtectionInput,
  ): DuoErGunProtectionResult
}

export const duoErGunModule = {
  id: HERO.DUO_ER_GUN,
  key: "duo-er-gun",
  ...metadata,
  windows: [
    HeroWindow.RoundStart,
    HeroWindow.VoteBallot,
    HeroWindow.VoteResolution,
  ],
  initializeState(state) {
    state.duoErGun.strategyMark = { kind: "none" }
    state.duoErGun.strategyUseCount = 0
    state.duoErGun.regencySeats = []
    state.duoErGun.regencyState = { kind: "locked" }
  },
  strategyMark(state) {
    return state.duoErGun.strategyMark
  },
  strategySeat(state) {
    const mark = state.duoErGun.strategyMark
    return mark.kind === "none" ? null : mark.seat
  },
  classifyStrategyInput(state, input) {
    const content = input.content.replace(/\s/g, "")
    if (!content.startsWith("立")) return { kind: "ignore" } as const
    if (state.duoErGun.regencyState.kind === "spent") {
      return { kind: "skill-spent" } as const
    }

    const chosenSeat = Number(content.replace("立", ""))
    if (!input.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }

    const mark = state.duoErGun.strategyMark
    if (mark.kind === "established" && chosenSeat === mark.seat) {
      return { kind: "established-target-unchanged", seat: chosenSeat } as const
    }
    if (chosenSeat === input.heroSeat) {
      return { kind: "self-forbidden", seat: chosenSeat } as const
    }
    if (mark.kind === "established"
      && input.activeSeats.includes(mark.seat)
      && state.duoErGun.regencyState.kind !== "locked") {
      return { kind: "established-target-locked", seat: mark.seat } as const
    }

    const previousSeat = mark.kind !== "none" && input.activeSeats.includes(mark.seat)
      ? mark.seat
      : null
    return {
      kind: "select",
      seat: chosenSeat,
      previousSeat,
      replacesNewMark: mark.kind === "new" && previousSeat !== null,
    } as const
  },
  selectStrategy(state, action) {
    if (!action.replacesNewMark) state.duoErGun.strategyUseCount += 1
    state.duoErGun.strategyMark = { kind: "new", seat: action.seat }
  },
  beginRound(state, input) {
    const mark = state.duoErGun.strategyMark
    const strategyEstablished = mark.kind === "new"
    let regencyReopened = false
    if (mark.kind === "new") {
      state.duoErGun.strategyMark = { kind: "established", seat: mark.seat }
      if (input.heroActive && state.duoErGun.regencyState.kind === "armed") {
        state.duoErGun.regencyState = { kind: "available" }
        regencyReopened = true
      }
    }

    let awakened = false
    if (input.heroActive
      && state.duoErGun.regencyState.kind === "locked"
      && (state.duoErGun.strategyUseCount >= 2 || input.hasNonVoteElimination)) {
      state.duoErGun.regencyState = { kind: "available" }
      awakened = true
    }
    return {
      strategySeat: this.strategySeat(state),
      strategyEstablished,
      regencyReopened,
      awakened,
    }
  },
  classifyRegencyInput(state, input) {
    const content = input.content.replace(/\s/g, "")
    const keepMatch = content.match(/保(\d+)/)
    const discardMatch = content.match(/弃(\d+)/)
    if (!keepMatch || !discardMatch) return { kind: "ignore" } as const
    if (state.duoErGun.regencyState.kind === "spent") {
      return { kind: "skill-spent" } as const
    }
    if (state.duoErGun.regencyState.kind === "locked") {
      return { kind: "not-awakened" } as const
    }

    const mark = state.duoErGun.strategyMark
    if (mark.kind === "new") {
      return { kind: "new-strategy-not-established", seat: mark.seat } as const
    }
    if (mark.kind === "established"
      && state.duoErGun.regencyState.kind === "armed"
      && input.activeSeats.includes(mark.seat)) {
      return { kind: "already-armed", strategySeat: mark.seat } as const
    }
    if (mark.kind !== "established" || !input.activeSeats.includes(mark.seat)) {
      return { kind: "strategy-missing" } as const
    }

    const keepSeat = Number(keepMatch[1])
    const discardSeat = Number(discardMatch[1])
    if (keepSeat === discardSeat) {
      return { kind: "same-target", seat: keepSeat } as const
    }
    if (!input.activeSeats.includes(keepSeat) || !input.activeSeats.includes(discardSeat)) {
      return { kind: "invalid-target" } as const
    }
    if (keepSeat !== mark.seat && discardSeat !== mark.seat) {
      return { kind: "strategy-not-in-pair", strategySeat: mark.seat } as const
    }
    return { kind: "arm", discardSeat, keepSeat } as const
  },
  armRegency(state, action) {
    state.duoErGun.regencySeats = [action.discardSeat, action.keepSeat]
    state.duoErGun.regencyState = { kind: "armed" }
  },
  resolveRegencySwap(state, input) {
    if (!input.activeSeats.includes(input.heroSeat)
      || state.duoErGun.regencyState.kind !== "armed"
      || state.duoErGun.regencySeats.length < 2) {
      return { kind: "none" } as const
    }
    const [discardSeat, keepSeat] = state.duoErGun.regencySeats
    const discardIndex = input.activeSeats.indexOf(discardSeat)
    const keepIndex = input.activeSeats.indexOf(keepSeat)
    if (discardIndex === -1
      || keepIndex === -1
      || input.leaderSeat !== keepSeat
      || !input.uniqueLeader
      || (input.overtime && !input.overtimeCandidateSeats.includes(discardSeat))) {
      return { kind: "none" } as const
    }

    const encodedVoteDifference = -Math.abs(input.poll[discardIndex] - input.poll[keepIndex]) - 1
    state.duoErGun.regencyState = { kind: "spent", encodedVoteDifference }
    return {
      kind: "swap",
      discardSeat,
      keepSeat,
      encodedVoteDifference,
    } as const
  },
  resolveProtection(state, input) {
    return resolveDuoErGunProtection({
      ...input,
      duoErGunSeat: input.heroSeat,
      strategyMark: state.duoErGun.strategyMark,
    })
  },
} satisfies DuoErGunModule
