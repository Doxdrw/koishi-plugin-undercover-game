import { HERO, HEROES } from "../heroes"
import { normalizeHeroCommand, parseHeroNumber } from "../game/hero-command"
import { HeroWindow } from "../game/hero-module"
import type { HeroModule } from "../game/hero-module"
import type { Seat, HeroStateStore } from "../game/hero-state"
import type { WeiZhongXianInquiry } from "../game/wei-zhong-xian-state"
import { addWeiZhongXianSeat, clearWeiZhongXianInquiry } from "../game/wei-zhong-xian-state"

const metadata = HEROES[HERO.WEI_ZHONG_XIAN]
const EXTRA_SLander_KEY = "wei-zhong-xian.slander"
const extraSlanderKey = (seat: number) => `${EXTRA_SLander_KEY}:${seat}`

export type WeiZhongXianInquiryInput =
  | WeiZhongXianInquiry
  | { kind: "invalid-target"; targetSeat: number }
  | { kind: "invalid-option" }
  | { kind: "ignore" }

function normalize(content: string): string {
  return normalizeHeroCommand(content)
}

function parseSeat(value: string): number {
  return parseHeroNumber(value)
}

export function classifyWeiZhongXianInquiry(content: string): WeiZhongXianInquiryInput {
  const normalized = normalize(content)
  if (["弃缉访", "弃缉", "弃访", "弃查"].includes(normalized)) return { kind: "abandon" }
  const prefix = normalized.startsWith("缉访")
    ? "缉访"
    : ["缉", "访", "查"].find(item => normalized.startsWith(item))
  if (!prefix) return { kind: "ignore" }
  const suffix = normalized.slice(prefix.length)
  if (suffix === "1") return { kind: "vote-target" }
  if (suffix.startsWith("2")) {
    const targetSeat = parseSeat(suffix.slice(1))
    if (!Number.isInteger(targetSeat)) return { kind: "invalid-target", targetSeat }
    return { kind: "voted-by", targetSeat }
  }
  return { kind: "invalid-option" }
}

export function classifyWeiZhongXianSlander(content: string): boolean {
  return normalize(content) === "诬诽"
}

export interface WeiZhongXianAffectedSeat {
  readonly seat: Seat
  readonly name: string
}

/**
 * The live result intentionally exposes only the snapshot's affected seats
 * and the resource delta.  Which relations changed and which old candidates
 * were retroactively rewarded remain recap-only details.
 */
export function formatWeiZhongXianSlanderNotice(
  affectedSeats: readonly WeiZhongXianAffectedSeat[],
  gainedFa: number,
  totalFa: number,
): string {
  const affectedText = affectedSeats.length
    ? affectedSeats.map(({ seat, name }) => `${seat}号玩家${name}`).join("、")
    : "无"
  return `“诬诽”已发动。影响范围：${affectedText}。本次新增${gainedFa}个“伐”，当前共有${totalFa}个“伐”。`
}

export function beginWeiZhongXianPhase(state: HeroStateStore, phaseSerial: number): void {
  state.weiZhongXian.phaseSerial = phaseSerial
  clearWeiZhongXianInquiry(state.weiZhongXian)
}

export function setWeiZhongXianInquiry(
  state: HeroStateStore,
  phaseSerial: number,
  inquiry: WeiZhongXianInquiry,
): boolean {
  if (state.weiZhongXian.phaseSerial !== phaseSerial) return false
  state.weiZhongXian.inquiry = inquiry
  return true
}

export function recordWeiZhongXianAttack(
  state: HeroStateStore,
  attackerSeat: Seat,
  targetSeat: Seat,
  weiSeat: Seat,
): void {
  if (attackerSeat === weiSeat) addWeiZhongXianSeat(state.weiZhongXian.attackedSeats, targetSeat)
  if (targetSeat === weiSeat) addWeiZhongXianSeat(state.weiZhongXian.attackedBySeats, attackerSeat)
}

export function activateWeiZhongXianSlander(state: HeroStateStore): Seat[] | null {
  const wei = state.weiZhongXian
  if (wei.slanderUsed) return null
  wei.slanderUsed = true
  wei.slanderRelations = [...new Set([...wei.attackedBySeats, ...wei.attackedSeats])].sort((a, b) => a - b)
  return [...wei.slanderRelations]
}

export function recordWeiZhongXianVoteCandidate(
  state: HeroStateStore,
  phaseSerial: number,
  targetSeat: Seat,
): void {
  const existing = state.weiZhongXian.candidates.find(candidate => candidate.phaseSerial === phaseSerial)
  if (existing?.targetSeat === targetSeat) return
  state.weiZhongXian.candidates = state.weiZhongXian.candidates
    .filter(candidate => candidate.phaseSerial !== phaseSerial)
  state.weiZhongXian.candidates.push({
    phaseSerial,
    targetSeat,
    phaseCompleted: false,
    settled: false,
    targetExitedBeforeNextRound: false,
    normalAwarded: false,
    retroactiveAwarded: false,
    blockedByFaction: false,
  })
}

