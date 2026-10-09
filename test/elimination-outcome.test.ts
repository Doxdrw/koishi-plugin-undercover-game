import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { classifyEliminationVictory } from "../src/game/elimination-outcome"

describe("post-elimination victory classification", () => {
  it("awards good only after every undercover and white player is gone", () => {
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 4,
      activeUndercoverCount: 0,
      whiteActive: false,
      whiteOnly: false,
    }), "good")
  })

  it("keeps a surviving white player alive until the legacy end condition", () => {
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 3,
      activeUndercoverCount: 0,
      whiteActive: true,
      whiteOnly: false,
    }), null)
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 3,
      activeUndercoverCount: 0,
      whiteActive: true,
      whiteOnly: true,
      whiteSurvivalSettled: true,
    }), "white")
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 2,
      activeUndercoverCount: 0,
      whiteActive: true,
      whiteOnly: false,
    }), "white")
  })

  it("does not confuse absence of undercover players with a completed white-survival vote", () => {
    assert.equal(classifyEliminationVictory({ activePlayerCount: 4, activeUndercoverCount: 0,
      whiteActive: true, whiteOnly: true, whiteSurvivalSettled: false }), null)
    assert.equal(classifyEliminationVictory({ activePlayerCount: 4, activeUndercoverCount: 0,
      whiteActive: true, whiteOnly: false, whiteSurvivalSettled: true }), null)
    assert.equal(classifyEliminationVictory({ activePlayerCount: 2, activeUndercoverCount: 0,
      whiteActive: true, whiteOnly: true, whiteSurvivalSettled: false }), 'white')
  })

  it("preserves strict parity and the special two-player undercover victory", () => {
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 4,
      activeUndercoverCount: 2,
      whiteActive: false,
      whiteOnly: false,
    }), null)
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 3,
      activeUndercoverCount: 2,
      whiteActive: false,
      whiteOnly: false,
    }), "undercover")
    assert.equal(classifyEliminationVictory({
      activePlayerCount: 2,
      activeUndercoverCount: 1,
      whiteActive: false,
      whiteOnly: false,
    }), "undercover")
  })
})
