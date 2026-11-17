import { HERO, HEROES } from "../heroes"
import { normalizeHeroCommand, parseHeroNumber } from "../game/hero-command"
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
  | { kind: "abandon" }
  | { kind: "invalid-target"; chosenSeat: number }
  | { kind: "previous-target-forbidden"; seat: Seat }
  | { kind: "self-forbidden"; seat: Seat }
  | { kind: "self-unavailable" }
  | { kind: "guard"; seat: Seat; replacedSeat: Seat | null }

interface YuanChongHuanModule extends HeroModule {
  beginVoteWindow(state: HeroStateStore, phaseSerial?: number): Seat | null
  isVoteWindowOpen(state: HeroStateStore, phaseSerial: number): boolean
  lockVoteWindow(state: HeroStateStore, phaseSerial: number, heroSeat: Seat): { seat: Seat | null; effective: boolean } | null
  selfGuardUses(state: HeroStateStore, seat: Seat): number
  grantExtraSelfGuard(state: HeroStateStore, seat: Seat): void
  currentGuardTarget(state: HeroStateStore): Seat | null
  retaliationTarget(state: HeroStateStore): Seat | null
  consumeRetaliationTarget(state: HeroStateStore): Seat | null
  classifyGuardInput(
    state: HeroStateStore,
    input: YuanChongHuanGuardInput,
  ): YuanChongHuanGuardAction
  selectGuard(state: HeroStateStore, seat: Seat): void
  abandonGuard(state: HeroStateStore): Seat | null
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
    state.yuanChongHuan.windowSerial = null
    state.yuanChongHuan.windowLocked = true
    state.yuanChongHuan.voteAttackerSeats = []
    state.yuanChongHuan.selfGuardUsed = false
  },
  beginVoteWindow(state, phaseSerial) {
    const current = state.yuanChongHuan.guard
    const previousTarget = current.kind === "guarding" ? current.seat : null
    state.yuanChongHuan.previousGuardTarget = previousTarget
    state.yuanChongHuan.guard = { kind: "none" }
    state.yuanChongHuan.windowSerial = phaseSerial ?? (state.yuanChongHuan.windowSerial ?? 0) + 1
    state.yuanChongHuan.windowLocked = false
    state.yuanChongHuan.voteAttackerSeats = []
    return previousTarget
  },
  isVoteWindowOpen(state, phaseSerial) {
    return state.yuanChongHuan.windowSerial === phaseSerial && !state.yuanChongHuan.windowLocked
  },
  selfGuardUses(state, seat) {
    return (state.yuanChongHuan.selfGuardUsed ? 0 : 1)
      + (state.grantedLimitedUses[`yuan-chong-huan.self-guard:${seat}`] ?? 0)
  },
  grantExtraSelfGuard(state, seat) {
    const key = `yuan-chong-huan.self-guard:${seat}`
    state.grantedLimitedUses[key] = (state.grantedLimitedUses[key] ?? 0) + 1
  },
  lockVoteWindow(state, phaseSerial, heroSeat) {
    if (state.yuanChongHuan.windowSerial !== phaseSerial || state.yuanChongHuan.windowLocked) return null
    state.yuanChongHuan.windowLocked = true
    const seat = currentGuardTarget(state)
    if (seat === heroSeat) {
      if (!state.yuanChongHuan.selfGuardUsed) state.yuanChongHuan.selfGuardUsed = true
      else {
        const key = `yuan-chong-huan.self-guard:${heroSeat}`
        const remaining = state.grantedLimitedUses[key] ?? 0
        if (remaining <= 0) { state.yuanChongHuan.guard = { kind: "none" }; return { seat, effective: false } }
        state.grantedLimitedUses[key] = remaining - 1
      }
    }
    if (seat !== null && state.yuanChongHuan.voteAttackerSeats.includes(seat)) {
      state.yuanChongHuan.guard = { kind: "retaliation-pending", seat }
      return { seat, effective: false }
    }
    return { seat, effective: seat !== null }
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
    const content = normalizeHeroCommand(input.content)
    if (content === "弃守") return { kind: "abandon" } as const
    const selfGuard = content === "专镇" || /^守\d+$/u.test(content) && parseHeroNumber(content.slice(1)) === input.heroSeat
    if (!selfGuard && !content.startsWith("守")) return { kind: "ignore" } as const

    const chosenSeat = selfGuard ? input.heroSeat : parseHeroNumber(content.slice(1))
    if (!input.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }
    if (chosenSeat === state.yuanChongHuan.previousGuardTarget) {
      return { kind: "previous-target-forbidden", seat: chosenSeat } as const
    }
    if (chosenSeat === input.heroSeat && !selfGuard) {
      return { kind: "self-forbidden", seat: chosenSeat } as const
    }
    if (selfGuard && state.yuanChongHuan.selfGuardUsed
      && (state.grantedLimitedUses[`yuan-chong-huan.self-guard:${input.heroSeat}`] ?? 0) <= 0) return { kind: "self-unavailable" } as const
    return {
      kind: "guard",
      seat: chosenSeat,
      replacedSeat: currentGuardTarget(state),
    } as const
  },
  selectGuard(state, seat) {
    state.yuanChongHuan.guard = { kind: "guarding", seat }
  },
  abandonGuard(state) {
    const target = currentGuardTarget(state)
    if (target !== null) state.yuanChongHuan.guard = { kind: "none" }
    return target
  },
  recordGuardedAttack(state, voterSeat, targetSeat, heroSeat) {
    if (targetSeat !== heroSeat) return false
    if (!state.yuanChongHuan.voteAttackerSeats.includes(voterSeat)) state.yuanChongHuan.voteAttackerSeats.push(voterSeat)
    const guarded = currentGuardTarget(state) === voterSeat
    if (guarded && state.yuanChongHuan.windowLocked) state.yuanChongHuan.guard = { kind: "retaliation-pending", seat: voterSeat }
    return guarded
  },
} satisfies YuanChongHuanModule
