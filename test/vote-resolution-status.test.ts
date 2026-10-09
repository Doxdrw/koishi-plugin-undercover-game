import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { getVoteResolutionStatus } from "../src/game/vote-resolution"
import type { VoteResolutionStatusInput } from "../src/game/vote-resolution"

function scenario(overrides: Partial<VoteResolutionStatusInput> = {}): VoteResolutionStatusInput {
  return {
    voterIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
    ballots: [2, 1, 1, 1, undefined, undefined],
    playerIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
    playerOrder: [1, 2, 3, 4, 5, 6],
    votePower: [1, 1, 1, 1, 1, 1],
    poll: [4, 1, 0, 0, 0, 0],
    fa: [0, 0, 0, 0, 0, 0],
    quan: [0, 0, 0, 0, 0, 0],
    maoWenLongSeat: 6,
    shiKeFa: {
      seat: 0,
      mode: "resistance-available",
      teammateAttackers: [],
      undercoverSeats: [],
      whiteSeat: 0,
    },
    duoErGunStrategyMark: { kind: "none" },
    ...overrides,
  }
}

describe("vote resolution status after roster changes", () => {
  it("finishes regular voting while leaving Mao Wenlong for the late-vote step", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      ballots: [2, 1, 1, 1, 1, undefined],
    })), "complete")
  })

  it("locks when every remaining influence is smaller than the unique lead", () => {
    assert.equal(getVoteResolutionStatus(scenario()), "locked")
  })

  it("waits when an ordinary pending vote can still tie the leader", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      poll: [3, 1, 0, 0, 0, 0],
    })), "pending")
  })

  it("never locks an already tied poll", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      poll: [2, 2, 0, 0, 0, 0],
    })), "pending")
  })

  it("counts Mao Wenlong, fa, and quan as possible remaining influence", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      poll: [5, 1, 0, 0, 0, 0],
      fa: [0, 0, 0, 0, 1, 0],
      quan: [0, 0, 0, 0, 1, 0],
    })), "pending")
  })

  it("applies Shi Kefa resistance before checking whether the result is locked", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      poll: [3, 0, 0, 0, 0, 0],
      shiKeFa: {
        seat: 1,
        mode: "resistance-available",
        teammateAttackers: [2],
        undercoverSeats: [1],
        whiteSeat: 0,
      },
    })), "pending")
  })

  it("does not reduce Shi Kefa when he voted for a teammate", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      ballots: [2, 1, 1, 1, undefined, undefined],
      poll: [3, 0, 0, 0, 0, 0],
      shiKeFa: {
        seat: 1,
        mode: "resistance-available",
        teammateAttackers: [2],
        undercoverSeats: [1, 2],
        whiteSeat: 0,
      },
    })), "locked")
  })

  it("applies Dorgon protection before checking whether the result is locked", () => {
    assert.equal(getVoteResolutionStatus(scenario({
      poll: [3, 0, 0, 0, 0, 0],
      duoErGunStrategyMark: { kind: "new", seat: 1 },
    })), "pending")
  })
})
