import { HERO, HERO_NUM, createHeroState } from "../heroes"
import type { HeroState } from "../heroes"

export type Seat = number

export type YuanChongHuanGuardState =
  | { kind: "none" }
  | { kind: "guarding"; seat: Seat }
  | { kind: "retaliation-pending"; seat: Seat }

export type DuoErGunStrategyMark =
  | { kind: "none" }
  | { kind: "new"; seat: Seat }
  | { kind: "established"; seat: Seat }

export type DuoErGunRegencyState =
  | { kind: "locked" }
  | { kind: "available" }
  | { kind: "armed" }
  | { kind: "spent"; encodedVoteDifference: number }

export enum WuSanGuiAuthorityPhase {
  Idle = 0,
  AwaitingChoice = 1,
  UsedPreviousRound = 2,
  UsedThisRound = 3,
}

export type WuSanGuiProgress =
  | { kind: "tracking"; useCount: number }
  | { kind: "awakened" }

export type ShiKeFaMode = "resistance-available" | "resistance-lost" | "awaiting-gift"

export interface HeroStateStore {
  readonly legacy: HeroState
  readonly zhangXianZhong: {
    awaitingTarget: boolean
  }
  readonly liZiCheng: {
    faRewardPending: boolean
  }
  readonly zhuYouJian: {
    executionUsed: boolean
  }
  readonly wuSanGui: {
    authorityPhase: WuSanGuiAuthorityPhase
    progress: WuSanGuiProgress
    attackerSeats: Seat[]
    restoreVoteNextRound: boolean
    restrictions: [number, number, number]
  }
  readonly huangTaiJi: {
    trackedVoteTarget: Seat | null
  }
  readonly yuanChongHuan: {
    guard: YuanChongHuanGuardState
    previousGuardTarget: Seat | null
  }
  readonly linDanHan: {
    ownVoteInvalidated: boolean
    awakened: boolean
    realityRecords: number[]
    preventedVotePower: number
  }
  readonly shiKeFa: {
    mode: ShiKeFaMode
    giftBalance: number
    teammateAttackerSeats: Seat[]
  }
  readonly maoWenLong: {
    lateVotePending: boolean
  }
  readonly duoErGun: {
    strategyMark: DuoErGunStrategyMark
    strategyUseCount: number
    regencySeats: Seat[]
    regencyState: DuoErGunRegencyState
  }
}

function readBoolean(value: number): boolean {
  return value !== 0
}

function writeBoolean(value: boolean): number {
  return value ? 1 : 0
}

