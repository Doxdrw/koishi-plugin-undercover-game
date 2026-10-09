import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  snapshotEliminationContext,
  snapshotRoundContext,
  snapshotVoteContext,
} from "../src/game/resolution-context"

describe("structured resolution context snapshots", () => {
  it("copies vote arrays for stable semantic traces", () => {
    const activeSeats = [1, 2, 3]
    const poll = [2, 1, 0]
    const snapshot = snapshotVoteContext({
      gameEpoch: 4,
      round: 2,
      overtime: false,
      activeSeats,
      voterSeats: activeSeats,
      ballots: [2, 1, undefined],
      poll,
      max: 2,
      runnerUp: 1,
      leaderSeats: [1],
      requiredInfluence: 1,
    })
    activeSeats.pop()
    poll[0] = 99
    assert.deepEqual(snapshot.activeSeats, [1, 2, 3])
    assert.deepEqual(snapshot.poll, [2, 1, 0])
  })

  it("copies elimination arrays while preserving its cause", () => {
    const activeSeats = [1, 2, 3]
    const snapshot = snapshotEliminationContext({
      gameEpoch: 4,
      round: 2,
      source: "hero",
      targetSeat: 3,
      activeSeats,
      chainDepth: 1,
      causedByHero: "ZHANG_XIAN_ZHONG",
    })
    activeSeats.pop()
    assert.deepEqual(snapshot.activeSeats, [1, 2, 3])
    assert.equal(snapshot.causedByHero, "ZHANG_XIAN_ZHONG")
  })

  it("keeps a vote elimination target as a fixed seat when roster indexes shift", () => {
    const activeSeats = [2, 4, 6]
    const snapshot = snapshotEliminationContext({
      gameEpoch: 5,
      round: 3,
      source: "vote",
      targetSeat: 4,
      activeSeats,
      chainDepth: 0,
    })
    activeSeats.splice(0, 1)
    assert.equal(snapshot.targetSeat, 4)
    assert.deepEqual(snapshot.activeSeats, [2, 4, 6])
    assert.equal(snapshot.activeSeats.indexOf(snapshot.targetSeat), 1)
  })

  it("copies active and eliminated round seats", () => {
    const activeSeats = [1, 2]
    const eliminatedSeats = [3]
    const snapshot = snapshotRoundContext({
      gameEpoch: 4,
      round: 3,
      activeSeats,
      eliminatedSeats,
    })
    activeSeats.pop()
    eliminatedSeats.push(4)
    assert.deepEqual(snapshot.activeSeats, [1, 2])
    assert.deepEqual(snapshot.eliminatedSeats, [3])
  })
})
