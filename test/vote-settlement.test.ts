import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { VoteSettlementCoordinator } from "../src/game/vote-settlement"

describe("VoteSettlementCoordinator", () => {
  it("runs only one settlement while a phase is active", async () => {
    const coordinator = new VoteSettlementCoordinator()
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    let runs = 0

    const first = coordinator.run("1:1:regular", async () => {
      runs += 1
      await blocked
    })
    const duplicate = coordinator.run("1:1:regular", async () => {
      runs += 1
    })

    assert.equal(first, duplicate)
    assert.equal(coordinator.isRunning("1:1:regular"), true)
    assert.equal(runs, 0)
    await Promise.resolve()
    assert.equal(runs, 1)
    release()
    await first
    assert.equal(coordinator.isRunning(), false)
  })

  it("allows the next phase after the previous one completes", async () => {
    const coordinator = new VoteSettlementCoordinator()
    const calls: string[] = []
    await coordinator.run("1:1:regular", async () => { calls.push("regular") })
    await coordinator.run("1:1:overtime", async () => { calls.push("overtime") })
    assert.deepEqual(calls, ["regular", "overtime"])
  })
})
