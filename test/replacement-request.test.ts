import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ReplacementRequestCoordinator } from "../src/game/replacement-request"

const applicant = { userId: "grace", nickname: "Grace" }

describe("replacement request coordinator", () => {
  it("moves from host approval to seat selection and a ready fixed seat", () => {
    const request = new ReplacementRequestCoordinator()
    request.begin(applicant, 10_000, 1_000, false)
    assert.equal(request.phase, "awaiting-host")
    assert.deepEqual(request.applicant, applicant)

    request.awaitSeatChoice(10_000, 2_000, false)
    assert.equal(request.phase, "awaiting-seat")
    assert.equal(request.remainingMs, 10_000)
    request.selectSeat(4)
    assert.equal(request.phase, "ready")
    assert.equal(request.selectedSeat, 4)

    request.reset()
    assert.equal(request.phase, "idle")
    assert.equal(request.applicant, null)
  })

  it("pauses only blocked wall-clock intervals and expires with the applicant snapshot", () => {
    const request = new ReplacementRequestCoordinator()
    request.begin(applicant, 10_000, 1_000, false)
    assert.deepEqual(request.tick(4_000, false), {
      kind: "waiting",
      nextDelayMs: 1_000,
    })
    assert.equal(request.remainingMs, 7_000)

    request.tick(6_000, true)
    assert.equal(request.remainingMs, 7_000)
    request.tick(20_000, true)
    assert.equal(request.remainingMs, 7_000)
    request.tick(21_000, false)
    assert.equal(request.remainingMs, 7_000)
    assert.deepEqual(request.tick(28_000, false), {
      kind: "expired",
      applicant,
    })
    assert.equal(request.hasPending, false)
  })

  it("rejects overlapping requests and illegal phase transitions", () => {
    const request = new ReplacementRequestCoordinator()
    request.begin(applicant, 10_000, 0, false)
    assert.throws(
      () => request.begin({ userId: "heidi", nickname: "Heidi" }, 10_000, 0, false),
      /already pending/,
    )
    request.awaitSeatChoice(10_000, 0, false)
    assert.throws(() => request.awaitSeatChoice(10_000, 0, false), /Expected replacement phase/)
    request.selectSeat(3)
    assert.throws(() => request.selectSeat(4), /Cannot select/)
  })
})
