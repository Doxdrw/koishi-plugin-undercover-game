import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HERO } from "../src/heroes"
import { createHeroStateStore } from "../src/game/hero-state"
import { resetNativeHeroState } from "../src/game/hero-reset"
import { claimWeiZhongXianReward } from "../src/game/wei-zhong-xian-state"
import {
  activateSlanderForSeat,
  beginWeiZhongXianPhase,
  classifyWeiZhongXianInquiry,
  formatWeiZhongXianSlanderNotice,
  grantExtraSlander,
  recordWeiZhongXianAttack,
  recordWeiZhongXianVoteCandidate,
  weiZhongXianModule,
} from "../src/heroes/wei-zhong-xian"

describe("魏忠贤纯技能状态", () => {
  it("accepts the documented 缉访 aliases and rejects trailing input", () => {
    assert.deepEqual(classifyWeiZhongXianInquiry(" 缉访1 "), { kind: "vote-target" })
    assert.deepEqual(classifyWeiZhongXianInquiry("缉1"), { kind: "vote-target" })
    assert.deepEqual(classifyWeiZhongXianInquiry("访2 3"), { kind: "voted-by", targetSeat: 3 })
    assert.deepEqual(classifyWeiZhongXianInquiry("查23"), { kind: "voted-by", targetSeat: 3 })
    assert.deepEqual(classifyWeiZhongXianInquiry("弃查"), { kind: "abandon" })
    assert.deepEqual(classifyWeiZhongXianInquiry("缉访1额外"), { kind: "invalid-option" })
    assert.deepEqual(classifyWeiZhongXianInquiry("缉访2"), { kind: "invalid-target", targetSeat: Number.NaN })
  })

  it("takes an activation-time attack snapshot and excludes later attacks", () => {
    const state = createHeroStateStore()
    const weiSeat = 1
    recordWeiZhongXianAttack(state, 2, weiSeat, weiSeat)
    recordWeiZhongXianAttack(state, weiSeat, 3, weiSeat)
    const first = activateSlanderForSeat(state, weiSeat, weiSeat)
    assert.deepEqual(first, [2, 3])
    recordWeiZhongXianAttack(state, 4, weiSeat, weiSeat)
    assert.deepEqual(state.weiZhongXian.slanderRelations, [2, 3])
    assert.deepEqual(state.weiZhongXian.attackedBySeats, [2, 4])
  })

  it("clears attack snapshots on native reset rather than replaying an old reward generation", () => {
    const state = createHeroStateStore()
    recordWeiZhongXianAttack(state, 2, 1, 1)
    activateSlanderForSeat(state, 1, 1)
    grantExtraSlander(state, 1)
    assert.deepEqual(activateSlanderForSeat(state, 1, 1), [2])
    resetNativeHeroState(state, HERO.WEI_ZHONG_XIAN)
    assert.deepEqual(activateSlanderForSeat(state, 1, 1), [])
  })

  it("privately reports the full affected-seat snapshot and only the resource delta", () => {
    const notice = formatWeiZhongXianSlanderNotice([
      { seat: 2, name: "Bob" },
      { seat: 5, name: "Eve" },
    ], 2, 4)
    assert.equal(notice, "“诬诽”已发动。影响范围：2号玩家Bob、5号玩家Eve。本次新增2个“伐”，当前共有4个“伐”。")
    assert.doesNotMatch(notice, /视为异阵营|追溯补足|伐异/)
  })

  it("records normal and retroactive rewards separately without blocking a new vote against the same seat", () => {
    const state = createHeroStateStore()
    recordWeiZhongXianVoteCandidate(state, 1, 2)
    const first = state.weiZhongXian.candidates[0]
    first.targetExitedBeforeNextRound = true
    assert.equal(claimWeiZhongXianReward(first, false, 'normal'), false)
    assert.equal(first.blockedByFaction, true)
    assert.equal(claimWeiZhongXianReward(first, true, 'slander'), true)
    assert.equal(first.normalAwarded, false)
    assert.equal(first.retroactiveAwarded, true)
    assert.equal(claimWeiZhongXianReward(first, true, 'normal'), false)
    assert.equal(claimWeiZhongXianReward(first, true, 'slander'), false)
    recordWeiZhongXianVoteCandidate(state, 2, 2)
    const second = state.weiZhongXian.candidates[1]
    second.targetExitedBeforeNextRound = true
    assert.equal(claimWeiZhongXianReward(second, true, 'normal'), true)
    assert.equal(second.normalAwarded, true)
    assert.equal(second.retroactiveAwarded, false)
    assert.equal(claimWeiZhongXianReward(second, true, 'slander'), false)
  })

  it("clears old skill records while preserving the current ballot candidate and granted uses", () => {
    const state = createHeroStateStore()
    const weiSeat = 1
    recordWeiZhongXianAttack(state, 2, weiSeat, weiSeat)
    recordWeiZhongXianVoteCandidate(state, 7, 3)
    state.weiZhongXian.candidates[0].settled = true
    state.weiZhongXian.candidates[0].targetExitedBeforeNextRound = true
    beginWeiZhongXianPhase(state, 8)
    recordWeiZhongXianVoteCandidate(state, 8, 4)
    weiZhongXianModule.completeVotePhase(state, 8)
    weiZhongXianModule.recordDeparture(state, 4)
    state.weiZhongXian.inquiry = { kind: "voted-by", targetSeat: 2 }
    grantExtraSlander(state, weiSeat)
    assert.equal(activateSlanderForSeat(state, weiSeat, weiSeat)?.length, 1)
    resetNativeHeroState(state, HERO.WEI_ZHONG_XIAN)
    assert.equal(state.weiZhongXian.slanderUsed, false)
    assert.deepEqual(state.weiZhongXian.candidates.map(candidate => candidate.targetSeat), [4])
    assert.deepEqual(state.weiZhongXian.attackedBySeats, [])
    assert.deepEqual(state.weiZhongXian.attackedSeats, [])
    assert.equal(state.weiZhongXian.inquiry, null)
    assert.equal(state.weiZhongXian.phaseSerial, 8)
    assert.equal(state.weiZhongXian.candidates[0].targetExitedBeforeNextRound, true)
    assert.equal(state.grantedLimitedUses["wei-zhong-xian.slander:1"], 1)
    assert.deepEqual(state.weiZhongXian.slanderRelations, [])
    assert.equal(weiZhongXianModule.id, HERO.WEI_ZHONG_XIAN)
  })
})
