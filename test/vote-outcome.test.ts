import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { classifyVoteOutcome } from "../src/game/vote-outcome"

function classify(overrides: Partial<Parameters<typeof classifyVoteOutcome>[0]> = {}) {
  return classifyVoteOutcome({
    poll: [3, 1, 2, 0, 0, 0],
    maximum: 3,
    activeSeats: [1, 2, 3, 4, 5, 6],
    playerNames: ["甲", "乙", "丙", "丁", "戊", "己"],
    shieldsBySeat: [false, false, false, false, false, false],
    overtime: false,
    ...overrides,
  })
}

describe("final vote outcome classification", () => {
  it("selects one unshielded leader for elimination", () => {
    assert.deepEqual(classify().candidateIndices, [0])
    assert.equal(classify().kind, "elimination")
  })

  it("filters shielded leaders and preserves their display order", () => {
    const result = classify({
      poll: [3, 3, 1, 0, 0, 0],
      shieldsBySeat: [true, false, false, false, false, false],
    })
    assert.deepEqual(result.candidateIndices, [1])
    assert.deepEqual(result.shieldedIndices, [0])
    assert.equal(result.shieldedDescription, "1号玩家甲")
    assert.equal(result.kind, "elimination")
  })

  it("makes a safe night when every leader is shielded", () => {
    assert.equal(classify({ shieldsBySeat: [true, false, false, false, false, false] }).kind, "safe-night")
  })

  it("enters overtime for a non-majority regular tie", () => {
    assert.equal(classify({ poll: [2, 2, 0, 0, 0, 0], maximum: 2 }).kind, "overtime")
  })

  it("makes a safe night for majority ties and any overtime tie", () => {
    assert.equal(classify({ poll: [2, 2, 2, 2, 0, 0], maximum: 2 }).kind, "safe-night")
    assert.equal(classify({ poll: [2, 2, 0, 0, 0, 0], maximum: 2, overtime: true }).kind, "safe-night")
  })
})
