import { HERO, HEROES } from "../heroes"
import { normalizeHeroCommand, parseHeroNumber } from "../game/hero-command"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore } from "../game/hero-state"

const metadata = HEROES[HERO.ZHU_YOU_JIAN]
const EXTRA_EXECUTION_KEY = "zhu-you-jian.execution"
const extraExecutionKey = (seat: number) => `${EXTRA_EXECUTION_KEY}:${seat}`

function extraExecutions(state: HeroStateStore, seat?: number): number {
  return state.grantedLimitedUses[seat === undefined ? EXTRA_EXECUTION_KEY : extraExecutionKey(seat)] ?? 0
}

function grantExtraExecution(state: HeroStateStore, seat?: number): void {
  const key = seat === undefined ? EXTRA_EXECUTION_KEY : extraExecutionKey(seat)
  state.grantedLimitedUses[key] = extraExecutions(state, seat) + 1
}

function isAvailableForSeat(state: HeroStateStore, actorSeat: number, nativeHeroSeat: number): boolean {
  return actorSeat === nativeHeroSeat && !state.zhuYouJian.executionUsed
    || extraExecutions(state, actorSeat) > 0
}

function activateForSeat(state: HeroStateStore, actorSeat: number, nativeHeroSeat: number): boolean {
  if (actorSeat === nativeHeroSeat && !state.zhuYouJian.executionUsed) {
    state.zhuYouJian.executionUsed = true
    return true
  }
  const extra = extraExecutions(state, actorSeat)
  if (extra <= 0) return false
  state.grantedLimitedUses[extraExecutionKey(actorSeat)] = extra - 1
  return true
}

interface ZhuYouJianModule extends HeroModule {
  extraExecutions(state: HeroStateStore): number
  grantExtraExecution(state: HeroStateStore, seat?: number): void
  isAvailableForSeat(state: HeroStateStore, actorSeat: number, nativeHeroSeat: number): boolean
  activateForSeat(state: HeroStateStore, actorSeat: number, nativeHeroSeat: number): boolean
}

export const zhuYouJianModule = {
  id: HERO.ZHU_YOU_JIAN,
  key: "zhu-you-jian",
  ...metadata,
  windows: [
    HeroWindow.SpeechAction,
    HeroWindow.Elimination,
  ],
  initializeState(state) {
    state.zhuYouJian.executionUsed = false
    delete state.grantedLimitedUses[EXTRA_EXECUTION_KEY]
  },
  isAvailable(state) {
    return !state.zhuYouJian.executionUsed || extraExecutions(state) > 0
  },
  activate(state) {
    if (state.zhuYouJian.executionUsed && extraExecutions(state) > 0) {
      state.grantedLimitedUses[EXTRA_EXECUTION_KEY] = extraExecutions(state) - 1
    }
    state.zhuYouJian.executionUsed = true
  },
  extraExecutions,
  grantExtraExecution,
  isAvailableForSeat,
  activateForSeat,
  onSpeechAction(context) {
    const content = normalizeHeroCommand(context.content)
    if (!content.startsWith("处决")) return { kind: "ignore" } as const

    const chosenSeat = parseHeroNumber(content.slice(2))
    if (!context.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }

    // Self-targeting is always reported as self-execution, regardless of the
    // actor's camp or whether the actor is the white player.  Keep this test
    // before camp/white handling so the public wording and history stay stable.
    if (chosenSeat === context.actorSeat) {
      return {
        kind: "eliminate",
        source: "zhu-you-jian-execution",
        chosenSeat,
        eliminatedSeat: context.actorSeat,
        verdict: "self-execution",
      } as const
    }

    const actualDifferent = context.undercoverSeats.includes(context.actorSeat)
      !== context.undercoverSeats.includes(chosenSeat)
    const different = context.isDifferentFaction?.(context.actorSeat, chosenSeat) ?? actualDifferent
    if (different || chosenSeat === context.whiteSeat) {
      return {
        kind: "eliminate",
        source: "zhu-you-jian-execution",
        chosenSeat,
        eliminatedSeat: chosenSeat,
        verdict: "success",
      } as const
    }
    return {
      kind: "eliminate",
      source: "zhu-you-jian-execution",
      chosenSeat,
      eliminatedSeat: context.actorSeat,
      verdict: "backlash",
    } as const
  },
} satisfies ZhuYouJianModule
