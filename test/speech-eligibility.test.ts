import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isEligibleSpeechSeat } from "../src/game/speech-eligibility"

describe("fixed-seat speech eligibility", () => {
  it("allows every active seat during an ordinary speech round", () => {
    assert.equal(isEligibleSpeechSeat({
      seat: 2,
      activeSeats: [1, 2, 4],
      overtime: false,
      overtimeSeats: [],
    }), true)
  })

  it("allows only active overtime seats during overtime speech", () => {
    const input = {
      activeSeats: [1, 2, 4, 5],
      overtime: true,
      overtimeSeats: [4, 5],
    } as const
    assert.equal(isEligibleSpeechSeat({ ...input, seat: 4 }), true)
    assert.equal(isEligibleSpeechSeat({ ...input, seat: 2 }), false)
    assert.equal(isEligibleSpeechSeat({ ...input, seat: 3 }), false)
  })
})
