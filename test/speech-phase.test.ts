import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SpeechPhaseCoordinator } from "../src/game/speech-phase"

describe("fixed-seat speech phases", () => {
  it("invalidates overtime callbacks before a new regular round", () => {
    const phases = new SpeechPhaseCoordinator()
    const overtime = phases.begin({
      gameEpoch: 3,
      round: 1,
      kind: "overtime",
      eligibleSeats: [5, 6],
    })
    const regular = phases.begin({
      gameEpoch: 3,
      round: 2,
      kind: "regular",
      eligibleSeats: [1, 2, 3, 4, 5, 6],
    })

    assert.equal(phases.matches(overtime), false)
    assert.equal(phases.matches(regular), true)
    assert.deepEqual(phases.current()?.eligibleSeats, [1, 2, 3, 4, 5, 6])
  })

  it("invalidates the active phase on cleanup", () => {
    const phases = new SpeechPhaseCoordinator()
    const phase = phases.begin({ gameEpoch: 1, round: 1, kind: "regular", eligibleSeats: [1] })
    phases.invalidate()
    assert.equal(phases.matches(phase), false)
    assert.equal(phases.current(), undefined)
  })
})
