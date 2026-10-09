import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ModeInteractionCoordinator,
  normalizeModeMessageReference,
  parseTurtleHostInput,
  parseTurtleQuestion,
  resolveModeMessageReference,
} from "../src/game/game-mode"

const roster = [
  { seat: 1, userId: "alice", nickname: "Alice" },
  { seat: 2, userId: "bob", nickname: "Bob" },
  { seat: 3, userId: "carol", nickname: "Carol" },
]

describe("turtle mode interaction state", () => {
  it("parses numbered questions, five answers, rejection, and corrections", () => {
    assert.deepEqual(parseTurtleQuestion(" 3 他是否在北方？ "), { seat: 3, question: "他是否在北方？" })
    assert.deepEqual(parseTurtleQuestion("3"), { seat: 3, question: "" })
    assert.equal(parseTurtleQuestion("没有座位"), null)
    for (const answer of ["是", "否", "是也不是", "无关", "不确定"] as const) {
      assert.deepEqual(parseTurtleHostInput("3" + answer), { kind: "answer", seat: 3, answer })
      assert.deepEqual(parseTurtleHostInput("改3" + answer), { kind: "correction", seat: 3, answer })
      assert.deepEqual(parseTurtleHostInput(answer, 3), { kind: "answer", seat: 3, answer })
    }
    assert.deepEqual(parseTurtleHostInput("2是", 3), { kind: "seat-mismatch", seat: 2, quotedSeat: 3 })
    assert.deepEqual(parseTurtleHostInput("驳回 不是一般疑问句", 3), {
      kind: "reject",
      seat: 3,
      reason: "不是一般疑问句",
    })
    assert.deepEqual(normalizeModeMessageReference({ messageId: "legacy-id", content: "  原问题  " }), {
      messageId: "legacy-id",
      content: "原问题",
    })
    assert.deepEqual(resolveModeMessageReference({
      rawMessage: "[CQ:reply,id=older-private-message][CQ:at,qq=1]是",
    }), { messageId: "older-private-message" })
    assert.deepEqual(resolveModeMessageReference({
      rawMessage: [{ type: "reply", data: { id: 12345 } }, { type: "text", data: { text: "是" } }],
    }), { messageId: "12345" })
    assert.deepEqual(resolveModeMessageReference({
      onebotMessage: { message: [{ type: "reply", data: { message_id: 67890 } }] },
    }), { messageId: "67890" })
    assert.deepEqual(parseTurtleHostInput("3驳回 不是一般疑问句"), {
      kind: "reject",
      seat: 3,
      reason: "不是一般疑问句",
    })
    assert.deepEqual(parseTurtleHostInput("3可能"), { kind: "invalid" })
  })

  it("initializes only eligible fixed seats and reports deterministic progress", () => {
    const mode = new ModeInteractionCoordinator()
    mode.reset("turtle")
    mode.configureTurtle("同一个汤面", "好人真词", "卧底真词")
    mode.beginTurtleRound("1:regular", roster, [1, 3], 10_000, 1_000)
    assert.equal(mode.turtleActiveRoundKey, "1:regular")
    assert.deepEqual(mode.turtleProgress(), {
      waitingQuestion: [1, 3],
      pendingHost: [],
      complete: [],
    })
    assert.equal(mode.turtleTurnForSeat(2), undefined)
  })

  it("pauses only the submitting player and resumes their remainder after rejection", () => {
    const mode = new ModeInteractionCoordinator()
    mode.reset("turtle")
    mode.beginTurtleRound("1:regular", roster, [1, 2], 10_000, 0)
    const first = mode.submitTurtleQuestion("alice", 1, "他是否是男性？", 3_000)
    assert.equal(first.kind, "accepted")
    assert.equal(mode.turtleTurnForSeat(1)?.remainingMs, 7_000)
    assert.equal(mode.turtleTurnForSeat(2)?.clockStartedAt, 0)
    const second = mode.submitTurtleQuestion("bob", 2, "他是否在世？", 5_000)
    assert.equal(second.kind, "accepted")
    assert.equal(mode.turtleTurnForSeat(2)?.remainingMs, 5_000)
    assert.deepEqual(mode.turtleProgress().pendingHost, [1, 2])

    const rejected = mode.answerTurtleQuestion({ kind: "reject", seat: 1, reason: "请重问" }, 8_000)
    assert.equal(rejected.kind, "rejected")
    assert.equal(mode.turtleTurnForSeat(1)?.clockStartedAt, 8_000)
    const retry = mode.submitTurtleQuestion("alice", 1, "他是否当过皇帝？", 10_000)
    assert.equal(retry.kind, "accepted")
    assert.equal(mode.turtleTurnForSeat(1)?.remainingMs, 5_000)
  })

  it("locks pending questions, completes answers, and permits only completed corrections", () => {
    const mode = new ModeInteractionCoordinator()
    mode.reset("turtle")
    mode.beginTurtleRound("1:regular", roster, [1, 2], Number.POSITIVE_INFINITY, 0)
    assert.equal(mode.submitTurtleQuestion("alice", 2, "错座位", 0).kind, "wrong-seat")
    assert.equal(mode.submitTurtleQuestion("alice", 1, "", 0).kind, "empty")
    assert.equal(mode.submitTurtleQuestion("alice", 1, "问题一", 0).kind, "accepted")
    assert.equal(mode.recordTurtleQuestionMessage(1, ["question-1", "private-prompt-1"], "1问题一"), true)
    assert.equal(mode.turtleSeatForQuestionReference({ messageId: "question-1" }), 1)
    assert.equal(mode.turtleSeatForQuestionReference({ messageId: "private-prompt-1" }), 1)
    assert.equal(mode.turtleSeatForQuestionReference({ content: "1问题一" }), 1)
    assert.equal(mode.submitTurtleQuestion("alice", 1, "覆盖问题", 0).kind, "pending")
    assert.equal(mode.turtleHasPendingHost(), true)
    assert.equal(mode.correctTurtleAnswer(1, "否").kind, "not-complete")
    assert.equal(mode.answerTurtleQuestion({ kind: "answer", seat: 1, answer: "是" }, 1).kind, "answered")
    assert.equal(mode.turtleSeatForQuestionReference({ messageId: "question-1" }), 1)
    assert.equal(mode.turtleHasPendingHost(), false)
    assert.equal(mode.correctTurtleAnswer(1, "是也不是").kind, "corrected")
    assert.equal(mode.turtleTurnForSeat(1)?.answer, "是也不是")
    assert.equal(mode.submitTurtleQuestion("alice", 1, "再次提问", 2).kind, "complete")
    mode.submitTurtleQuestion("bob", 2, "问题二", 0)
    mode.answerTurtleQuestion({ kind: "answer", seat: 2, answer: "无关" }, 1)
    assert.equal(mode.turtleAllComplete(), true)
  })

  it("resets a replacement identity without inheriting the old question or answer", () => {
    const mode = new ModeInteractionCoordinator()
    mode.reset("turtle")
    mode.beginTurtleRound("2:overtime", roster, [1, 2], 12_000, 0)
    mode.submitTurtleQuestion("alice", 1, "旧问题", 2_000)
    mode.answerTurtleQuestion({ kind: "answer", seat: 1, answer: "是" }, 3_000)
    mode.syncTurtleRoundRoster([
      { seat: 1, userId: "grace", nickname: "Grace" },
      roster[1],
    ], [1, 2], 12_000, 4_000)
    assert.deepEqual(mode.turtleTurnForSeat(1), {
      seat: 1,
      userId: "grace",
      nickname: "Grace",
      status: "waiting-question",
      remainingMs: 12_000,
      clockStartedAt: 4_000,
    })
    assert.equal(mode.submitTurtleQuestion("alice", 1, "失效旧输入", 4_001).kind, "not-player")
  })

  it("isolates regular and overtime round records", () => {
    const mode = new ModeInteractionCoordinator()
    mode.reset("turtle")
    mode.beginTurtleRound("1:regular", roster, [1], 10_000, 0)
    mode.submitTurtleQuestion("alice", 1, "第一轮", 1_000)
    mode.answerTurtleQuestion({ kind: "answer", seat: 1, answer: "是" }, 2_000)
    mode.beginTurtleRound("1:overtime", roster, [2], 5_000, 3_000)
    assert.equal(mode.turtleTurnForSeat(1), undefined)
    assert.equal(mode.turtleTurnForSeat(2)?.status, "waiting-question")
    assert.equal(mode.removeTurtleSeat(2), true)
    assert.equal(mode.turtleTurnForSeat(2), undefined)
    const state = mode.state
    assert.equal(state.kind, "turtle")
    if (state.kind === "turtle") assert.equal(state.rounds.get("1:regular")?.get(1)?.answer, "是")
  })
})