export function completeWeiZhongXianVotePhase(state: HeroStateStore, phaseSerial: number): void {
  for (const candidate of state.weiZhongXian.candidates) {
    if (candidate.phaseSerial === phaseSerial) candidate.phaseCompleted = true
  }
}

export function recordWeiZhongXianDeparture(state: HeroStateStore, seat: Seat): void {
  for (const candidate of state.weiZhongXian.candidates) {
    if (!candidate.settled && candidate.targetSeat === seat) candidate.targetExitedBeforeNextRound = true
  }
}

export function extraSlanderUses(state: HeroStateStore, seat: Seat): number {
  return state.grantedLimitedUses[extraSlanderKey(seat)] ?? 0
}

export function grantExtraSlander(state: HeroStateStore, seat: Seat): void {
  const key = extraSlanderKey(seat)
  state.grantedLimitedUses[key] = extraSlanderUses(state, seat) + 1
}

export function isSlanderAvailableForSeat(
  state: HeroStateStore,
  actorSeat: Seat,
  nativeHeroSeat: Seat,
): boolean {
  return actorSeat === nativeHeroSeat && !state.weiZhongXian.slanderUsed
    || extraSlanderUses(state, actorSeat) > 0
}

export function activateSlanderForSeat(
  state: HeroStateStore,
  actorSeat: Seat,
  nativeHeroSeat: Seat,
): Seat[] | null {
  if (actorSeat === nativeHeroSeat && !state.weiZhongXian.slanderUsed) {
    const relations = activateWeiZhongXianSlander(state)
    return relations ?? []
  }
  const extra = extraSlanderUses(state, actorSeat)
  if (extra <= 0) return null
  state.grantedLimitedUses[extraSlanderKey(actorSeat)] = extra - 1
  state.weiZhongXian.slanderRelations = [...new Set([
    ...state.weiZhongXian.attackedBySeats,
    ...state.weiZhongXian.attackedSeats,
  ])].sort((a, b) => a - b)
  return [...state.weiZhongXian.slanderRelations]
}

export function weiZhongXianConsidersDifferent(
  state: HeroStateStore,
  otherSeat: Seat,
  actualDifferent: boolean,
): boolean {
  return actualDifferent || state.weiZhongXian.slanderRelations.includes(otherSeat)
}

interface WeiZhongXianModule extends HeroModule {
  classifyInquiry: typeof classifyWeiZhongXianInquiry
  classifySlander: typeof classifyWeiZhongXianSlander
  formatSlanderNotice: typeof formatWeiZhongXianSlanderNotice
  beginPhase: typeof beginWeiZhongXianPhase
  setInquiry: typeof setWeiZhongXianInquiry
  clearInquiry: typeof clearWeiZhongXianInquiry
  recordAttack: typeof recordWeiZhongXianAttack
  activateSlander: typeof activateWeiZhongXianSlander
  recordVoteCandidate: typeof recordWeiZhongXianVoteCandidate
  completeVotePhase: typeof completeWeiZhongXianVotePhase
  recordDeparture: typeof recordWeiZhongXianDeparture
  extraSlanderUses: typeof extraSlanderUses
  grantExtraSlander: typeof grantExtraSlander
  isSlanderAvailableForSeat: typeof isSlanderAvailableForSeat
  activateSlanderForSeat: typeof activateSlanderForSeat
  considersDifferent: typeof weiZhongXianConsidersDifferent
}

export const weiZhongXianModule = {
  id: HERO.WEI_ZHONG_XIAN,
  key: "wei-zhong-xian",
  ...metadata,
  windows: [HeroWindow.VoteBallot, HeroWindow.VoteResolution, HeroWindow.Elimination, HeroWindow.PostElimination],
  initializeState(state) {
    state.weiZhongXian.phaseSerial = null
    state.weiZhongXian.inquiry = null
    state.weiZhongXian.candidates = []
    state.weiZhongXian.attackedBySeats = []
    state.weiZhongXian.attackedSeats = []
    state.weiZhongXian.slanderUsed = false
    state.weiZhongXian.slanderRelations = []
  },
  classifyInquiry: classifyWeiZhongXianInquiry,
  classifySlander: classifyWeiZhongXianSlander,
  formatSlanderNotice: formatWeiZhongXianSlanderNotice,
  beginPhase: beginWeiZhongXianPhase,
  setInquiry: setWeiZhongXianInquiry,
  clearInquiry: clearWeiZhongXianInquiry,
  recordAttack: recordWeiZhongXianAttack,
  activateSlander: activateWeiZhongXianSlander,
  recordVoteCandidate: recordWeiZhongXianVoteCandidate,
  completeVotePhase: completeWeiZhongXianVotePhase,
  recordDeparture: recordWeiZhongXianDeparture,
  extraSlanderUses,
  grantExtraSlander,
  isSlanderAvailableForSeat,
  activateSlanderForSeat,
  considersDifferent: weiZhongXianConsidersDifferent,
} satisfies WeiZhongXianModule
