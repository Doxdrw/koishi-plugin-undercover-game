import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HERO, HEROES, HERO_NUM } from "../src/heroes"
import { duoErGunModule } from "../src/heroes/duo-er-gun"
import { huangTaiJiModule } from "../src/heroes/huang-tai-ji"
import { linDanHanModule } from "../src/heroes/lin-dan-han"
import { maoWenLongModule } from "../src/heroes/mao-wen-long"
import { HeroRegistry, HeroWindow } from "../src/game/hero-module"
import type { HeroModule } from "../src/game/hero-module"
import { createHeroStateStore, WuSanGuiAuthorityPhase } from "../src/game/hero-state"
import { heroRegistry } from "../src/heroes/registry"
import {
  classifyLiZiChengBallot,
  LiZiChengBallotOutcome,
  liZiChengModule,
} from "../src/heroes/li-zi-cheng"
import { shiKeFaModule } from "../src/heroes/shi-ke-fa"
import { wuSanGuiModule } from "../src/heroes/wu-san-gui"
import { zhangXianZhongModule } from "../src/heroes/zhang-xian-zhong"
import { yuanChongHuanModule } from "../src/heroes/yuan-chong-huan"
import { zhuYouJianModule } from "../src/heroes/zhu-you-jian"

function legacyModule(id: number, key: string): HeroModule {
  return {
    id,
    key,
    ...HEROES[id],
    windows: [],
    initializeState() {},
  }
}

function appendedModule(id: number, key: string, name: string): HeroModule {
  return {
    id,
    key,
    name,
    ability: `${name}技能`,
    windows: [],
    initializeState() {},
  }
}

