import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HERO } from "../src/heroes"
import { createHeroStateStore, WuSanGuiAuthorityPhase } from "../src/game/hero-state"
import { resetNativeHeroState } from "../src/game/hero-reset"
import {
  beginZhuYouXiaoVotePhase,
  createZhuYouXiaoState,
  detachZhuYouXiaoCurrent,
  recordZhuYouXiaoProxyVote,
  setZhuYouXiaoDelegate,
  zhuYouXiaoSuccessfulDelegates,
} from "../src/game/zhu-you-xiao-state"
import { zhuYouJianModule } from "../src/heroes/zhu-you-jian"
import { yuanChongHuanModule } from "../src/heroes/yuan-chong-huan"
import {
  ZhuYouXiaoHeirOption,
  classifyDelegationInput,
  classifyHeirChoiceInput,
  classifyHeirTargetInput,
  classifyProxyVoteInput,
  zhuYouXiaoHeirOptions,
  zhuYouXiaoModule,
} from "../src/heroes/zhu-you-xiao"

describe("Zhu Youxiao input and inheritance characterization", () => {
  it("accepts only another active seat for delegation and supports abandonment", () => {
    assert.deepEqual(classifyDelegationInput({
      content: " 放权 3 ",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "delegate", seat: 3 })
    assert.deepEqual(classifyDelegationInput({
      content: "放弃放权",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "abandon" })
    assert.deepEqual(classifyDelegationInput({
      content: "弃放权",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "abandon" })
    assert.deepEqual(classifyDelegationInput({
      content: "放3",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "delegate", seat: 3 })
    assert.deepEqual(classifyDelegationInput({
      content: "弃放",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "abandon" })
    assert.deepEqual(classifyDelegationInput({
      content: "放权1",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "self-forbidden", seat: 1 })
    assert.deepEqual(classifyDelegationInput({
      content: "放权9",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "invalid-target", seat: 9 })
    assert.deepEqual(classifyDelegationInput({
      content: "闲聊",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "ignore" })
  })

  it("keeps proxy ballots separate from the proxy player's own ballot", () => {
    assert.deepEqual(classifyProxyVoteInput({
      content: "代投4",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "target", seat: 4 })
    assert.deepEqual(classifyProxyVoteInput({
      content: "代投弃权",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "abstain" })
    assert.deepEqual(classifyProxyVoteInput({
      content: "代4",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "target", seat: 4 })
    assert.deepEqual(classifyProxyVoteInput({
      content: "代弃",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "abstain" })
    assert.deepEqual(classifyProxyVoteInput({
      content: "代投1",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "self-forbidden", seat: 1 })
    assert.deepEqual(classifyProxyVoteInput({
      content: "代投9",
      activeSeats: [1, 2, 3, 4],
      ownerSeat: 1,
    }), { kind: "invalid-target", seat: 9 })
  })

  it("accepts a target number in either prompted transfer form", () => {
    assert.deepEqual(classifyHeirTargetInput({
      content: "传弟3",
      activeSeats: [1, 2, 3],
    }), { kind: "target", seat: 3 })
    assert.deepEqual(classifyHeirTargetInput({
      content: "传3",
      activeSeats: [1, 2, 3],
    }), { kind: "target", seat: 3 })
    assert.deepEqual(classifyHeirTargetInput({
      content: "3",
      activeSeats: [1, 2, 3],
    }), { kind: "target", seat: 3 })
    assert.deepEqual(classifyHeirTargetInput({
      content: "弃",
      activeSeats: [1, 2, 3],
    }), { kind: "abandon" })
    assert.deepEqual(classifyHeirTargetInput({
      content: "传弟4",
      activeSeats: [1, 2, 3],
    }), { kind: "invalid-target", seat: 4 })
  })

  it("builds the approved dynamic transfer menu without meaningless options", () => {
    assert.deepEqual(zhuYouXiaoHeirOptions(null), [ZhuYouXiaoHeirOption.GrantExecution])
    for (const heroId of [
      HERO.LI_ZI_CHENG,
      HERO.MAO_WEN_LONG,
      HERO.HUANG_TAI_JI,
    ]) {
      assert.deepEqual(zhuYouXiaoHeirOptions(heroId), [ZhuYouXiaoHeirOption.GrantExecution])
    }
    for (const heroId of [
      HERO.ZHANG_XIAN_ZHONG,
      HERO.WU_SAN_GUI,
      HERO.DUO_ER_GUN,
      HERO.LIN_DAN_HAN,
      HERO.SHI_KE_FA,
    ]) {
      assert.deepEqual(zhuYouXiaoHeirOptions(heroId), [
        ZhuYouXiaoHeirOption.Reset,
        ZhuYouXiaoHeirOption.GrantExecution,
      ])
    }
    assert.deepEqual(zhuYouXiaoHeirOptions(HERO.ZHU_YOU_JIAN), [
      ZhuYouXiaoHeirOption.Reset,
      ZhuYouXiaoHeirOption.GrantExecution,
      ZhuYouXiaoHeirOption.GrantLimited,
    ])
    assert.deepEqual(zhuYouXiaoHeirOptions(HERO.YUAN_CHONG_HUAN), [
      ZhuYouXiaoHeirOption.Reset,
      ZhuYouXiaoHeirOption.GrantExecution,
      ZhuYouXiaoHeirOption.GrantLimited,
    ])
  })

  it('resets Zhang to level one without cancelling a latched choice or erasing settled votes', () => {
    const state = createHeroStateStore()
    state.zhangXianZhong.level = 3
    state.zhangXianZhong.awaitingTarget = true
    state.zhangXianZhong.lastSettledVoteSerial = 5
    state.zhangXianZhong.voterSeats.add(6)
    resetNativeHeroState(state, HERO.ZHANG_XIAN_ZHONG)
    assert.equal(state.zhangXianZhong.level, 1)
    assert.equal(state.zhangXianZhong.awaitingTarget, true)
    assert.equal(state.zhangXianZhong.lastSettledVoteSerial, 5)
    assert.deepEqual([...state.zhangXianZhong.voterSeats], [6])
  })

  it("rejects options that are not shown for the selected target", () => {
    const options = zhuYouXiaoHeirOptions(HERO.ZHU_YOU_JIAN)
    assert.deepEqual(classifyHeirChoiceInput({ content: "1", options }), {
      kind: "reset",
    })
    assert.deepEqual(classifyHeirChoiceInput({ content: "2", options }), {
      kind: "grant-execution",
    })
    assert.deepEqual(classifyHeirChoiceInput({ content: "3", options }), {
      kind: "grant-limited",
    })
    assert.deepEqual(classifyHeirChoiceInput({ content: "弃", options }), {
      kind: "abandon",
    })
    assert.deepEqual(classifyHeirChoiceInput({
      content: "3",
      options: [ZhuYouXiaoHeirOption.GrantExecution],
    }), { kind: "invalid-option", option: 3 })
    assert.equal(zhuYouXiaoModule.id, 10)
  })

  it("resets native hero state while preserving external resources", () => {
    const state = createHeroStateStore()
    state.duoErGun.strategyMark = { kind: "established", seat: 2 }
    state.duoErGun.strategyUseCount = 3
    state.duoErGun.regencySeats = [2, 4]
    state.duoErGun.regencyState = { kind: "armed" }
    resetNativeHeroState(state, HERO.DUO_ER_GUN)
    assert.deepEqual(state.duoErGun.strategyMark, { kind: "established", seat: 2 })
    assert.equal(state.duoErGun.strategyUseCount, 0)
    assert.deepEqual(state.duoErGun.regencySeats, [])
    assert.deepEqual(state.duoErGun.regencyState, { kind: "locked" })

    state.linDanHan.awakened = true
    state.linDanHan.ownVoteInvalidated = true
    state.linDanHan.realityRecords = [-1, 3]
    state.linDanHan.preventedVotePower = 2
    resetNativeHeroState(state, HERO.LIN_DAN_HAN, {
      activeSeats: [1, 2, 3, 4],
      heroSeat: 2,
    })
    assert.equal(state.linDanHan.awakened, false)
    assert.equal(state.linDanHan.ownVoteInvalidated, false)
    assert.deepEqual(state.linDanHan.realityRecords, [1, 3, 4])
    assert.equal(state.linDanHan.preventedVotePower, 0)
  })

  it("does not cancel an active Wu Sangui choice while resetting its persistent state", () => {
    const state = createHeroStateStore()
    state.wuSanGui.authorityPhase = WuSanGuiAuthorityPhase.AwaitingChoice
    state.wuSanGui.progress = { kind: "awakened" }
    state.wuSanGui.attackerSeats = [1, 2]
    state.wuSanGui.restoreVoteNextRound = true
    state.wuSanGui.restrictions = [1, 1, 1]
    resetNativeHeroState(state, HERO.WU_SAN_GUI)
    assert.equal(state.wuSanGui.authorityPhase, WuSanGuiAuthorityPhase.AwaitingChoice)
    assert.deepEqual(state.wuSanGui.progress, { kind: "tracking", useCount: 0 })
    assert.deepEqual(state.wuSanGui.attackerSeats, [])
    assert.equal(state.wuSanGui.restoreVoteNextRound, false)
    assert.deepEqual(state.wuSanGui.restrictions, [0, 0, 0])
  })

  it("keeps only successful final delegation per phase and preserves older phases", () => {
    const state = createZhuYouXiaoState()
    beginZhuYouXiaoVotePhase(state, { serial: 1, kind: "regular", ownerSeat: 1 })
    setZhuYouXiaoDelegate(state, 2)
    recordZhuYouXiaoProxyVote(state)
    setZhuYouXiaoDelegate(state, 3)
    assert.deepEqual(zhuYouXiaoSuccessfulDelegates(state), [])
    recordZhuYouXiaoProxyVote(state)
    beginZhuYouXiaoVotePhase(state, { serial: 2, kind: "overtime", ownerSeat: 1 })
    setZhuYouXiaoDelegate(state, 2)
    recordZhuYouXiaoProxyVote(state)
    assert.deepEqual(zhuYouXiaoSuccessfulDelegates(state), [2, 3])
    beginZhuYouXiaoVotePhase(state, { serial: 3, kind: "regular", ownerSeat: 1 })
    setZhuYouXiaoDelegate(state, 2)
    recordZhuYouXiaoProxyVote(state)
    setZhuYouXiaoDelegate(state, null)
    assert.deepEqual(zhuYouXiaoSuccessfulDelegates(state), [2, 3])
  })

  it("invalidates a previously recorded proxy vote when the same delegate is selected again", () => {
    const state = createZhuYouXiaoState()
    beginZhuYouXiaoVotePhase(state, { serial: 1, kind: "regular", ownerSeat: 1 })
    setZhuYouXiaoDelegate(state, 2)
    recordZhuYouXiaoProxyVote(state)
    // The middleware clears the raw ballot before applying a repeated
    // 放权2, so the old successful delegate must not be attached to the new
    // (still-empty) ballot.
    setZhuYouXiaoDelegate(state, 2)
    assert.deepEqual(zhuYouXiaoSuccessfulDelegates(state), [])
    recordZhuYouXiaoProxyVote(state)
    assert.deepEqual(zhuYouXiaoSuccessfulDelegates(state), [2])
  })

  it("can detach an eliminated owner while retaining its settled delegate record", () => {
    const state = createZhuYouXiaoState()
    beginZhuYouXiaoVotePhase(state, { serial: 1, kind: "regular", ownerSeat: 1 })
    setZhuYouXiaoDelegate(state, 2)
    recordZhuYouXiaoProxyVote(state)

    detachZhuYouXiaoCurrent(state, true)

    assert.equal(state.current?.delegateSeat, null)
    assert.equal(state.current?.successfulDelegateSeat, 2)
    assert.deepEqual(zhuYouXiaoSuccessfulDelegates(state), [2])
  })

  it("models a transferred limited execution as an independent extra use", () => {
    const state = createHeroStateStore()
    state.zhuYouJian.executionUsed = true
    zhuYouJianModule.grantExtraExecution(state)
    assert.equal(zhuYouJianModule.extraExecutions(state), 1)
    assert.equal(zhuYouJianModule.isAvailable(state), true)
    zhuYouJianModule.activate(state)
    assert.equal(zhuYouJianModule.extraExecutions(state), 0)
    assert.equal(zhuYouJianModule.isAvailable(state), false)
    resetNativeHeroState(state, HERO.ZHU_YOU_JIAN)
    assert.equal(zhuYouJianModule.isAvailable(state), true)
  })

  it("allows Yuan Chonghuan to abandon only the current guard", () => {
    const state = createHeroStateStore()
    yuanChongHuanModule.beginVoteWindow(state)
    yuanChongHuanModule.selectGuard(state, 2)
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      content: "弃守", activeSeats: [1, 2, 3], heroSeat: 1, whiteSeat: 0,
    }), { kind: "abandon" })
    assert.equal(yuanChongHuanModule.abandonGuard(state), 2)
    assert.equal(yuanChongHuanModule.currentGuardTarget(state), null)
    assert.equal(state.yuanChongHuan.previousGuardTarget, null)
  })
})
