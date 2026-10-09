import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ModeInteractionCoordinator,
  createGameModeState,
  formatModeRoundCapabilities,
  getGameModeModule,
  parseGameModeSelection,
  parseModeStart,
} from "../src/game/game-mode"

describe("game mode compatibility boundary", () => {
  it("keeps classic capabilities and gives deer/turtle explicit restrictions", () => {
    assert.deepEqual(getGameModeModule("classic"), {
      id: "classic",
      label: "经典模式",
      allowsWhite: true,
      allowsWhiteRecruitment: true,
      allowsSelfExplosion: true,
    })
    assert.equal(getGameModeModule("deer").allowsWhite, true)
    assert.equal(getGameModeModule("deer").allowsWhiteRecruitment, false)
    assert.equal(getGameModeModule("deer").allowsSelfExplosion, false)
    assert.equal(getGameModeModule("turtle").allowsWhite, false)
    assert.equal(getGameModeModule("turtle").allowsSelfExplosion, false)
    assert.equal(formatModeRoundCapabilities("classic", "本轮"), "本轮可以自爆、可以盘发言、可以带票。")
    assert.equal(formatModeRoundCapabilities("deer", "本轮"), "本轮可以盘发言、可以带票。")
    assert.equal(formatModeRoundCapabilities("turtle", "从现在起"), "从现在起可以盘发言、可以带票。")
  })

  it("parses gathering selections and atomic start commands without changing plain start", () => {
    assert.equal(parseGameModeSelection(" 鹿 模式 "), "deer")
    assert.equal(parseGameModeSelection("龟模式"), "turtle")
    assert.equal(parseGameModeSelection("普通局"), null)
    assert.equal(parseModeStart("开始鹿模式"), "deer")
    assert.equal(parseModeStart("开始龟模式"), "turtle")
    assert.equal(parseModeStart("开始"), null)
  })

  it("creates isolated discriminated state and resets without retaining mode data", () => {
    const deer = createGameModeState("deer")
    assert.equal(deer.kind, "deer")
    if (deer.kind !== "deer") throw new Error("expected deer")
    deer.commonTerm = "曹操"
    deer.selections.set(1, {
      seat: 1,
      userId: "alice",
      nickname: "Alice",
      status: "approved",
      candidate: "荀彧",
    })

    const coordinator = new ModeInteractionCoordinator()
    coordinator.reset("deer")
    assert.equal(coordinator.mode, "deer")
    coordinator.reset("classic")
    assert.deepEqual(coordinator.state, { kind: "classic" })
    coordinator.reset("deer")
    assert.equal(coordinator.state.kind, "deer")
    if (coordinator.state.kind !== "deer") throw new Error("expected deer")
    assert.equal(coordinator.state.selections.size, 0)
  })

  it("accepts both neutral 选词 and legacy 选人 prefixes while storing only the term", () => {
    const coordinator = new ModeInteractionCoordinator()
    coordinator.reset("deer")
    coordinator.syncDeerRoster([{ seat: 1, userId: "alice", nickname: "Alice" }], 0)
    assert.equal(coordinator.submitDeerSelection("alice", "选词：草莓").kind, "accepted")
    if (coordinator.state.kind !== "deer") throw new Error("expected deer")
    assert.equal(coordinator.state.selections.get(1)?.candidate, "草莓")

    coordinator.reset("deer")
    coordinator.syncDeerRoster([{ seat: 1, userId: "alice", nickname: "Alice" }], 0)
    assert.equal(coordinator.submitDeerSelection("alice", "选人 苹果").kind, "accepted")
    if (coordinator.state.kind !== "deer") throw new Error("expected deer")
    assert.equal(coordinator.state.selections.get(1)?.candidate, "苹果")
  })
})
