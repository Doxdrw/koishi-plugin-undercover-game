import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat } from "../game/hero-state"

const metadata = HEROES[HERO.ZHANG_XIAN_ZHONG]

export interface ZhangXianZhongTargetInput {
  readonly content: string
  readonly activeSeats: readonly Seat[]
}

export type ZhangXianZhongTargetAction =
  | { kind: "abandon" }
  | { kind: "target"; seat: Seat }
  | { kind: "invalid-target"; chosenSeat: number }

interface ZhangXianZhongModule extends HeroModule {
  beginTargetSelection(state: HeroStateStore): void
  finishTargetSelection(state: HeroStateStore): void
  isAwaitingTarget(state: HeroStateStore): boolean
  classifyTargetInput(input: ZhangXianZhongTargetInput): ZhangXianZhongTargetAction
}

export const zhangXianZhongModule = {
  id: HERO.ZHANG_XIAN_ZHONG,
  key: "zhang-xian-zhong",
  ...metadata,
  windows: [HeroWindow.PostElimination],
  initializeState(state) {
    state.zhangXianZhong.awaitingTarget = false
  },
  beginTargetSelection(state) {
    state.zhangXianZhong.awaitingTarget = true
  },
  finishTargetSelection(state) {
    state.zhangXianZhong.awaitingTarget = false
  },
  isAwaitingTarget(state) {
    return state.zhangXianZhong.awaitingTarget
  },
  classifyTargetInput(input) {
    const content = input.content.replace(/\s/g, "")
    if (content === "弃" || content === "弃权") {
      return { kind: "abandon" } as const
    }
    const chosenSeat = Number(content)
    if (!input.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }
    return { kind: "target", seat: chosenSeat } as const
  },
} satisfies ZhangXianZhongModule
