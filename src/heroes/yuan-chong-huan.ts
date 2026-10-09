import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat } from "../game/hero-state"

const metadata = HEROES[HERO.YUAN_CHONG_HUAN]

function currentGuardTarget(state: HeroStateStore): Seat | null {
  const guard = state.yuanChongHuan.guard
  return guard.kind === "guarding" ? guard.seat : null
}

function pendingRetaliationTarget(state: HeroStateStore): Seat | null {
  const guard = state.yuanChongHuan.guard
  return guard.kind === "retaliation-pending" ? guard.seat : null
}

export interface YuanChongHuanGuardInput {
  readonly content: string
  readonly activeSeats: readonly Seat[]
  readonly heroSeat: Seat
  readonly whiteSeat: Seat
}

export type YuanChongHuanGuardAction =
  | { kind: "ignore" }
  | { kind: "invalid-target"; chosenSeat: number }
  | { kind: "previous-target-forbidden"; seat: Seat }
  | { kind: "self-forbidden"; seat: Seat }
  | { kind: "guard"; seat: Seat; replacedSeat: Seat | null }

interface YuanChongHuanModule extends HeroModule {
  beginVoteWindow(state: HeroStateStore): Seat | null
  currentGuardTarget(state: HeroStateStore): Seat | null
  retaliationTarget(state: HeroStateStore): Seat | null
  consumeRetaliationTarget(state: HeroStateStore): Seat | null
  classifyGuardInput(
    state: HeroStateStore,
    input: YuanChongHuanGuardInput,
  ): YuanChongHuanGuardAction
  selectGuard(state: HeroStateStore, seat: Seat): void
  recordGuardedAttack(
    state: HeroStateStore,
    voterSeat: Seat,
    targetSeat: Seat,
    heroSeat: Seat,
  ): boolean
}

export const yuanChongHuanModule = {
  id: HERO.YUAN_CHONG_HUAN,
  key: "yuan-chong-huan",
  ...metadata,
  windows: [
    HeroWindow.RoundStart,
    HeroWindow.VoteBallot,
    HeroWindow.VoteResolution,
  ],
  initializeState(state) {
    state.yuanChongHuan.guard = { kind: "none" }
    state.yuanChongHuan.previousGuardTarget = null
  },
  beginVoteWindow(state) {
    const current = state.yuanChongHuan.guard
    const previousTarget = current.kind === "guarding" ? current.seat : null
    state.yuanChongHuan.previousGuardTarget = previousTarget
    state.yuanChongHuan.guard = { kind: "none" }
    return previousTarget
  },
  currentGuardTarget(state) {
    return currentGuardTarget(state)
  },
  retaliationTarget(state) {
    return pendingRetaliationTarget(state)
  },
  consumeRetaliationTarget(state) {
    const target = pendingRetaliationTarget(state)
    if (target !== null) state.yuanChongHuan.guard = { kind: "none" }
    return target
  },
  classifyGuardInput(state, input) {
    const content = input.content.replace(/\s/g, "")
    if (!content.startsWith("守")) return { kind: "ignore" } as const

    const chosenSeat = Number(content.replace("守", ""))
    if (!input.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }
    if (chosenSeat === state.yuanChongHuan.previousGuardTarget) {
      return { kind: "previous-target-forbidden", seat: chosenSeat } as const
    }
    if (chosenSeat === input.heroSeat && input.heroSeat !== input.whiteSeat) {
      return { kind: "self-forbidden", seat: chosenSeat } as const
    }
    return {
      kind: "guard",
      seat: chosenSeat,
      replacedSeat: currentGuardTarget(state),
    } as const
  },
  selectGuard(state, seat) {
    state.yuanChongHuan.guard = { kind: "guarding", seat }
  },
  recordGuardedAttack(state, voterSeat, targetSeat, heroSeat) {
    if (currentGuardTarget(state) !== voterSeat || targetSeat !== heroSeat) {
      return false
    }
    state.yuanChongHuan.guard = { kind: "retaliation-pending", seat: voterSeat }
    return true
  },
} satisfies YuanChongHuanModule
