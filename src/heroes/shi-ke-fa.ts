import { HERO, HEROES } from "../heroes"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { HeroStateStore, Seat } from "../game/hero-state"
import {
  resolveShiKeFaResistance,
  type ResolveShiKeFaResistanceInput,
  type ShiKeFaResistanceResult,
} from "../game/vote-modifiers"

const metadata = HEROES[HERO.SHI_KE_FA]

export type ShiKeFaVoteResolutionInput = Omit<
  ResolveShiKeFaResistanceInput,
  "mode" | "teammateAttackers"
>

export interface ShiKeFaGiftInput {
  readonly content: string
  readonly activeSeats: readonly Seat[]
}

export type ShiKeFaGiftAction =
  | { kind: "abandon" }
  | { kind: "target"; seat: Seat }
  | { kind: "invalid-target"; chosenSeat: number }

interface ShiKeFaModule extends HeroModule {
  isResistanceAvailable(state: HeroStateStore): boolean
  hasTeammateAttackers(state: HeroStateStore): boolean
  replaceTeammateAttackers(state: HeroStateStore, seats: readonly Seat[]): void
  clearTeammateAttackers(state: HeroStateStore): void
  addTeammateAttacker(state: HeroStateStore, seat: Seat): void
  removeTeammateAttacker(state: HeroStateStore, seat: Seat): void
  resolveVoteResistance(
    state: HeroStateStore,
    input: ShiKeFaVoteResolutionInput,
  ): ShiKeFaResistanceResult
  prepareGift(state: HeroStateStore, baseAmount: number): number
  beginGift(state: HeroStateStore): void
  abandonGift(state: HeroStateStore): void
  consumeGift(state: HeroStateStore): number
  classifyGiftInput(input: ShiKeFaGiftInput): ShiKeFaGiftAction
}

export const shiKeFaModule = {
  id: HERO.SHI_KE_FA,
  key: "shi-ke-fa",
  ...metadata,
  windows: [
    HeroWindow.VoteBallot,
    HeroWindow.VoteResolution,
    HeroWindow.PostElimination,
  ],
  initializeState(state) {
    state.shiKeFa.mode = "resistance-available"
    state.shiKeFa.giftBalance = 0
    state.shiKeFa.teammateAttackerSeats = []
  },
  isResistanceAvailable(state) {
    return state.shiKeFa.mode === "resistance-available"
  },
  hasTeammateAttackers(state) {
    return state.shiKeFa.teammateAttackerSeats.length > 0
  },
  replaceTeammateAttackers(state, seats) {
    state.shiKeFa.teammateAttackerSeats = [...seats]
  },
  clearTeammateAttackers(state) {
    state.shiKeFa.teammateAttackerSeats = []
  },
  addTeammateAttacker(state, seat) {
    if (!state.shiKeFa.teammateAttackerSeats.includes(seat)) {
      state.shiKeFa.teammateAttackerSeats.push(seat)
    }
  },
  removeTeammateAttacker(state, seat) {
    const index = state.shiKeFa.teammateAttackerSeats.indexOf(seat)
    if (index !== -1) state.shiKeFa.teammateAttackerSeats.splice(index, 1)
  },
  resolveVoteResistance(state, input) {
    const result = resolveShiKeFaResistance({
      ...input,
      mode: state.shiKeFa.mode,
      teammateAttackers: state.shiKeFa.teammateAttackerSeats,
    })
    state.shiKeFa.mode = result.mode
    state.shiKeFa.giftBalance += result.giftBalanceAdjustment
    return result
  },
  prepareGift(state, baseAmount) {
    state.shiKeFa.giftBalance += baseAmount
    return state.shiKeFa.giftBalance
  },
  beginGift(state) {
    state.shiKeFa.mode = "awaiting-gift"
  },
  abandonGift(state) {
    state.shiKeFa.mode = "resistance-available"
  },
  consumeGift(state) {
    const amount = state.shiKeFa.giftBalance
    state.shiKeFa.mode = "resistance-available"
    state.shiKeFa.giftBalance = 0
    return amount
  },
  classifyGiftInput(input) {
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
} satisfies ShiKeFaModule
