import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HERO, HERO_NUM } from "../src/heroes"
import {
  WuSanGuiAuthorityPhase,
  adaptHeroState,
  createHeroStateStore,
} from "../src/game/hero-state"

describe("named hero state compatibility store", () => {
  it("starts with the same empty legacy arrays", () => {
    const store = createHeroStateStore()
    assert.equal(store.legacy.flag1.length, HERO_NUM)
    assert.equal(store.legacy.flag5.length, HERO_NUM)
    assert.deepEqual(store.legacy.flag1, Array(HERO_NUM).fill(0))
    assert.deepEqual(store.legacy.flag3, Array.from({ length: HERO_NUM }, () => []))
  })

  it("keeps low-coupling boolean views and legacy slots synchronized", () => {
    const store = createHeroStateStore()
    store.zhuYouJian.executionUsed = true
    store.liZiCheng.faRewardPending = true
    store.zhangXianZhong.awaitingTarget = true
    assert.equal(store.legacy.flag1[HERO.ZHU_YOU_JIAN], 1)
    assert.equal(store.legacy.flag1[HERO.LI_ZI_CHENG], 1)
    assert.equal(store.legacy.flag1[HERO.ZHANG_XIAN_ZHONG], 1)

    store.legacy.flag1[HERO.ZHU_YOU_JIAN] = 0
    store.legacy.flag1[HERO.LI_ZI_CHENG] = 0
    store.legacy.flag1[HERO.ZHANG_XIAN_ZHONG] = 0
    assert.equal(store.zhuYouJian.executionUsed, false)
    assert.equal(store.liZiCheng.faRewardPending, false)
    assert.equal(store.zhangXianZhong.awaitingTarget, false)
  })

  it("decodes seat and signed-seat state without copying storage", () => {
    const store = createHeroStateStore()
    store.huangTaiJi.trackedVoteTarget = 4
    store.yuanChongHuan.guard = { kind: "retaliation-pending", seat: 3 }
    store.duoErGun.strategyMark = { kind: "new", seat: 5 }
    assert.equal(store.legacy.flag1[HERO.HUANG_TAI_JI], 4)
    assert.equal(store.legacy.flag1[HERO.YUAN_CHONG_HUAN], -3)
    assert.equal(store.legacy.flag1[HERO.DUO_ER_GUN], -5)
    assert.deepEqual(store.yuanChongHuan.guard, { kind: "retaliation-pending", seat: 3 })
    assert.deepEqual(store.duoErGun.strategyMark, { kind: "new", seat: 5 })
  })

  it("decodes Wu Sangui phases, progress, and restrictions", () => {
    const store = createHeroStateStore()
    store.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.AwaitingChoice
    store.wuSanGui.progress = { kind: "tracking", useCount: 2 }
    store.wuSanGui.attackerSeats = [2, 5]
    store.wuSanGui.restoreVoteNextRound = true
    store.wuSanGui.restrictions = [1, 0, 1]
    assert.equal(store.legacy.flag1[HERO.WU_SAN_GUI], 1)
    assert.equal(store.legacy.flag2[HERO.WU_SAN_GUI], 2)
    assert.deepEqual(store.legacy.flag3[HERO.WU_SAN_GUI], [2, 5])
    assert.equal(store.legacy.flag4[HERO.WU_SAN_GUI], 1)
    assert.deepEqual(store.legacy.flag5[HERO.WU_SAN_GUI], [1, 0, 1])

    store.wuSanGui.progress = { kind: "awakened" }
    assert.equal(store.legacy.flag2[HERO.WU_SAN_GUI], -1)
    assert.deepEqual(store.wuSanGui.progress, { kind: "awakened" })
  })

  it("maps Lin Dan Han and Shi Kefa state meanings", () => {
    const store = createHeroStateStore()
    store.linDanHan.awakened = true
    store.linDanHan.ownVoteInvalidated = true
    store.linDanHan.realityRecords = [1, -2, 4]
    store.linDanHan.preventedVotePower = 3
    store.shiKeFa.mode = "awaiting-gift"
    store.shiKeFa.giftBalance = 2
    store.shiKeFa.teammateAttackerSeats = [3]
    assert.equal(store.legacy.flag2[HERO.LIN_DAN_HAN], 1)
    assert.equal(store.legacy.flag1[HERO.LIN_DAN_HAN], 1)
    assert.deepEqual(store.legacy.flag3[HERO.LIN_DAN_HAN], [1, -2, 4])
    assert.equal(store.legacy.flag4[HERO.LIN_DAN_HAN], 3)
    assert.equal(store.legacy.flag1[HERO.SHI_KE_FA], 2)
    assert.equal(store.legacy.flag2[HERO.SHI_KE_FA], 2)
    assert.deepEqual(store.legacy.flag3[HERO.SHI_KE_FA], [3])
  })

  it("maps Mao Wenlong and Dorgon continuation state", () => {
    const store = createHeroStateStore()
    store.maoWenLong.lateVotePending = true
    store.duoErGun.regencySeats = [2, 5]
    store.duoErGun.regencyState = { kind: "armed" }
    assert.equal(store.legacy.flag1[HERO.MAO_WEN_LONG], 1)
    assert.deepEqual(store.legacy.flag3[HERO.DUO_ER_GUN], [2, 5])
    assert.equal(store.legacy.flag4[HERO.DUO_ER_GUN], 2)

    store.legacy.flag4[HERO.DUO_ER_GUN] = -4
    assert.deepEqual(store.duoErGun.regencyState, {
      kind: "spent",
      encodedVoteDifference: -4,
    })
  })

  it("adapts an existing legacy object by reference", () => {
    const original = createHeroStateStore().legacy
    const store = adaptHeroState(original)
    store.liZiCheng.faRewardPending = true
    assert.strictEqual(store.legacy, original)
    assert.equal(original.flag1[HERO.LI_ZI_CHENG], 1)
  })
  it("resets Zhu Youjian execution state only with a new game store", () => {
    const currentGame = createHeroStateStore()
    assert.equal(currentGame.zhuYouJian.executionUsed, false)
    currentGame.zhuYouJian.executionUsed = true
    assert.equal(currentGame.zhuYouJian.executionUsed, true)

    const nextGame = createHeroStateStore()
    assert.equal(nextGame.zhuYouJian.executionUsed, false)
  })
  it("tracks and consumes Li Zicheng fa reward state within one game", () => {
    const currentGame = createHeroStateStore()
    assert.equal(currentGame.liZiCheng.faRewardPending, false)
    currentGame.liZiCheng.faRewardPending = true
    assert.equal(currentGame.liZiCheng.faRewardPending, true)
    currentGame.liZiCheng.faRewardPending = false
    assert.equal(currentGame.liZiCheng.faRewardPending, false)

    const nextGame = createHeroStateStore()
    assert.equal(nextGame.liZiCheng.faRewardPending, false)
  })
  it("clears Zhang Xianzhong waiting state on abandon, timeout, or reset", () => {
    const currentGame = createHeroStateStore()
    currentGame.zhangXianZhong.awaitingTarget = true
    assert.equal(currentGame.zhangXianZhong.awaitingTarget, true)
    currentGame.zhangXianZhong.awaitingTarget = false
    assert.equal(currentGame.zhangXianZhong.awaitingTarget, false)
    currentGame.zhangXianZhong.awaitingTarget = true
    currentGame.zhangXianZhong.awaitingTarget = false
    assert.equal(currentGame.zhangXianZhong.awaitingTarget, false)

    assert.equal(createHeroStateStore().zhangXianZhong.awaitingTarget, false)
  })
})
