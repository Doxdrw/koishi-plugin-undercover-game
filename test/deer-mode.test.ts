import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ModeInteractionCoordinator, normalizeModeTerm } from "../src/game/game-mode"

const roster = [
  { seat: 1, userId: "alice", nickname: "Alice" },
  { seat: 2, userId: "bob", nickname: "Bob" },
  { seat: 3, userId: "carol", nickname: "Carol" },
]

function createDeer() {
  const coordinator = new ModeInteractionCoordinator()
  coordinator.reset("deer")
  coordinator.configureDeer("三国谋士", "三国主公", "曹操")
  coordinator.syncDeerRoster(roster, 3)
  return coordinator
}

describe("deer mode selection state", () => {
  it("normalizes punctuation and rejects the common term itself", () => {
    assert.equal(normalizeModeTerm(" 《曹 操！》 "), "曹操")
    const coordinator = createDeer()
    assert.deepEqual(coordinator.submitDeerSelection("alice", "选人：《曹 操》"), {
      kind: "common-term",
    })
    assert.deepEqual(coordinator.submitDeerSelection("alice", "选人："), {
      kind: "empty",
    })
  })

  it("accepts simultaneous private choices and locks each pending request", () => {
    const coordinator = createDeer()
    coordinator.beginDeerSelectionClock(1, 1_000)
    coordinator.beginDeerSelectionClock(2, 2_000)
    const alice = coordinator.submitDeerSelection("alice", "选人 荀彧", 500)
    const bob = coordinator.submitDeerSelection("bob", "刘备", 600)
    assert.equal(alice.kind, "accepted")
    assert.equal(bob.kind, "accepted")
    assert.deepEqual(coordinator.deerPendingSeats(), [1, 2])
    assert.deepEqual(coordinator.deerProgress(), {
      waitingPlayer: [],
      pendingHost: [1, 2],
      approved: [],
    })
    assert.equal(coordinator.deerSelectionForSeat(1)?.selectionDeadlineAt, undefined)
    assert.equal(coordinator.deerSelectionForSeat(1)?.submittedAt, 500)
    assert.deepEqual(coordinator.submitDeerSelection("alice", "郭嘉"), {
      kind: "pending",
    })
  })

  it("tracks independent player deadlines and reports only expired waiting seats", () => {
    const coordinator = createDeer()
    coordinator.beginDeerSelectionClock(1, 1_000)
    coordinator.beginDeerSelectionClock(2, 2_000)
    assert.deepEqual(coordinator.deerExpiredWaitingSeats(999), [])
    assert.deepEqual(coordinator.deerExpiredWaitingSeats(1_000), [1])
    assert.equal(coordinator.submitDeerSelection("alice", "荀彧", 1_000).kind, "accepted")
    assert.deepEqual(coordinator.deerExpiredWaitingSeats(3_000), [2])
    assert.equal(coordinator.reviewDeerSelection({ seat: 1, approved: false }).kind, "rejected")
    assert.equal(coordinator.deerSelectionForSeat(1)?.selectionDeadlineAt, undefined)
    coordinator.beginDeerSelectionClock(1, 4_000)
    assert.deepEqual(coordinator.deerExpiredWaitingSeats(3_000), [2])
  })

  it("reviews by seat or quoted request and permits resubmission after rejection", () => {
    const coordinator = createDeer()
    const alice = coordinator.submitDeerSelection("alice", "荀彧")
    assert.equal(alice.kind, "accepted")
    if (alice.kind !== "accepted") throw new Error("expected accepted")
    coordinator.recordDeerRequestMessage(1, ["request-1", "request-1-part-2"], "鹿模式1号玩家Alice提交选人：荀彧")
    const rejected = coordinator.reviewDeerSelection({
      requestMessageId: "request-1",
      approved: false,
      reason: "不符合规则",
    })
    assert.equal(rejected.kind, "rejected")
    assert.equal(rejected.kind === "rejected" && rejected.reason, "不符合规则")
    assert.equal(coordinator.reviewDeerSelection({
      requestMessageId: "request-1-part-2",
      approved: true,
    }).kind, "not-found")

    assert.equal(coordinator.submitDeerSelection("alice", "郭嘉").kind, "accepted")
    coordinator.recordDeerRequestMessage(1, undefined, "鹿模式1号玩家Alice提交选人：郭嘉")
    assert.equal(coordinator.reviewDeerSelection({
      seat: 1,
      requestMessageId: "request-1",
      approved: true,
    }).kind, "not-found")
    assert.equal(coordinator.reviewDeerSelection({
      requestMessageContent: "鹿模式1号玩家Alice提交选人：荀彧",
      approved: true,
    }).kind, "not-found")
    assert.equal(coordinator.reviewDeerSelection({
      requestMessageContent: "鹿模式1号玩家Alice提交选人：郭嘉",
      approved: true,
    }).kind, "approved")
    assert.deepEqual(coordinator.submitDeerSelection("alice", "荀彧"), { kind: "approved" })
  })

  it("requires every non-white seat and supports an explicit pre-round reset", () => {
    const coordinator = createDeer()
    assert.equal(coordinator.submitDeerSelection("alice", "荀彧").kind, "accepted")
    assert.equal(coordinator.reviewDeerSelection({ seat: 1, approved: true }).kind, "approved")
    assert.equal(coordinator.deerAllApproved(), false)
    assert.equal(coordinator.submitDeerSelection("bob", "刘备").kind, "accepted")
    assert.equal(coordinator.reviewDeerSelection({ seat: 2, approved: true }).kind, "approved")
    assert.equal(coordinator.deerAllApproved(), true)
    coordinator.resetDeerSelection(1)
    assert.equal(coordinator.deerAllApproved(), false)
    assert.equal(coordinator.deerSelectionForSeat(1)?.candidate, undefined)
  })

  it("drops removed seats and resets a replacement instead of inheriting the choice", () => {
    const coordinator = createDeer()
    assert.equal(coordinator.submitDeerSelection("alice", "荀彧").kind, "accepted")
    assert.equal(coordinator.reviewDeerSelection({ seat: 1, approved: true }).kind, "approved")
    coordinator.syncDeerRoster([
      { seat: 1, userId: "dave", nickname: "Dave" },
      { seat: 3, userId: "carol", nickname: "Carol" },
    ], 3)
    assert.equal(coordinator.deerSelectionForSeat(2), undefined)
    assert.deepEqual(coordinator.deerSelectionForSeat(1), {
      seat: 1,
      userId: "dave",
      nickname: "Dave",
      status: "waiting-player",
    })
  })

})
