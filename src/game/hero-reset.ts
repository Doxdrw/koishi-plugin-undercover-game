import { HERO } from "../heroes"
import type { HeroStateStore, Seat } from "./hero-state"
import { WuSanGuiAuthorityPhase } from "./hero-state"
import { linDanHanModule } from "../heroes/lin-dan-han"
import { resetWeiZhongXianNativeState } from "./wei-zhong-xian-state"

export interface NativeHeroResetContext {
  readonly activeSeats?: readonly Seat[]
  readonly heroSeat?: Seat
}

/**
 * Restore only the selected seat's native hero state.
 *
 * Granted abilities, score resources, delegation records, pending actions and
 * history live outside this store and are deliberately not touched here.  A
 * caller that owns a live pending action must keep its timer and input route;
 * Wu Sangui's awaiting choice is therefore preserved explicitly.
 */
export function resetNativeHeroState(
  state: HeroStateStore,
  heroId: number | null,
  context: NativeHeroResetContext = {},
): void {
  switch (heroId) {
    case HERO.ZHANG_XIAN_ZHONG:
      // Vote facts and a previously opened departure continuation are not
      // native progress. Reset the level prospectively, not those facts.
      state.zhangXianZhong.level = 1
      return
    case HERO.LI_ZI_CHENG:
      state.liZiCheng.faRewardPending = false
      return
    case HERO.ZHU_YOU_JIAN:
      state.zhuYouJian.executionUsed = false
      return
    case HERO.WU_SAN_GUI: {
      const awaitingChoice = state.wuSanGui.authorityPhase === WuSanGuiAuthorityPhase.AwaitingChoice
      state.wuSanGui.progress = { kind: "tracking", useCount: 0 }
      state.wuSanGui.attackerSeats = []
      state.wuSanGui.restoreVoteNextRound = false
      state.wuSanGui.restrictions = [0, 0, 0]
      state.wuSanGui.authorityPhase = awaitingChoice
        ? WuSanGuiAuthorityPhase.AwaitingChoice
        : WuSanGuiAuthorityPhase.Idle
      return
    }
    case HERO.HUANG_TAI_JI:
      state.huangTaiJi.trackedVoteTarget = null
      return
    case HERO.YUAN_CHONG_HUAN:
      state.yuanChongHuan.guard = { kind: "none" }
      state.yuanChongHuan.previousGuardTarget = null
      state.yuanChongHuan.selfGuardUsed = false
      return
    case HERO.LIN_DAN_HAN: {
      state.linDanHan.ownVoteInvalidated = false
      state.linDanHan.awakened = false
      state.linDanHan.preventedVotePower = 0
      state.linDanHan.pendingVoteAwakening = null
      const activeSeats = context.activeSeats
      const heroSeat = context.heroSeat
      if (activeSeats && heroSeat !== undefined) {
        linDanHanModule.initializeRealityRecords(state, activeSeats, heroSeat)
      }
      else {
        state.linDanHan.realityRecords = []
      }
      return
    }
    case HERO.SHI_KE_FA:
      state.shiKeFa.mode = "resistance-available"
      state.shiKeFa.giftBalance = 0
      state.shiKeFa.teammateAttackerSeats = []
      return
    case HERO.MAO_WEN_LONG:
      state.maoWenLong.lateVotePending = false
      return
    case HERO.DUO_ER_GUN:
      // The current 定策 marker is an external mark and survives reset.
      state.duoErGun.strategyUseCount = 0
      state.duoErGun.regencySeats = []
      state.duoErGun.regencyState = { kind: "locked" }
      return
    case HERO.WEI_ZHONG_XIAN:
      resetWeiZhongXianNativeState(state.weiZhongXian)
      return
    default:
      return
  }
}