export function adaptHeroState(legacy: HeroState): HeroStateStore {
  return {
    legacy,
    zhangXianZhong: {
      get awaitingTarget() {
        return readBoolean(legacy.flag1[HERO.ZHANG_XIAN_ZHONG])
      },
      set awaitingTarget(value: boolean) {
        legacy.flag1[HERO.ZHANG_XIAN_ZHONG] = writeBoolean(value)
      },
    },
    liZiCheng: {
      get faRewardPending() {
        return readBoolean(legacy.flag1[HERO.LI_ZI_CHENG])
      },
      set faRewardPending(value: boolean) {
        legacy.flag1[HERO.LI_ZI_CHENG] = writeBoolean(value)
      },
    },
    zhuYouJian: {
      get executionUsed() {
        return readBoolean(legacy.flag1[HERO.ZHU_YOU_JIAN])
      },
      set executionUsed(value: boolean) {
        legacy.flag1[HERO.ZHU_YOU_JIAN] = writeBoolean(value)
      },
    },
    wuSanGui: {
      get authorityPhase() {
        return legacy.flag1[HERO.WU_SAN_GUI] as WuSanGuiAuthorityPhase
      },
      set authorityPhase(value: WuSanGuiAuthorityPhase) {
        legacy.flag1[HERO.WU_SAN_GUI] = value
      },
      get progress(): WuSanGuiProgress {
        const value = legacy.flag2[HERO.WU_SAN_GUI]
        return value < 0 ? { kind: "awakened" } : { kind: "tracking", useCount: value }
      },
      set progress(value: WuSanGuiProgress) {
        legacy.flag2[HERO.WU_SAN_GUI] = value.kind === "awakened" ? -1 : value.useCount
      },
      get attackerSeats() {
        return legacy.flag3[HERO.WU_SAN_GUI]
      },
      set attackerSeats(value: Seat[]) {
        legacy.flag3[HERO.WU_SAN_GUI] = value
      },
      get restoreVoteNextRound() {
        return readBoolean(legacy.flag4[HERO.WU_SAN_GUI])
      },
      set restoreVoteNextRound(value: boolean) {
        legacy.flag4[HERO.WU_SAN_GUI] = writeBoolean(value)
      },
      get restrictions(): [number, number, number] {
        const value = legacy.flag5[HERO.WU_SAN_GUI]
        return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]
      },
      set restrictions(value: [number, number, number]) {
        legacy.flag5[HERO.WU_SAN_GUI] = value
      },
    },
    huangTaiJi: {
      get trackedVoteTarget() {
        return legacy.flag1[HERO.HUANG_TAI_JI] || null
      },
      set trackedVoteTarget(value: Seat | null) {
        legacy.flag1[HERO.HUANG_TAI_JI] = value ?? 0
      },
    },
    yuanChongHuan: {
      get guard(): YuanChongHuanGuardState {
        const value = legacy.flag1[HERO.YUAN_CHONG_HUAN]
        if (value < 0) return { kind: "retaliation-pending", seat: -value }
        if (value > 0) return { kind: "guarding", seat: value }
        return { kind: "none" }
      },
      set guard(value: YuanChongHuanGuardState) {
        legacy.flag1[HERO.YUAN_CHONG_HUAN] = value.kind === "none"
          ? 0
          : value.kind === "guarding" ? value.seat : -value.seat
      },
      get previousGuardTarget() {
        return legacy.flag2[HERO.YUAN_CHONG_HUAN] || null
      },
      set previousGuardTarget(value: Seat | null) {
        legacy.flag2[HERO.YUAN_CHONG_HUAN] = value ?? 0
      },
    },
    linDanHan: {
      get ownVoteInvalidated() {
        return readBoolean(legacy.flag1[HERO.LIN_DAN_HAN])
      },
      set ownVoteInvalidated(value: boolean) {
        legacy.flag1[HERO.LIN_DAN_HAN] = writeBoolean(value)
      },
      get awakened() {
        return readBoolean(legacy.flag2[HERO.LIN_DAN_HAN])
      },
      set awakened(value: boolean) {
        legacy.flag2[HERO.LIN_DAN_HAN] = writeBoolean(value)
      },
      get realityRecords() {
        return legacy.flag3[HERO.LIN_DAN_HAN]
      },
      set realityRecords(value: number[]) {
        legacy.flag3[HERO.LIN_DAN_HAN] = value
      },
      get preventedVotePower() {
        return legacy.flag4[HERO.LIN_DAN_HAN]
      },
      set preventedVotePower(value: number) {
        legacy.flag4[HERO.LIN_DAN_HAN] = value
      },
    },
    shiKeFa: {
      get mode(): ShiKeFaMode {
        const value = legacy.flag1[HERO.SHI_KE_FA]
        if (value === 2) return "awaiting-gift"
        return value === 1 ? "resistance-lost" : "resistance-available"
      },
      set mode(value: ShiKeFaMode) {
        legacy.flag1[HERO.SHI_KE_FA] = value === "awaiting-gift"
          ? 2
          : value === "resistance-lost" ? 1 : 0
      },
      get giftBalance() {
        return legacy.flag2[HERO.SHI_KE_FA]
      },
      set giftBalance(value: number) {
        legacy.flag2[HERO.SHI_KE_FA] = value
      },
      get teammateAttackerSeats() {
        return legacy.flag3[HERO.SHI_KE_FA]
      },
      set teammateAttackerSeats(value: Seat[]) {
        legacy.flag3[HERO.SHI_KE_FA] = value
      },
    },
    maoWenLong: {
      get lateVotePending() {
        return readBoolean(legacy.flag1[HERO.MAO_WEN_LONG])
      },
      set lateVotePending(value: boolean) {
        legacy.flag1[HERO.MAO_WEN_LONG] = writeBoolean(value)
      },
    },
    duoErGun: {
      get strategyMark(): DuoErGunStrategyMark {
        const value = legacy.flag1[HERO.DUO_ER_GUN]
        if (value < 0) return { kind: "new", seat: -value }
        if (value > 0) return { kind: "established", seat: value }
        return { kind: "none" }
      },
      set strategyMark(value: DuoErGunStrategyMark) {
        legacy.flag1[HERO.DUO_ER_GUN] = value.kind === "none"
          ? 0
          : value.kind === "new" ? -value.seat : value.seat
      },
      get strategyUseCount() {
        return legacy.flag2[HERO.DUO_ER_GUN]
      },
      set strategyUseCount(value: number) {
        legacy.flag2[HERO.DUO_ER_GUN] = value
      },
      get regencySeats() {
        return legacy.flag3[HERO.DUO_ER_GUN]
      },
      set regencySeats(value: Seat[]) {
        legacy.flag3[HERO.DUO_ER_GUN] = value
      },
      get regencyState(): DuoErGunRegencyState {
        const value = legacy.flag4[HERO.DUO_ER_GUN]
        if (value < 0) return { kind: "spent", encodedVoteDifference: value }
        if (value === 2) return { kind: "armed" }
        return value === 1 ? { kind: "available" } : { kind: "locked" }
      },
      set regencyState(value: DuoErGunRegencyState) {
        legacy.flag4[HERO.DUO_ER_GUN] = value.kind === "locked"
          ? 0
          : value.kind === "available" ? 1
            : value.kind === "armed" ? 2 : value.encodedVoteDifference
      },
    },
  }
}

export function createHeroStateStore(heroNum = HERO_NUM): HeroStateStore {
  return adaptHeroState(createHeroState(heroNum))
}
