import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { removeRosterSeat } from "../src/game/roster-service"

describe("fixed-seat roster removal", () => {
  it("removes one kicked player from every active and fixed-seat view", () => {
    const state = {
      activeUserIds: ["u1", "u2", "u3"],
      activeNames: ["Alice", "Bob", "Carol"],
      fixedNames: ["Alice", "Bob", "Carol"],
      fixedUserIds: ["u1", "u2", "u3"],
      activeSeats: [1, 2, 3],
      activeUndercoverSeats: [2],
      whiteSeat: 3,
      whiteActive: true,
      whiteOnly: false,
    }
    const result = removeRosterSeat(state, {
      seat: 2,
      kicked: true,
      checkWhiteOnly: true,
    })

    assert.deepEqual(state.activeUserIds, ["u1", "u3"])
    assert.deepEqual(state.activeNames, ["Alice", "Carol"])
    assert.deepEqual(state.activeSeats, [1, 3])
    assert.deepEqual(state.activeUndercoverSeats, [])
    assert.deepEqual(state.fixedNames, ["Alice", "", "Carol"])
    assert.deepEqual(state.fixedUserIds, ["u1", "", "u3"])
    assert.deepEqual(result, {
      activeIndex: 1,
      departingName: "Bob",
      departingUserId: "u2",
      whiteSeat: 3,
      whiteActive: true,
      whiteOnly: true,
    })
  })

  it("keeps fixed identity after elimination and clears an eliminated white seat", () => {
    const state = {
      activeUserIds: ["u1", "u2"],
      activeNames: ["Alice", "Bob"],
      fixedNames: ["Alice", "Bob"],
      fixedUserIds: ["u1", "u2"],
      activeSeats: [1, 2],
      activeUndercoverSeats: [1],
      whiteSeat: 2,
      whiteActive: true,
      whiteOnly: false,
    }
    const result = removeRosterSeat(state, {
      seat: 2,
      kicked: false,
      checkWhiteOnly: true,
    })

    assert.deepEqual(state.fixedNames, ["Alice", "Bob"])
    assert.deepEqual(state.fixedUserIds, ["u1", "u2"])
    assert.equal(result.whiteSeat, 0)
    assert.equal(result.whiteActive, false)
    assert.equal(result.whiteOnly, false)
  })

  it("does not activate white survival when the caller excludes this overtime window", () => {
    const state = { activeUserIds: ['u1', 'u2', 'u3', 'u4'], activeNames: ['A', 'B', 'C', 'D'],
      fixedNames: ['A', 'B', 'C', 'D'], fixedUserIds: ['u1', 'u2', 'u3', 'u4'],
      activeSeats: [1, 2, 3, 4], activeUndercoverSeats: [2], whiteSeat: 4,
      whiteActive: true, whiteOnly: false }
    assert.equal(removeRosterSeat(state, { seat: 2, kicked: true, checkWhiteOnly: false }).whiteOnly, false)
  })

  it("rejects a non-active seat instead of corrupting the last player", () => {
    const state = {
      activeUserIds: ["u1"],
      activeNames: ["Alice"],
      fixedNames: ["Alice"],
      fixedUserIds: ["u1"],
      activeSeats: [1],
      activeUndercoverSeats: [],
      whiteSeat: 0,
      whiteActive: false,
      whiteOnly: false,
    }
    assert.throws(() => removeRosterSeat(state, {
      seat: 2,
      kicked: false,
      checkWhiteOnly: false,
    }), /Seat 2 is not active/)
    assert.deepEqual(state.activeSeats, [1])
  })
})
