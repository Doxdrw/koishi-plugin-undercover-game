import { HERO, HEROES } from "../heroes"
import { normalizeHeroCommand, parseHeroNumber } from "../game/hero-command"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat, ZhangXianZhongLevel } from "../game/hero-state"
import type { VoteFact } from '../game/vote-facts'

const metadata = HEROES[HERO.ZHANG_XIAN_ZHONG]

export interface ZhangXianZhongTargetInput {
  readonly content: string
  readonly activeSeats: readonly Seat[]
  readonly ownerSeat?: Seat
}

export type ZhangXianZhongTargetAction =
  | { kind: "abandon" }
  | { kind: "target"; seat: Seat }
  | { kind: "invalid-target"; chosenSeat: number }

interface ZhangXianZhongModule extends HeroModule {
  beginTargetSelection(state: HeroStateStore): void
  finishTargetSelection(state: HeroStateStore): void
  isAwaitingTarget(state: HeroStateStore): boolean
  settleVote(state: HeroStateStore, seat: Seat, serial: number, facts: readonly VoteFact[]): ZhangXianZhongLevel | undefined
  classifyTargetInput(input: ZhangXianZhongTargetInput): ZhangXianZhongTargetAction
}

export const zhangXianZhongModule = {
  id: HERO.ZHANG_XIAN_ZHONG,
  key: "zhang-xian-zhong",
  ...metadata,
  windows: [HeroWindow.VoteBallot, HeroWindow.VoteResolution, HeroWindow.Elimination, HeroWindow.PostElimination],
  initializeState(state) {
    const zhang = state.zhangXianZhong
    zhang.awaitingTarget = false
    zhang.level = 1
    zhang.lastSettledVoteSerial = 0
    zhang.voterSeats.clear()
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
  settleVote(state, seat, serial, facts) {
    const zhang = state.zhangXianZhong
    if (seat <= 0 || serial <= zhang.lastSettledVoteSerial) return
    zhang.lastSettledVoteSerial = serial
    for (const fact of facts) {
      if (fact.targetSeat === seat && fact.status === 'vote' && fact.voterSeat !== seat) {
        zhang.voterSeats.add(fact.voterSeat)
      }
    }
    if (zhang.level < 3 && facts.some(fact => fact.voterSeat === seat && fact.targetSeat === seat
      && fact.status === 'vote' && fact.weight > 0 && fact.deciderSeat === undefined && !fact.invalidReasons?.length)) {
      zhang.level = zhang.level === 1 ? 2 : 3
      return zhang.level
    }
  },
  classifyTargetInput(input) {
    const content = normalizeHeroCommand(input.content)
    if (content === "弃" || content === "弃权") {
      return { kind: "abandon" } as const
    }
    const chosenSeat = parseHeroNumber(content)
    if (chosenSeat === input.ownerSeat || !input.activeSeats.includes(chosenSeat)) {
      return { kind: "invalid-target", chosenSeat } as const
    }
    return { kind: "target", seat: chosenSeat } as const
  },
} satisfies ZhangXianZhongModule
