import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { retainBallotsAfterRosterChange } from "../src/game/vote-roster"

describe("ballots retained after roster changes", () => {
  it("associates ballots by user ID across removal and reordering", () => {
    const result = retainBallotsAfterRosterChange({
      previous: {
        voterIds: ["alice", "bob", "carol"],
        ballots: [3, 0, -1],
      },
      voterIds: ["carol", "alice"],
      playerIds: ["alice", "carol"],
      playerOrder: [1, 3],
      validTargetsBySeat: seat => seat === 1 ? [3] : [1],
    })
    assert.deepEqual(result.ballots, [-1, 3])
    assert.deepEqual([...result.invalidatedVoterIds], [])
  })

  it("invalidates only positive ballots whose targets are no longer legal", () => {
    const result = retainBallotsAfterRosterChange({
      previous: {
        voterIds: ["alice", "bob"],
        ballots: [3, 1],
      },
      voterIds: ["alice", "bob", "grace"],
      playerIds: ["alice", "bob", "grace"],
      playerOrder: [1, 2, 4],
      validTargetsBySeat: seat => seat === 1 ? [2, 4] : [1, 2, 4].filter(target => target !== seat),
    })
    assert.equal(result.ballots[0], undefined)
    assert.equal(result.ballots[1], 1)
    assert.equal(result.ballots[2], undefined)
    assert.deepEqual([...result.invalidatedVoterIds], ["alice"])
  })

  it("automatically waives a voter who has no legal targets", () => {
    const result = retainBallotsAfterRosterChange({
      previous: { voterIds: ["alice"], ballots: [2] },
      voterIds: ["alice"],
      playerIds: ["alice"],
      playerOrder: [1],
      validTargetsBySeat: () => [],
    })
    assert.deepEqual(result.ballots, [0])
    assert.deepEqual(result.autoWaivedVoterIds, ["alice"])
    assert.deepEqual([...result.invalidatedVoterIds], ["alice"])
  })
})
