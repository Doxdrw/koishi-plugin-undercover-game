import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { GameTimerManager, GameTimerHandle } from "../src/game/game-timer-manager"

interface FakeTimer {
  readonly id: number
  readonly callback: () => void
  cancelled: boolean
  cancelCount: number
}

function createFakeClock() {
  let nextId = 0
  const timers: FakeTimer[] = []
  return {
    timers,
    schedule(callback: () => void): GameTimerHandle {
      const timer = { id: ++nextId, callback, cancelled: false, cancelCount: 0 }
      timers.push(timer)
      return timer as unknown as GameTimerHandle
    },
    cancel(handle: GameTimerHandle): void {
      const timer = handle as unknown as FakeTimer
      timer.cancelled = true
      timer.cancelCount += 1
    },
  }
}

const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))

describe("game timer manager", () => {
  it("runs callbacks only in the active epoch", async () => {
    const clock = createFakeClock()
    let active = true
    let calls = 0
    const manager = new GameTimerManager({
      isActive: () => active,
      onError: assert.fail,
      schedule: callback => clock.schedule(callback),
      cancel: handle => clock.cancel(handle),
    })

    manager.advanceEpoch()
    manager.schedule(() => { calls += 1 }, 100)
    clock.timers[0].callback()
    await flushPromises()
    assert.equal(calls, 1)

    manager.schedule(() => { calls += 1 }, 100)
    const stale = clock.timers[1]
    manager.advanceEpoch()
    assert.equal(stale.cancelled, true)
    stale.callback()
    await flushPromises()
    assert.equal(calls, 1)

    manager.schedule(() => { calls += 1 }, 100)
    active = false
    clock.timers[2].callback()
    await flushPromises()
    assert.equal(calls, 1)
  })

  it("cancels individual timers and reports only current callback failures", async () => {
    const clock = createFakeClock()
    const failures: unknown[] = []
    const manager = new GameTimerManager({
      isActive: () => true,
      onError: error => failures.push(error),
      schedule: callback => clock.schedule(callback),
      cancel: handle => clock.cancel(handle),
    })
    manager.advanceEpoch()

    const cancelled = manager.schedule(() => assert.fail("cancelled callback ran"), 100)
    manager.cancel(cancelled)
    assert.equal(clock.timers[0].cancelled, true)
    manager.cancelAll()
    assert.equal(clock.timers[0].cancelCount, 1)

    manager.schedule(() => { throw new Error("current failure") }, 100)
    clock.timers[1].callback()
    await flushPromises()
    assert.equal((failures[0] as Error).message, "current failure")

    manager.schedule(async () => {
      await flushPromises()
      throw new Error("stale failure")
    }, 100)
    clock.timers[2].callback()
    manager.advanceEpoch()
    await flushPromises()
    await flushPromises()
    assert.equal(failures.length, 1)
  })
})
