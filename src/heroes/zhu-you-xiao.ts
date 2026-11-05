import { HERO, HEROES } from "../heroes"
import { normalizeHeroCommand, parseHeroNumber } from "../game/hero-command"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"

const metadata = HEROES[HERO.ZHU_YOU_XIAO]

export const ZhuYouXiaoHeirOption = {
  Reset: "reset",
  GrantExecution: "grant-execution",
  GrantLimited: "grant-limited",
} as const

export type ZhuYouXiaoHeirOption =
  typeof ZhuYouXiaoHeirOption[keyof typeof ZhuYouXiaoHeirOption]

export type ZhuYouXiaoDelegationInput =
  | { kind: "ignore" }
  | { kind: "abandon" }
  | { kind: "delegate"; seat: number }
  | { kind: "self-forbidden"; seat: number }
  | { kind: "invalid-target"; seat: number }

export type ZhuYouXiaoProxyVoteInput =
  | { kind: "target"; seat: number }
  | { kind: "abstain" }
  | { kind: "self-forbidden"; seat: number }
  | { kind: "invalid-target"; seat: number }

export type ZhuYouXiaoHeirTargetInput =
  | { kind: "abandon" }
  | { kind: "target"; seat: number }
  | { kind: "invalid-target"; seat: number }

export type ZhuYouXiaoHeirChoiceInput =
  | { kind: "abandon" }
  | { kind: "reset" }
  | { kind: "grant-execution" }
  | { kind: "grant-limited" }
  | { kind: "invalid-option"; option: number }

function normalize(content: string): string {
  return normalizeHeroCommand(content)
}

function parseSeat(value: string): number {
  return parseHeroNumber(value)
}

export function classifyDelegationInput(input: {
  content: string
  activeSeats: readonly number[]
  ownerSeat: number
}): ZhuYouXiaoDelegationInput {
  const content = normalize(input.content)
  if (content === "放弃放权" || content === "弃放权" || content === "弃放") return { kind: "abandon" }
  const prefix = content.startsWith("放权") ? "放权" : content.startsWith("放") ? "放" : null
  if (!prefix) return { kind: "ignore" }
  const seat = parseSeat(content.slice(prefix.length))
  if (!input.activeSeats.includes(seat)) return { kind: "invalid-target", seat }
  if (seat === input.ownerSeat) return { kind: "self-forbidden", seat }
  return { kind: "delegate", seat }
}

export function classifyProxyVoteInput(input: {
  content: string
  activeSeats: readonly number[]
  ownerSeat: number
}): ZhuYouXiaoProxyVoteInput | { kind: "ignore" } {
  const content = normalize(input.content)
  if (content.startsWith("代伐")) return { kind: "ignore" }
  const prefix = content.startsWith("代投") ? "代投" : content.startsWith("代") ? "代" : null
  if (!prefix) return { kind: "ignore" }
  const suffix = content.slice(prefix.length)
  if (suffix === "弃权" || suffix === "弃") return { kind: "abstain" }
  const seat = parseSeat(suffix)
  if (!input.activeSeats.includes(seat)) return { kind: "invalid-target", seat }
  if (seat === input.ownerSeat) return { kind: "self-forbidden", seat }
  return { kind: "target", seat }
}

export function classifyHeirTargetInput(input: {
  content: string
  activeSeats: readonly number[]
}): ZhuYouXiaoHeirTargetInput {
  const content = normalize(input.content)
  if (content === "弃" || content === "弃权" || content === "弃传弟") return { kind: "abandon" }
  const prefix = content.startsWith("传弟") ? "传弟" : content.startsWith("传") ? "传" : null
  const value = prefix
    ? content.slice(prefix.length)
    : content
  const seat = parseSeat(value)
  if (!input.activeSeats.includes(seat)) return { kind: "invalid-target", seat }
  return { kind: "target", seat }
}

export function zhuYouXiaoHeirOptions(heroId: number | null): ZhuYouXiaoHeirOption[] {
  if (heroId === null || [
    HERO.ZHANG_XIAN_ZHONG,
    HERO.LI_ZI_CHENG,
    HERO.MAO_WEN_LONG,
    HERO.HUANG_TAI_JI,
  ].includes(heroId as typeof HERO.ZHANG_XIAN_ZHONG)) {
    return [ZhuYouXiaoHeirOption.GrantExecution]
  }
  const options: ZhuYouXiaoHeirOption[] = [
    ZhuYouXiaoHeirOption.Reset,
    ZhuYouXiaoHeirOption.GrantExecution,
  ]
  if ([HERO.ZHU_YOU_JIAN, HERO.WEI_ZHONG_XIAN, HERO.YUAN_CHONG_HUAN].includes(heroId as typeof HERO.ZHU_YOU_JIAN)) {
    options.push(ZhuYouXiaoHeirOption.GrantLimited)
  }
  return options
}

export function classifyHeirChoiceInput(input: {
  content: string
  options: readonly ZhuYouXiaoHeirOption[]
}): ZhuYouXiaoHeirChoiceInput {
  const content = normalize(input.content).replace(/^传弟选/u, "")
  if (content === "弃" || content === "弃权" || content === "弃传弟") return { kind: "abandon" }
  const option = parseSeat(content)
  const selected = input.options[option - 1]
  if (selected === ZhuYouXiaoHeirOption.Reset) return { kind: "reset" }
  if (selected === ZhuYouXiaoHeirOption.GrantExecution) return { kind: "grant-execution" }
  if (selected === ZhuYouXiaoHeirOption.GrantLimited) return { kind: "grant-limited" }
  return { kind: "invalid-option", option }
}

interface ZhuYouXiaoModule extends HeroModule {
  classifyDelegationInput: typeof classifyDelegationInput
  classifyProxyVoteInput: typeof classifyProxyVoteInput
  classifyHeirTargetInput: typeof classifyHeirTargetInput
  classifyHeirChoiceInput: typeof classifyHeirChoiceInput
  heirOptions: typeof zhuYouXiaoHeirOptions
}

export const zhuYouXiaoModule = {
  id: HERO.ZHU_YOU_XIAO,
  key: "zhu-you-xiao",
  ...metadata,
  windows: [HeroWindow.VoteBallot, HeroWindow.PostElimination],
  initializeState() {},
  classifyDelegationInput,
  classifyProxyVoteInput,
  classifyHeirTargetInput,
  classifyHeirChoiceInput,
  heirOptions: zhuYouXiaoHeirOptions,
} satisfies ZhuYouXiaoModule
