import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { rebuildVoteState, RebuildVoteStateInput } from "../src/game/vote-ballots"

function input(overrides: Partial<RebuildVoteStateInput> = {}): RebuildVoteStateInput {
  return {
    overtime: false,
    voterIds: ["a", "b", "c", "d"],
    ballots: [2, 0, -1, 2],
    playerIds: ["a", "b", "c", "d"],
    playerOrder: [1, 2, 3, 4],
    votePower: [1, 1, 1, 2],
    undercoverSeats: [3],
    whiteSeat: 0,
    heroes: { linDanHanSeat: 0, shiKeFaSeat: 0, huangTaiJiSeat: 1 },
    linDanHan: { awakened: false, realityRecords: [] },
    huangTaiJiRegularTarget: 0,
    ...overrides,
  }
}

describe("vote state rebuilt from raw ballots", () => {
  it("rebuilds regular poll, waiver, and Huang Taiji's target", () => {
    const result = rebuildVoteState(input())
    assert.deepEqual(result.poll, [0, 3, 0, 0])
    assert.equal(result.waiver, 1)
    assert.equal(result.unvote, 0)
    assert.equal(result.skip, 0)
    assert.equal(result.huangTaiJiRegularTarget, 2)
  })

  it("records Shi Kefa teammate attackers without duplicates", () => {
    const result = rebuildVoteState(input({
      ballots: [3, 3, 2, 3],
      undercoverSeats: [3, 4],
      heroes: { linDanHanSeat: 0, shiKeFaSeat: 3, huangTaiJiSeat: 0 },
    }))
    assert.deepEqual(result.shiKeFaTeammateAttackers, [4])
  })

  it("replays Lin Dan Han protection and mutual-vote invalidation", () => {
    const result = rebuildVoteState(input({
      ballots: [2, 1, 2, 2],
      undercoverSeats: [],
      heroes: { linDanHanSeat: 1, shiKeFaSeat: 2, huangTaiJiSeat: 0 },
      linDanHan: { awakened: true, realityRecords: [2, -3, 4] },
    }))
    assert.deepEqual(result.linDanHanRealityRecords, [-2, 3, 4])
    assert.equal(result.linDanHanOwnVoteInvalidated, true)
    assert.deepEqual(result.shiKeFaTeammateAttackers, [3, 4])
    assert.deepEqual(result.poll, [0, 3, 0, 0])
  })

  it("keeps Huang Taiji's regular target in overtime only while it remains active", () => {
    assert.equal(rebuildVoteState(input({
      overtime: true,
      huangTaiJiRegularTarget: 3,
    })).huangTaiJiRegularTarget, 3)
    assert.equal(rebuildVoteState(input({
      overtime: true,
      playerIds: ["a", "b", "d"],
      playerOrder: [1, 2, 4],
      huangTaiJiRegularTarget: 3,
    })).huangTaiJiRegularTarget, 0)
  })
})
