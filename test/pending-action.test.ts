import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HERO } from "../src/heroes"
import { createHeroStateStore } from "../src/game/hero-state"
import { PendingActionCoordinator } from "../src/game/pending-action"
import { ResolutionCursor } from "../src/game/resolution-pipeline"

function maoAction() {
  return {
    kind: "mao-wen-long-late-vote" as const,
    ownerSeat: 4,
    ownerUserId: "player-4",
    channel: { scope: "private" as const },
    blocksRosterChanges: true,
    gameEpoch: 7,
    timeoutMs: 120_000,
    resumeAt: ResolutionCursor.DuoErGunSwap,
  }
}

describe("pending action coordinator", () => {
  it("opens one action with an exact expiry and resume cursor", () => {
    const coordinator = new PendingActionCoordinator()
    const action = coordinator.open(maoAction(), 1_000)
    assert.equal(action.openedAt, 1_000)
    assert.equal(action.expiresAt, 121_000)
    assert.equal(action.resumeAt, ResolutionCursor.DuoErGunSwap)
    assert.equal(coordinator.remainingMs(21_000), 100_000)
  })

  it("rejects overlapping blocking actions", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open(maoAction(), 1_000)
    assert.throws(() => coordinator.open({
      ...maoAction(),
      kind: "huang-tai-ji-quan",
      resumeAt: ResolutionCursor.LinDanHanAwaken,
    }, 2_000), /while "mao-wen-long-late-vote" is active/)
  })

  it("matches private input by kind, owner, scope, and epoch", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open(maoAction(), 1_000)
    assert.equal(coordinator.matches("mao-wen-long-late-vote", {
      userId: "player-4",
      scope: "private",
      gameEpoch: 7,
    }), true)
    assert.equal(coordinator.matches("mao-wen-long-late-vote", {
      userId: "other",
      scope: "private",
      gameEpoch: 7,
    }), false)
    assert.equal(coordinator.matches("mao-wen-long-late-vote", {
      userId: "player-4",
      scope: "private",
      gameEpoch: 8,
    }), false)
  })

  it("requires the exact guild for group input", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open({
      ...maoAction(),
      kind: "zhang-xian-zhong-target",
      channel: { scope: "group", guildId: "guild-1" },
      resumeAt: ResolutionCursor.PostElimination,
    }, 1_000)
    assert.equal(coordinator.matches("zhang-xian-zhong-target", {
      userId: "player-4",
      scope: "group",
      guildId: "guild-1",
      gameEpoch: 7,
    }), true)
    assert.equal(coordinator.matches("zhang-xian-zhong-target", {
      userId: "player-4",
      scope: "group",
      guildId: "guild-2",
      gameEpoch: 7,
    }), false)
  })

  it("completes only the expected action", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open(maoAction(), 1_000)
    assert.throws(() => coordinator.complete("huang-tai-ji-quan"), /not active/)
    const completed = coordinator.complete("mao-wen-long-late-vote")
    assert.equal(completed.kind, "mao-wen-long-late-vote")
    assert.equal(coordinator.active, null)
  })

  it("clears stale game epochs and reports roster blocking", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open(maoAction(), 1_000)
    assert.equal(coordinator.isRosterChangeBlocked(), true)
    assert.equal(coordinator.clearStaleEpoch(7), null)
    assert.equal(coordinator.active?.gameEpoch, 7)
    assert.equal(coordinator.clearStaleEpoch(8)?.gameEpoch, 7)
    assert.equal(coordinator.active, null)
    assert.equal(coordinator.isRosterChangeBlocked(), false)
  })

  it("supports non-blocking adjudication without changing roster policy", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open({
      kind: "host-adjudication",
      ownerSeat: null,
      ownerUserId: "host",
      channel: { scope: "group", guildId: "guild-1" },
      blocksRosterChanges: false,
      gameEpoch: 7,
      timeoutMs: 300_000,
      resumeAt: ResolutionCursor.DeriveVoteEffects,
    }, 1_000)
    assert.equal(coordinator.isRosterChangeBlocked(), false)
  })

  it("keeps Mao Wenlong legacy state synchronized across input and timeout cleanup", () => {
    const state = createHeroStateStore()
    const coordinator = new PendingActionCoordinator()

    state.maoWenLong.lateVotePending = true
    coordinator.open(maoAction(), 1_000)
    assert.equal(state.legacy.flag1[HERO.MAO_WEN_LONG], 1)
    assert.equal(coordinator.isRosterChangeBlocked(), true)
    assert.equal(coordinator.matches("mao-wen-long-late-vote", {
      userId: "player-4",
      scope: "private",
      gameEpoch: 7,
    }), true)

    state.maoWenLong.lateVotePending = false
    assert.equal(coordinator.complete("mao-wen-long-late-vote").resumeAt, ResolutionCursor.DuoErGunSwap)
    assert.equal(state.legacy.flag1[HERO.MAO_WEN_LONG], 0)
    assert.equal(coordinator.active, null)

    state.maoWenLong.lateVotePending = true
    coordinator.open({ ...maoAction(), gameEpoch: 8 }, 2_000)
    state.maoWenLong.lateVotePending = false
    coordinator.clear("mao-wen-long-late-vote")
    assert.equal(state.legacy.flag1[HERO.MAO_WEN_LONG], 0)
    assert.equal(coordinator.active, null)
  })
  it("routes Huang Taiji input and timeout cleanup to the Lin Dan Han cursor", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open({
      kind: "huang-tai-ji-quan",
      ownerSeat: 6,
      ownerUserId: "player-6",
      channel: { scope: "private" },
      blocksRosterChanges: true,
      gameEpoch: 9,
      timeoutMs: 120_000,
      resumeAt: ResolutionCursor.LinDanHanAwaken,
    }, 3_000)

    assert.equal(coordinator.matches("huang-tai-ji-quan", {
      userId: "player-6",
      scope: "private",
      gameEpoch: 9,
    }), true)
    assert.equal(coordinator.matches("huang-tai-ji-quan", {
      userId: "player-4",
      scope: "private",
      gameEpoch: 9,
    }), false)
    assert.equal(
      coordinator.complete("huang-tai-ji-quan").resumeAt,
      ResolutionCursor.LinDanHanAwaken,
    )
  })

  it("routes Wu Sangui only in the active guild and resumes his choice cursor", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open({
      kind: "wu-san-gui-overtime-choice",
      ownerSeat: 3,
      ownerUserId: "player-3",
      channel: { scope: "group", guildId: "guild-1" },
      blocksRosterChanges: true,
      gameEpoch: 10,
      timeoutMs: 120_000,
      resumeAt: ResolutionCursor.WuSanGuiOvertimeChoice,
    }, 4_000)

    assert.equal(coordinator.matches("wu-san-gui-overtime-choice", {
      userId: "player-3",
      scope: "group",
      guildId: "guild-2",
      gameEpoch: 10,
    }), false)
    assert.equal(coordinator.matches("wu-san-gui-overtime-choice", {
      userId: "player-3",
      scope: "group",
      guildId: "guild-1",
      gameEpoch: 10,
    }), true)
    assert.equal(
      coordinator.complete("wu-san-gui-overtime-choice").resumeAt,
      ResolutionCursor.WuSanGuiOvertimeChoice,
    )
  })

  it("preserves nickname identity for Zhang Xianzhong group input", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open({
      kind: "zhang-xian-zhong-target",
      ownerSeat: 5,
      ownerUserId: "original-account",
      ownerNickname: "same-player",
      channel: { scope: "group", guildId: "guild-1" },
      blocksRosterChanges: true,
      gameEpoch: 11,
      timeoutMs: 120_000,
      resumeAt: ResolutionCursor.PostElimination,
    }, 5_000)

    assert.equal(coordinator.matches("zhang-xian-zhong-target", {
      userId: "alternate-account",
      nickname: "same-player",
      scope: "group",
      guildId: "guild-1",
      gameEpoch: 11,
    }), true)
    assert.equal(coordinator.matches("zhang-xian-zhong-target", {
      userId: "original-account",
      nickname: "different-player",
      scope: "group",
      guildId: "guild-1",
      gameEpoch: 11,
    }), false)
    assert.equal(
      coordinator.complete("zhang-xian-zhong-target").resumeAt,
      ResolutionCursor.PostElimination,
    )
  })


  it("keeps Shi Kefa non-blocking and untimed while another skill waits", () => {
    const coordinator = new PendingActionCoordinator()
    coordinator.open({
      kind: "shi-ke-fa-gift",
      ownerSeat: 8,
      ownerUserId: "player-8",
      channel: { scope: "private" },
      blocksRosterChanges: false,
      gameEpoch: 12,
      timeoutMs: null,
      resumeAt: ResolutionCursor.PostElimination,
    }, 6_000)

    assert.equal(coordinator.remainingMs(7_000, "shi-ke-fa-gift"), Number.POSITIVE_INFINITY)
    assert.equal(coordinator.isRosterChangeBlocked(), false)
    coordinator.open({ ...maoAction(), gameEpoch: 12 }, 7_000)
    assert.equal(coordinator.activeActions.length, 2)
    assert.equal(coordinator.isRosterChangeBlocked(), true)

    coordinator.complete("mao-wen-long-late-vote")
    assert.equal(coordinator.isRosterChangeBlocked(), false)
    assert.equal(coordinator.matches("shi-ke-fa-gift", {
      userId: "player-8",
      scope: "private",
      gameEpoch: 12,
    }), true)
    coordinator.complete("shi-ke-fa-gift")
    assert.equal(coordinator.activeActions.length, 0)
  })

  it("rejects negative timeouts", () => {
    const coordinator = new PendingActionCoordinator()
    assert.throws(() => coordinator.open({
      ...maoAction(),
      timeoutMs: -1,
    }), /cannot be negative/)
  })
})