describe("hero module registry", () => {
  it("registers Zhu Youjian at his stable legacy ID without changing live state storage", () => {
    assert.equal(zhuYouJianModule.id, HERO.ZHU_YOU_JIAN)
    assert.equal(heroRegistry.getById(HERO.ZHU_YOU_JIAN), zhuYouJianModule)
    assert.equal(heroRegistry.getByKey("zhu-you-jian"), zhuYouJianModule)
    assert.deepEqual(zhuYouJianModule.windows, [
      HeroWindow.SpeechAction,
      HeroWindow.Elimination,
    ])

    const state = createHeroStateStore()
    state.zhuYouJian.executionUsed = true
    heroRegistry.initializeState(state)
    assert.equal(state.zhuYouJian.executionUsed, false)
    assert.equal(state.legacy.flag1[HERO.ZHU_YOU_JIAN], 0)
    assert.equal(zhuYouJianModule.isAvailable(state), true)
    zhuYouJianModule.activate(state)
    assert.equal(zhuYouJianModule.isAvailable(state), false)
    assert.equal(state.legacy.flag1[HERO.ZHU_YOU_JIAN], 1)
  })

  it("registers Li Zicheng at his stable vote windows and resets the legacy pending slot", () => {
    assert.equal(liZiChengModule.id, HERO.LI_ZI_CHENG)
    assert.equal(heroRegistry.getById(HERO.LI_ZI_CHENG), liZiChengModule)
    assert.deepEqual(liZiChengModule.windows, [
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
    ])

    const state = createHeroStateStore()
    state.liZiCheng.faRewardPending = true
    heroRegistry.initializeState(state)
    assert.equal(state.liZiCheng.faRewardPending, false)
    assert.equal(state.legacy.flag1[HERO.LI_ZI_CHENG], 0)
    assert.equal(liZiChengModule.hasRewardPending(state), false)
    liZiChengModule.markRewardPending(state)
    assert.equal(liZiChengModule.hasRewardPending(state), true)
    assert.equal(state.legacy.flag1[HERO.LI_ZI_CHENG], 1)
    assert.equal(liZiChengModule.consumeRewardPending(state), true)
    assert.equal(liZiChengModule.hasRewardPending(state), false)
    assert.equal(liZiChengModule.consumeRewardPending(state), false)
  })

  it("classifies every legacy Li Zicheng ballot outcome", () => {
    assert.equal(classifyLiZiChengBallot({
      ballot: 5,
      invalidatedByLinDanHan: false,
    }), LiZiChengBallotOutcome.Effective)
    assert.equal(classifyLiZiChengBallot({
      ballot: 0,
      invalidatedByLinDanHan: false,
    }), LiZiChengBallotOutcome.Abandoned)
    assert.equal(classifyLiZiChengBallot({
      ballot: -1,
      invalidatedByLinDanHan: false,
    }), LiZiChengBallotOutcome.SkippedOrTimedOut)
    assert.equal(classifyLiZiChengBallot({
      ballot: undefined,
      invalidatedByLinDanHan: false,
    }), LiZiChengBallotOutcome.SkippedOrTimedOut)
    assert.equal(classifyLiZiChengBallot({
      ballot: 5,
      invalidatedByLinDanHan: true,
    }), LiZiChengBallotOutcome.InvalidatedByLinDanHan)
  })

  it("records only reward-eligible Li Zicheng outcomes without clearing an earlier result", () => {
    const state = createHeroStateStore()
    liZiChengModule.recordBallotOutcome(state, {
      ballot: 5,
      invalidatedByLinDanHan: false,
    })
    assert.equal(liZiChengModule.hasRewardPending(state), false)

    liZiChengModule.recordBallotOutcome(state, {
      ballot: 5,
      invalidatedByLinDanHan: true,
    })
    assert.equal(liZiChengModule.hasRewardPending(state), true)

    liZiChengModule.recordBallotOutcome(state, {
      ballot: 5,
      invalidatedByLinDanHan: false,
    })
    assert.equal(liZiChengModule.hasRewardPending(state), true)
  })

  it("registers Zhang Xianzhong and owns his waiting-state lifecycle", () => {
    assert.equal(zhangXianZhongModule.id, HERO.ZHANG_XIAN_ZHONG)
    assert.equal(heroRegistry.getById(HERO.ZHANG_XIAN_ZHONG), zhangXianZhongModule)
    assert.deepEqual(zhangXianZhongModule.windows, [HeroWindow.PostElimination])

    const state = createHeroStateStore()
    state.zhangXianZhong.awaitingTarget = true
    heroRegistry.initializeState(state)
    assert.equal(zhangXianZhongModule.isAwaitingTarget(state), false)
    assert.equal(state.legacy.flag1[HERO.ZHANG_XIAN_ZHONG], 0)

    zhangXianZhongModule.beginTargetSelection(state)
    assert.equal(zhangXianZhongModule.isAwaitingTarget(state), true)
    zhangXianZhongModule.finishTargetSelection(state)
    assert.equal(zhangXianZhongModule.isAwaitingTarget(state), false)
  })

  it("classifies Zhang Xianzhong target input without owning elimination effects", () => {
    const activeSeats = [1, 3, 4, 6]
    assert.deepEqual(zhangXianZhongModule.classifyTargetInput({
      content: " 弃 权 ",
      activeSeats,
    }), { kind: "abandon" })
    assert.deepEqual(zhangXianZhongModule.classifyTargetInput({
      content: " 3 ",
      activeSeats,
    }), { kind: "target", seat: 3 })
    assert.deepEqual(zhangXianZhongModule.classifyTargetInput({
      content: "2",
      activeSeats,
    }), { kind: "invalid-target", chosenSeat: 2 })
    assert.deepEqual(zhangXianZhongModule.classifyTargetInput({
      content: "不是座位",
      activeSeats,
    }), { kind: "invalid-target", chosenSeat: Number.NaN })
  })

  it("registers Yuan Chonghuan and owns his guard-state lifecycle", () => {
    assert.equal(yuanChongHuanModule.id, HERO.YUAN_CHONG_HUAN)
    assert.equal(heroRegistry.getById(HERO.YUAN_CHONG_HUAN), yuanChongHuanModule)
    assert.deepEqual(yuanChongHuanModule.windows, [
      HeroWindow.RoundStart,
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
    ])

    const state = createHeroStateStore()
    state.yuanChongHuan.guard = { kind: "guarding", seat: 2 }
    state.yuanChongHuan.previousGuardTarget = 4
    heroRegistry.initializeState(state)
    assert.deepEqual(state.yuanChongHuan.guard, { kind: "none" })
    assert.equal(state.yuanChongHuan.previousGuardTarget, null)

    yuanChongHuanModule.selectGuard(state, 2)
    assert.equal(yuanChongHuanModule.currentGuardTarget(state), 2)
    assert.equal(yuanChongHuanModule.beginVoteWindow(state), 2)
    assert.equal(state.yuanChongHuan.previousGuardTarget, 2)
    assert.equal(yuanChongHuanModule.currentGuardTarget(state), null)
    yuanChongHuanModule.selectGuard(state, 3)
    assert.equal(yuanChongHuanModule.recordGuardedAttack(state, 3, 1, 1), true)
    assert.equal(yuanChongHuanModule.retaliationTarget(state), 3)
    assert.equal(state.legacy.flag1[HERO.YUAN_CHONG_HUAN], -3)
    assert.equal(yuanChongHuanModule.consumeRetaliationTarget(state), 3)
    assert.equal(yuanChongHuanModule.retaliationTarget(state), null)
    assert.equal(yuanChongHuanModule.consumeRetaliationTarget(state), null)
  })

  it("classifies Yuan Chonghuan guard input without owning shields or messages", () => {
    const state = createHeroStateStore()
    state.yuanChongHuan.previousGuardTarget = 2
    yuanChongHuanModule.selectGuard(state, 3)
    const input = {
      activeSeats: [1, 2, 3, 4],
      heroSeat: 1,
      whiteSeat: 4,
    }
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      ...input,
      content: "普通私聊",
    }), { kind: "ignore" })
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      ...input,
      content: "守9",
    }), { kind: "invalid-target", chosenSeat: 9 })
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      ...input,
      content: "守2",
    }), { kind: "previous-target-forbidden", seat: 2 })
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      ...input,
      content: "守1",
    }), { kind: "self-forbidden", seat: 1 })
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      ...input,
      content: " 守 4 ",
    }), { kind: "guard", seat: 4, replacedSeat: 3 })

    assert.equal(yuanChongHuanModule.recordGuardedAttack(state, 2, 1, 1), false)
    assert.deepEqual(state.yuanChongHuan.guard, { kind: "guarding", seat: 3 })
    assert.deepEqual(yuanChongHuanModule.classifyGuardInput(state, {
      ...input,
      whiteSeat: 1,
      content: "守1",
    }), { kind: "guard", seat: 1, replacedSeat: 3 })
  })

  it("registers Shi Kefa and owns his vote-resistance state", () => {
    assert.equal(shiKeFaModule.id, HERO.SHI_KE_FA)
    assert.equal(heroRegistry.getById(HERO.SHI_KE_FA), shiKeFaModule)
    assert.deepEqual(shiKeFaModule.windows, [
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
      HeroWindow.PostElimination,
    ])

    const state = createHeroStateStore()
    state.shiKeFa.mode = "resistance-lost"
    state.shiKeFa.giftBalance = 3
    state.shiKeFa.teammateAttackerSeats = [4]
    heroRegistry.initializeState(state)
    assert.equal(state.shiKeFa.mode, "resistance-available")
    assert.equal(state.shiKeFa.giftBalance, 0)
    assert.deepEqual(state.shiKeFa.teammateAttackerSeats, [])

    shiKeFaModule.addTeammateAttacker(state, 4)
    shiKeFaModule.addTeammateAttacker(state, 4)
    assert.deepEqual(state.shiKeFa.teammateAttackerSeats, [4])
    shiKeFaModule.removeTeammateAttacker(state, 4)
    assert.equal(shiKeFaModule.hasTeammateAttackers(state), false)
    shiKeFaModule.replaceTeammateAttackers(state, [4, 6])
    assert.deepEqual(state.shiKeFa.teammateAttackerSeats, [4, 6])
    shiKeFaModule.clearTeammateAttackers(state)
    assert.deepEqual(state.shiKeFa.teammateAttackerSeats, [])
  })

  it("applies Shi Kefa's resistance result through the compatibility state", () => {
    const state = createHeroStateStore()
    shiKeFaModule.addTeammateAttacker(state, 4)
    const result = shiKeFaModule.resolveVoteResistance(state, {
      overtime: false,
      overtimeCandidateSeats: [],
      voterIds: ["a", "b", "c", "d"],
      ballots: [2, 3, 2, 2],
      playerIds: ["a", "b", "c", "d"],
      activeSeats: [1, 2, 3, 4],
      undercoverSeats: [3, 4],
      whiteSeat: 0,
      shiKeFaSeat: 3,
    })
    assert.equal(result.notice, "reduced")
    assert.equal(state.shiKeFa.mode, "resistance-available")
    assert.equal(state.shiKeFa.giftBalance, -1)
    assert.equal(state.legacy.flag2[HERO.SHI_KE_FA], -1)
  })

  it("classifies and consumes Shi Kefa's non-blocking gift through module state", () => {
    const state = createHeroStateStore()
    state.shiKeFa.giftBalance = -1
    assert.equal(shiKeFaModule.prepareGift(state, 2), 1)
    shiKeFaModule.beginGift(state)
    assert.equal(state.shiKeFa.mode, "awaiting-gift")

    assert.deepEqual(shiKeFaModule.classifyGiftInput({
      content: " 弃 权 ",
      activeSeats: [1, 2, 3],
    }), { kind: "abandon" })
    assert.deepEqual(shiKeFaModule.classifyGiftInput({
      content: " 2 ",
      activeSeats: [1, 2, 3],
    }), { kind: "target", seat: 2 })
    assert.deepEqual(shiKeFaModule.classifyGiftInput({
      content: "9",
      activeSeats: [1, 2, 3],
    }), { kind: "invalid-target", chosenSeat: 9 })

    shiKeFaModule.abandonGift(state)
    assert.equal(state.shiKeFa.mode, "resistance-available")
    assert.equal(state.shiKeFa.giftBalance, 1)
    shiKeFaModule.beginGift(state)
    assert.equal(shiKeFaModule.consumeGift(state), 1)
    assert.equal(state.shiKeFa.mode, "resistance-available")
    assert.equal(state.shiKeFa.giftBalance, 0)
  })

  it("registers Dorgon and owns strategy selection without double-counting a same-window transfer", () => {
    assert.equal(duoErGunModule.id, HERO.DUO_ER_GUN)
    assert.equal(heroRegistry.getById(HERO.DUO_ER_GUN), duoErGunModule)
    assert.deepEqual(duoErGunModule.windows, [
      HeroWindow.RoundStart,
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
    ])

    const state = createHeroStateStore()
    state.duoErGun.strategyMark = { kind: "established", seat: 4 }
    state.duoErGun.strategyUseCount = 3
    state.duoErGun.regencySeats = [4, 5]
    state.duoErGun.regencyState = { kind: "armed" }
    heroRegistry.initializeState(state)
    assert.deepEqual(state.duoErGun.strategyMark, { kind: "none" })
    assert.equal(state.duoErGun.strategyUseCount, 0)
    assert.deepEqual(state.duoErGun.regencySeats, [])
    assert.deepEqual(state.duoErGun.regencyState, { kind: "locked" })

    const first = duoErGunModule.classifyStrategyInput(state, {
      content: " 立 2 ",
      activeSeats: [1, 2, 3, 4],
      heroSeat: 1,
    })
    assert.deepEqual(first, {
      kind: "select",
      seat: 2,
      previousSeat: null,
      replacesNewMark: false,
    })
    if (first.kind !== "select") assert.fail("expected a Dorgon strategy selection")
    duoErGunModule.selectStrategy(state, first)
    assert.equal(state.duoErGun.strategyUseCount, 1)

    const replacement = duoErGunModule.classifyStrategyInput(state, {
      content: "立3",
      activeSeats: [1, 2, 3, 4],
      heroSeat: 1,
    })
    assert.deepEqual(replacement, {
      kind: "select",
      seat: 3,
      previousSeat: 2,
      replacesNewMark: true,
    })
    if (replacement.kind !== "select") assert.fail("expected a Dorgon strategy replacement")
    duoErGunModule.selectStrategy(state, replacement)
    assert.equal(state.duoErGun.strategyUseCount, 1)
    assert.deepEqual(state.duoErGun.strategyMark, { kind: "new", seat: 3 })
    assert.equal(state.legacy.flag1[HERO.DUO_ER_GUN], -3)
  })

  it("classifies Dorgon strategy restrictions and applies new-mark protection", () => {
    const state = createHeroStateStore()
    const input = { activeSeats: [1, 2, 3, 4], heroSeat: 1 }
    assert.deepEqual(duoErGunModule.classifyStrategyInput(state, {
      ...input,
      content: "普通私聊",
    }), { kind: "ignore" })
    assert.deepEqual(duoErGunModule.classifyStrategyInput(state, {
      ...input,
      content: "立9",
    }), { kind: "invalid-target", chosenSeat: 9 })
    assert.deepEqual(duoErGunModule.classifyStrategyInput(state, {
      ...input,
      content: "立1",
    }), { kind: "self-forbidden", seat: 1 })

    state.duoErGun.strategyMark = { kind: "established", seat: 2 }
    state.duoErGun.regencyState = { kind: "available" }
    assert.deepEqual(duoErGunModule.classifyStrategyInput(state, {
      ...input,
      content: "立2",
    }), { kind: "established-target-unchanged", seat: 2 })
    assert.deepEqual(duoErGunModule.classifyStrategyInput(state, {
      ...input,
      content: "立3",
    }), { kind: "established-target-locked", seat: 2 })

    state.duoErGun.regencyState = { kind: "spent", encodedVoteDifference: -2 }
    assert.deepEqual(duoErGunModule.classifyStrategyInput(state, {
      ...input,
      content: "立3",
    }), { kind: "skill-spent" })

    state.duoErGun.regencyState = { kind: "locked" }
    state.duoErGun.strategyMark = { kind: "new", seat: 3 }
    assert.deepEqual(duoErGunModule.resolveProtection(state, {
      activeSeats: [1, 2, 3, 4],
      poll: [0, 2, 3, 1],
      heroSeat: 1,
    }), { protectedSeat: 3, pollAdjustment: -1 })
  })

  it("establishes Dorgon strategy and reopens or awakens regency at round start", () => {
    const state = createHeroStateStore()
    state.duoErGun.strategyMark = { kind: "new", seat: 3 }
    state.duoErGun.strategyUseCount = 2
    state.duoErGun.regencyState = { kind: "locked" }
    assert.deepEqual(duoErGunModule.beginRound(state, {
      heroActive: true,
      hasNonVoteElimination: false,
    }), {
      strategySeat: 3,
      strategyEstablished: true,
      regencyReopened: false,
      awakened: true,
    })
    assert.deepEqual(state.duoErGun.strategyMark, { kind: "established", seat: 3 })
    assert.deepEqual(state.duoErGun.regencyState, { kind: "available" })

    state.duoErGun.strategyMark = { kind: "new", seat: 4 }
    state.duoErGun.regencyState = { kind: "armed" }
    assert.deepEqual(duoErGunModule.beginRound(state, {
      heroActive: true,
      hasNonVoteElimination: false,
    }), {
      strategySeat: 4,
      strategyEstablished: true,
      regencyReopened: true,
      awakened: false,
    })
    assert.deepEqual(state.duoErGun.regencyState, { kind: "available" })
  })

  it("awakens Dorgon from a non-vote elimination but does not mutate regency after he leaves play", () => {
    const state = createHeroStateStore()
    assert.equal(duoErGunModule.beginRound(state, {
      heroActive: true,
      hasNonVoteElimination: true,
    }).awakened, true)
    assert.deepEqual(state.duoErGun.regencyState, { kind: "available" })

    state.duoErGun.strategyMark = { kind: "new", seat: 2 }
    state.duoErGun.regencyState = { kind: "armed" }
    const inactive = duoErGunModule.beginRound(state, {
      heroActive: false,
      hasNonVoteElimination: true,
    })
    assert.equal(inactive.strategyEstablished, true)
    assert.equal(inactive.regencyReopened, false)
    assert.equal(inactive.awakened, false)
    assert.deepEqual(state.duoErGun.strategyMark, { kind: "established", seat: 2 })
    assert.deepEqual(state.duoErGun.regencyState, { kind: "armed" })
  })

  it("requires Dorgon to awaken before arming regency", () => {
    const state = createHeroStateStore()
    const input = { activeSeats: [1, 2, 3, 4] }
    assert.deepEqual(duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "普通私聊",
    }), { kind: "ignore" })

    state.duoErGun.strategyMark = { kind: "new", seat: 2 }
    assert.deepEqual(duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "保2弃3",
    }), { kind: "not-awakened" })

    state.duoErGun.regencyState = { kind: "available" }
    assert.deepEqual(duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "保2弃3",
    }), { kind: "new-strategy-not-established", seat: 2 })

    state.duoErGun.strategyMark = { kind: "established", seat: 2 }
    state.duoErGun.regencyState = { kind: "locked" }
    assert.deepEqual(duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "弃 3 保 2",
    }), { kind: "not-awakened" })
    assert.deepEqual(state.duoErGun.regencySeats, [])
    assert.deepEqual(state.duoErGun.regencyState, { kind: "locked" })

    state.duoErGun.regencyState = { kind: "available" }
    const beforeSameTarget = {
      regencySeats: [...state.duoErGun.regencySeats],
      regencyState: state.duoErGun.regencyState,
      strategyMark: state.duoErGun.strategyMark,
    }
    assert.deepEqual(duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "保2弃2",
    }), { kind: "same-target", seat: 2 })
    assert.deepEqual({
      regencySeats: [...state.duoErGun.regencySeats],
      regencyState: state.duoErGun.regencyState,
      strategyMark: state.duoErGun.strategyMark,
    }, beforeSameTarget)

    const arm = duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "弃 3 保 2",
    })
    assert.deepEqual(arm, { kind: "arm", discardSeat: 3, keepSeat: 2 })
    if (arm.kind !== "arm") assert.fail("expected a Dorgon regency action")
    duoErGunModule.armRegency(state, arm)
    assert.deepEqual(state.duoErGun.regencySeats, [3, 2])
    assert.deepEqual(state.duoErGun.regencyState, { kind: "armed" })
    assert.deepEqual(duoErGunModule.classifyRegencyInput(state, {
      ...input,
      content: "保2弃4",
    }), { kind: "already-armed", strategySeat: 2 })
  })

  it("spends Dorgon regency only when its protected unique leader can swap", () => {
    const state = createHeroStateStore()
    state.duoErGun.strategyMark = { kind: "established", seat: 2 }
    state.duoErGun.regencySeats = [3, 2]
    state.duoErGun.regencyState = { kind: "armed" }
    const base = {
      activeSeats: [1, 2, 3, 4],
      poll: [0, 4, 1, 0],
      heroSeat: 1,
      leaderSeat: 2,
      uniqueLeader: true,
      overtime: false,
      overtimeCandidateSeats: [],
    }
    assert.deepEqual(duoErGunModule.resolveRegencySwap(state, {
      ...base,
      uniqueLeader: false,
    }), { kind: "none" })
    assert.deepEqual(duoErGunModule.resolveRegencySwap(state, base), {
      kind: "swap",
      discardSeat: 3,
      keepSeat: 2,
      encodedVoteDifference: -4,
    })
    assert.deepEqual(state.duoErGun.regencyState, {
      kind: "spent",
      encodedVoteDifference: -4,
    })
  })

  it("requires Dorgon's discard seat to be an overtime candidate", () => {
    const state = createHeroStateStore()
    state.duoErGun.regencySeats = [3, 2]
    state.duoErGun.regencyState = { kind: "armed" }
    const base = {
      activeSeats: [1, 2, 3, 4],
      poll: [0, 3, 1, 0],
      heroSeat: 1,
      leaderSeat: 2,
      uniqueLeader: true,
      overtime: true,
    }
    assert.deepEqual(duoErGunModule.resolveRegencySwap(state, {
      ...base,
      overtimeCandidateSeats: [2, 4],
    }), { kind: "none" })
    assert.equal(duoErGunModule.resolveRegencySwap(state, {
      ...base,
      overtimeCandidateSeats: [2, 3],
    }).kind, "swap")
  })

  it("registers Lin Dan Han and owns his compatibility-state lifecycle", () => {
    assert.equal(linDanHanModule.id, HERO.LIN_DAN_HAN)
    assert.equal(heroRegistry.getById(HERO.LIN_DAN_HAN), linDanHanModule)
    assert.deepEqual(linDanHanModule.windows, [
      HeroWindow.RoundStart,
      HeroWindow.SpeechAction,
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
      HeroWindow.Elimination,
    ])

    const state = createHeroStateStore()
    state.linDanHan.ownVoteInvalidated = true
    state.linDanHan.awakened = true
    state.linDanHan.realityRecords = [-2, 3]
    state.linDanHan.preventedVotePower = 4
    heroRegistry.initializeState(state)
    assert.equal(state.linDanHan.ownVoteInvalidated, false)
    assert.equal(state.linDanHan.awakened, false)
    assert.deepEqual(state.linDanHan.realityRecords, [])
    assert.equal(state.linDanHan.preventedVotePower, 0)

    linDanHanModule.initializeRealityRecords(state, [1, 2, 3, 4], 3)
    assert.deepEqual(state.linDanHan.realityRecords, [1, 2, 4])
    assert.deepEqual(state.legacy.flag3[HERO.LIN_DAN_HAN], [1, 2, 4])
  })

  it("reports Lin Dan Han attackers and preserves legacy awakened target rules", () => {
    const state = createHeroStateStore()
    state.linDanHan.realityRecords = [1, -2, 4]
    assert.deepEqual(linDanHanModule.roundReport(state, [1, 2, 3, 4, 5], 3), {
      attackedSeats: [2, 5],
      unattackedSeats: [1, 4],
    })
    assert.deepEqual(linDanHanModule.votableTargets(state, [1, 2, 4, 5]), [1, 2, 4, 5])

    linDanHanModule.awaken(state)
    assert.deepEqual(linDanHanModule.votableTargets(state, [1, 2, 4, 5]), [1, 2, 4])
    assert.deepEqual(linDanHanModule.promptTargets(state, [1, 2, 4, 5]), [1, 4])
  })

  it("consumes each Lin Dan Han skill-defense record once and awakens only once", () => {
    const state = createHeroStateStore()
    state.linDanHan.realityRecords = [2, 4]
    assert.deepEqual(linDanHanModule.protectFromSkill(state, 2), {
      protected: true,
      awakenedNow: true,
    })
    assert.equal(state.linDanHan.awakened, true)
    assert.deepEqual(state.linDanHan.realityRecords, [4])
    assert.deepEqual(linDanHanModule.protectFromSkill(state, 2), {
      protected: false,
      awakenedNow: false,
    })
    assert.deepEqual(linDanHanModule.protectFromSkill(state, 4), {
      protected: true,
      awakenedNow: false,
    })
  })

  it("evaluates Lin Dan Han lethal-vote awakening and resets vote transients", () => {
    const state = createHeroStateStore()
    const base = {
      heroActive: true,
      heroPoll: 2,
      preventedVotePower: 3,
      maximumPoll: 3,
      unvote: 1,
      shielded: false,
    }
    assert.equal(linDanHanModule.shouldAwakenFromVote(state, base), true)
    assert.equal(linDanHanModule.shouldAwakenFromVote(state, { ...base, heroPoll: 4 }), false)
    assert.equal(linDanHanModule.shouldAwakenFromVote(state, { ...base, shielded: true }), false)
    state.linDanHan.awakened = true
    assert.equal(linDanHanModule.shouldAwakenFromVote(state, base), false)

    state.linDanHan.ownVoteInvalidated = true
    state.linDanHan.preventedVotePower = 5
    linDanHanModule.beginVoteWindow(state)
    assert.equal(state.linDanHan.ownVoteInvalidated, false)
    assert.equal(state.linDanHan.preventedVotePower, 0)
  })

  it("owns Lin Dan Han incremental and rebuilt ballot state", () => {
    const state = createHeroStateStore()
    state.linDanHan.realityRecords = [1, 2, 4]
    assert.equal(linDanHanModule.markVoteAttack(state, 2), true)
    assert.equal(linDanHanModule.markVoteAttack(state, 3), false)
    assert.equal(linDanHanModule.hasPendingVoteAttack(state, 2), true)
    assert.equal(linDanHanModule.calculatePreventedVotePower(state, [1, 3, 5, 2]), 3)
    assert.equal(linDanHanModule.calculatePreventedVotePower(state, []), 0)
    assert.equal(linDanHanModule.undoVoteAttack(state, 2), true)
    assert.deepEqual(linDanHanModule.realityRecords(state), [1, 2, 4])
    linDanHanModule.markVoteAttack(state, 4)
    assert.equal(linDanHanModule.consumeVoteAttack(state, 4), true)
    assert.equal(linDanHanModule.consumeVoteAttack(state, 4), false)

    assert.equal(linDanHanModule.invalidateOwnVote(state), true)
    assert.equal(linDanHanModule.invalidateOwnVote(state), false)
    assert.equal(linDanHanModule.isOwnVoteInvalidated(state), true)
    assert.equal(linDanHanModule.restoreOwnVote(state), true)
    assert.equal(linDanHanModule.restoreOwnVote(state), false)

    linDanHanModule.replaceBallotState(state, {
      realityRecords: [-1, 2],
      ownVoteInvalidated: true,
      preventedVotePower: 7,
    })
    assert.deepEqual(state.linDanHan.realityRecords, [-1, 2])
    assert.equal(state.linDanHan.ownVoteInvalidated, true)
    assert.equal(state.linDanHan.preventedVotePower, 7)
  })

  it("registers Mao Wenlong and owns his late-vote state and decisions", () => {
    assert.equal(maoWenLongModule.id, HERO.MAO_WEN_LONG)
    assert.equal(heroRegistry.getById(HERO.MAO_WEN_LONG), maoWenLongModule)
    assert.deepEqual(maoWenLongModule.windows, [
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
    ])
    const state = createHeroStateStore()
    maoWenLongModule.beginLateVote(state)
    assert.equal(maoWenLongModule.isLateVotePending(state), true)
    assert.equal(state.legacy.flag1[HERO.MAO_WEN_LONG], 1)
    heroRegistry.initializeState(state)
    assert.equal(maoWenLongModule.isLateVotePending(state), false)

    const decision = {
      activeSeats: [1, 2, 3, 4],
      overtime: false,
      overtimeCandidateSeats: [] as number[],
      maoWenLongSeat: 1,
      requiredInfluence: 3,
      votePower: 1,
      fa: 1,
      totalQuan: 1,
    }
    assert.equal(maoWenLongModule.decideLateVote(decision), "prompt")
    assert.equal(maoWenLongModule.decideLateVote({ ...decision, requiredInfluence: 4 }), "cannot-affect")
  })

  it("classifies Mao Wenlong target, abandon, and overtime restrictions", () => {
    const base = {
      activeSeats: [1, 2, 3, 4],
      overtime: false,
      overtimeCandidateSeats: [] as number[],
    }
    assert.deepEqual(maoWenLongModule.classifyTargetInput({ ...base, content: " 弃权 " }), {
      kind: "abandon",
    })
    assert.deepEqual(maoWenLongModule.classifyTargetInput({ ...base, content: " 3 " }), {
      kind: "target",
      seat: 3,
    })
    assert.deepEqual(maoWenLongModule.classifyTargetInput({ ...base, content: "9" }), {
      kind: "invalid-target",
      chosenSeat: 9,
    })
    assert.deepEqual(maoWenLongModule.classifyTargetInput({
      ...base,
      overtime: true,
      overtimeCandidateSeats: [2, 4],
      content: "3",
    }), { kind: "invalid-target", chosenSeat: 3 })
  })

  it("registers Huang Taiji and consumes a successful prediction exactly once", () => {
    assert.equal(huangTaiJiModule.id, HERO.HUANG_TAI_JI)
    assert.equal(heroRegistry.getById(HERO.HUANG_TAI_JI), huangTaiJiModule)
    assert.deepEqual(huangTaiJiModule.windows, [
      HeroWindow.RoundStart,
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
    ])
    const state = createHeroStateStore()
    huangTaiJiModule.recordVoteTarget(state, 4)
    assert.equal(state.legacy.flag1[HERO.HUANG_TAI_JI], 4)
    assert.equal(huangTaiJiModule.consumePredictionReward(state, {
      activeSeats: [1, 2, 3, 5],
      heroActive: true,
    }), 4)
    assert.equal(huangTaiJiModule.trackedVoteTarget(state), null)
    assert.equal(huangTaiJiModule.consumePredictionReward(state, {
      activeSeats: [1, 2, 3, 5],
      heroActive: true,
    }), null)

    huangTaiJiModule.recordVoteTarget(state, 3)
    assert.equal(huangTaiJiModule.consumePredictionReward(state, {
      activeSeats: [1, 2, 3, 5],
      heroActive: true,
    }), null)
    heroRegistry.initializeState(state)
    assert.equal(huangTaiJiModule.trackedVoteTarget(state), null)
  })

  it("selects each Huang Taiji quan menu under the legacy eligibility rules", () => {
    const base = {
      heroActive: true,
      quan: 3,
      requiredInfluence: 2,
      leaderCount: 1,
      runnerUp: 1,
      overtime: false,
      playerCount: 6,
    }
    assert.equal(huangTaiJiModule.chooseQuanMode(base), "reduce-below-runner-up")
    assert.equal(huangTaiJiModule.chooseQuanMode({ ...base, quan: 2 }), "reduce-to-runner-up")
    assert.equal(huangTaiJiModule.chooseQuanMode({ ...base, runnerUp: 0 }), "reduce-to-runner-up")
    assert.equal(huangTaiJiModule.chooseQuanMode({ ...base, leaderCount: 2 }), "choose-tied-leader")
    assert.equal(huangTaiJiModule.chooseQuanMode({ ...base, quan: 1 }), null)
    assert.equal(huangTaiJiModule.chooseQuanMode({ ...base, heroActive: false }), null)
    assert.equal(huangTaiJiModule.chooseQuanMode({
      ...base,
      overtime: true,
      leaderCount: 3,
    }), null)
  })

  it("classifies Huang Taiji quan choices as central poll effects", () => {
    const base = {
      leaderSeats: [2, 4],
      requiredInfluence: 2,
    }
    assert.deepEqual(huangTaiJiModule.classifyQuanChoice({
      ...base,
      mode: "choose-tied-leader",
      content: " 4 ",
    }), { kind: "apply", targetSeat: 4, cost: 1, reduction: 1 })
    assert.deepEqual(huangTaiJiModule.classifyQuanChoice({
      ...base,
      mode: "choose-tied-leader",
      content: "3",
    }), { kind: "invalid-leader" })
    assert.deepEqual(huangTaiJiModule.classifyQuanChoice({
      ...base,
      leaderSeats: [2],
      mode: "reduce-to-runner-up",
      content: "1",
    }), { kind: "apply", targetSeat: 2, cost: 2, reduction: 2 })
    assert.deepEqual(huangTaiJiModule.classifyQuanChoice({
      ...base,
      leaderSeats: [2],
      mode: "reduce-below-runner-up",
      content: "2",
    }), { kind: "apply", targetSeat: 2, cost: 3, reduction: 3 })
    assert.deepEqual(huangTaiJiModule.classifyQuanChoice({
      ...base,
      leaderSeats: [2],
      mode: "reduce-below-runner-up",
      content: "3",
    }), { kind: "abandon" })
  })

  it("registers Wu Sangui and owns attacker, awakening, and restriction state", () => {
    assert.equal(wuSanGuiModule.id, HERO.WU_SAN_GUI)
    assert.equal(heroRegistry.getById(HERO.WU_SAN_GUI), wuSanGuiModule)
    assert.deepEqual(wuSanGuiModule.windows, [
      HeroWindow.RoundStart,
      HeroWindow.VoteBallot,
      HeroWindow.VoteResolution,
      HeroWindow.Elimination,
    ])
    const state = createHeroStateStore()
    assert.equal(wuSanGuiModule.recordAttacker(state, 3), true)
    assert.equal(wuSanGuiModule.recordAttacker(state, 2), true)
    assert.equal(wuSanGuiModule.recordAttacker(state, 3), false)
    assert.deepEqual(wuSanGuiModule.attackerSeats(state), [2, 3])

    state.wuSanGui.progress = { kind: "tracking", useCount: 1 }
    const awakening = wuSanGuiModule.resolveRoundProgress(state, {
      heroActive: true,
      random: () => 0,
    })
    assert.equal(awakening.awakenedNow, true)
    assert.equal(awakening.faReward, 2)
    assert.deepEqual(state.wuSanGui.progress, { kind: "awakened" })
    assert.deepEqual(state.wuSanGui.restrictions, [0, 0, 0])

    const firstRestriction = wuSanGuiModule.resolveRoundProgress(state, {
      heroActive: true,
      random: () => 0,
    })
    assert.equal(firstRestriction.restrictionAdded, 0)
    assert.deepEqual(state.wuSanGui.restrictions, [1, 0, 0])
    wuSanGuiModule.removeAttacker(state, 2)
    assert.deepEqual(wuSanGuiModule.attackerSeats(state), [3])
  })

  it("owns Wu Sangui choice cooldown, vote restoration, and awakened exclusions", () => {
    const state = createHeroStateStore()
    state.wuSanGui.restrictions = [0, 1, 0]
    assert.deepEqual(wuSanGuiModule.classifyChoiceInput(" 4 ", [4, 5]), {
      kind: "target",
      seat: 4,
    })
    assert.deepEqual(wuSanGuiModule.classifyChoiceInput("弃权", [4, 5]), {
      kind: "abandon",
    })
    assert.deepEqual(wuSanGuiModule.classifyChoiceInput("3", [4, 5]), {
      kind: "invalid-target",
      chosenSeat: 3,
    })

    wuSanGuiModule.beginChoice(state)
    assert.equal(state.wuSanGui.authorityPhase, WuSanGuiAuthorityPhase.AwaitingChoice)
    assert.deepEqual(wuSanGuiModule.completeChoice(state), { skipNextVote: true })
    assert.deepEqual(state.wuSanGui.progress, { kind: "tracking", useCount: 1 })
    assert.equal(state.wuSanGui.restoreVoteNextRound, true)
    assert.equal(wuSanGuiModule.advanceAuthorityRound(state, true), false)
    assert.equal(state.wuSanGui.authorityPhase, WuSanGuiAuthorityPhase.UsedPreviousRound)
    assert.equal(wuSanGuiModule.advanceAuthorityRound(state, true), true)
    assert.equal(state.wuSanGui.authorityPhase, WuSanGuiAuthorityPhase.Idle)
    assert.equal(state.wuSanGui.restoreVoteNextRound, false)

    state.wuSanGui.progress = { kind: "awakened" }
    state.wuSanGui.restrictions = [1, 1, 1]
    assert.equal(wuSanGuiModule.canChooseOvertimeTarget(state, {
      heroActive: true,
      heroIsCandidate: true,
    }), false)
    state.wuSanGui.restrictions = [0, 1, 0]
    assert.equal(wuSanGuiModule.canChooseOvertimeTarget(state, {
      heroActive: true,
      heroIsCandidate: true,
    }), true)
  })

  it("rejects duplicate IDs, keys, and names", () => {
    const registry = new HeroRegistry(HEROES).register(zhuYouJianModule)
    assert.throws(() => registry.register(legacyModule(HERO.ZHU_YOU_JIAN, "another-key")), /Duplicate hero ID/)
    assert.throws(() => registry.register({
      ...legacyModule(HERO.ZHANG_XIAN_ZHONG, "zhu-you-jian"),
      name: HEROES[HERO.ZHANG_XIAN_ZHONG].name,
    }), /Duplicate hero key/)
    assert.throws(() => registry.register({
      ...legacyModule(HERO.ZHANG_XIAN_ZHONG, "zhang-xian-zhong"),
      name: HEROES[HERO.ZHU_YOU_JIAN].name,
    }), /Duplicate hero name/)
  })

  it("returns registered legacy modules in stable ID order", () => {
    const registry = new HeroRegistry(HEROES)
      .register(legacyModule(HERO.ZHU_YOU_JIAN, "zhu-you-jian"))
      .register(legacyModule(HERO.ZHANG_XIAN_ZHONG, "zhang-xian-zhong"))
    assert.deepEqual(registry.ordered().map(module => module.id), [
      HERO.ZHANG_XIAN_ZHONG,
      HERO.ZHU_YOU_JIAN,
    ])
  })

  it("requires existing metadata to match and new IDs to append without gaps", () => {
    const registry = new HeroRegistry(HEROES)
    assert.throws(() => registry.register({
      ...legacyModule(HERO.ZHU_YOU_JIAN, "wrong-zhu"),
      ability: "changed",
    }), /does not match legacy metadata/)
    assert.throws(() => registry.register(appendedModule(HERO_NUM + 1, "future-2", "新武将二")), /must be appended/)

    registry.register(appendedModule(HERO_NUM, "future-1", "新武将一"))
    registry.register(appendedModule(HERO_NUM + 1, "future-2", "新武将二"))
    assert.deepEqual(registry.ordered().map(module => module.id), [HERO_NUM, HERO_NUM + 1])
  })

  it("resolves Zhu Youjian speech commands without mutating game state", () => {
    const base = {
      actorSeat: 1,
      activeSeats: [1, 2, 3, 4, 5, 6],
      undercoverSeats: [5, 6],
      whiteSeat: 0,
    }
    assert.deepEqual(zhuYouJianModule.onSpeechAction({
      ...base,
      content: "普通发言",
    }), { kind: "ignore" })
    assert.deepEqual(zhuYouJianModule.onSpeechAction({
      ...base,
      content: "处决 9",
    }), { kind: "invalid-target", chosenSeat: 9 })
    assert.deepEqual(zhuYouJianModule.onSpeechAction({
      ...base,
      content: "处决 5",
    }), {
      kind: "eliminate",
      source: "zhu-you-jian-execution",
      chosenSeat: 5,
      eliminatedSeat: 5,
      verdict: "success",
    })
    assert.deepEqual(zhuYouJianModule.onSpeechAction({
      ...base,
      content: "处决2",
    }), {
      kind: "eliminate",
      source: "zhu-you-jian-execution",
      chosenSeat: 2,
      eliminatedSeat: 1,
      verdict: "backlash",
    })
    assert.deepEqual(zhuYouJianModule.onSpeechAction({
      ...base,
      content: "处决1",
    }), {
      kind: "eliminate",
      source: "zhu-you-jian-execution",
      chosenSeat: 1,
      eliminatedSeat: 1,
      verdict: "self-execution",
    })
  })

  it("preserves the legacy rule that executing the white seat succeeds", () => {
    assert.deepEqual(zhuYouJianModule.onSpeechAction({
      content: "处决3",
      actorSeat: 1,
      activeSeats: [1, 2, 3],
      undercoverSeats: [2],
      whiteSeat: 3,
    }), {
      kind: "eliminate",
      source: "zhu-you-jian-execution",
      chosenSeat: 3,
      eliminatedSeat: 3,
      verdict: "success",
    })
  })

  it("reports self-execution before camp or white checks for every identity", () => {
    const cases = [
      { undercoverSeats: [2], whiteSeat: 0 },
      { undercoverSeats: [1], whiteSeat: 0 },
      { undercoverSeats: [2], whiteSeat: 1 },
    ]
    for (const context of cases) {
      assert.deepEqual(zhuYouJianModule.onSpeechAction({
        content: "处决1",
        actorSeat: 1,
        activeSeats: [1, 2, 3],
        ...context,
      }), {
        kind: "eliminate",
        source: "zhu-you-jian-execution",
        chosenSeat: 1,
        eliminatedSeat: 1,
        verdict: "self-execution",
      })
    }
  })
})
