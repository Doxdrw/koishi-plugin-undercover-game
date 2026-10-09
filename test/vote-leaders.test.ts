import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { calculateVoteLeaders, decideMaoWenLongLateVote } from "../src/game/vote-leaders"

describe("vote leader calculation", () => {
  it("finds a unique leader and the true runner-up", () => {
    assert.deepEqual(calculateVoteLeaders({
      poll: [1, 4, 2, 0],
      activeSeats: [1, 3, 4, 6],
      playerNames: ["甲", "乙", "丙", "丁"],
    }), {
      maximum: 4,
      runnerUp: 2,
      leaderIndices: [1],
      firstLeaderIndex: 1,
      leaderDescription: "3号玩家乙",
      requiredInfluence: 2,
    })
  })

  it("keeps every tied leader and reports zero required influence", () => {
    const result = calculateVoteLeaders({
      poll: [3, 1, 3, 0],
      activeSeats: [2, 3, 5, 6],
      playerNames: ["甲", "乙", "丙", "丁"],
    })
    assert.deepEqual(result.leaderIndices, [0, 2])
    assert.equal(result.runnerUp, 3)
    assert.equal(result.leaderDescription, "2号玩家甲，5号玩家丙")
    assert.equal(result.requiredInfluence, 0)
  })

  it("preserves the legacy single-player infinity result", () => {
    const result = calculateVoteLeaders({
      poll: [0],
      activeSeats: [4],
      playerNames: ["甲"],
    })
    assert.equal(result.runnerUp, -Infinity)
    assert.equal(result.requiredInfluence, Infinity)
  })
})

describe("Mao Wenlong late-vote decision", () => {
  const input = {
    activeSeats: [1, 2, 3, 4],
    overtime: false,
    overtimeCandidateSeats: [] as number[],
    maoWenLongSeat: 1,
    requiredInfluence: 3,
    votePower: 1,
    fa: 1,
    totalQuan: 1,
  }

  it("prompts when Mao Wenlong can tie the current lead", () => {
    assert.equal(decideMaoWenLongLateVote(input), "prompt")
  })

  it("reports when his available influence is insufficient", () => {
    assert.equal(decideMaoWenLongLateVote({ ...input, requiredInfluence: 4 }), "cannot-affect")
  })

  it("skips an inactive Mao Wenlong", () => {
    assert.equal(decideMaoWenLongLateVote({ ...input, activeSeats: [2, 3, 4] }), "not-eligible")
  })

  it("skips Mao Wenlong when he is an overtime candidate", () => {
    assert.equal(decideMaoWenLongLateVote({
      ...input,
      overtime: true,
      overtimeCandidateSeats: [1, 2],
    }), "not-eligible")
  })
})
