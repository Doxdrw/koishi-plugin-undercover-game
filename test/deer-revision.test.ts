import assert from 'node:assert/strict'
import { it } from 'node:test'
import { DeerRevisionCoordinator } from '../src/game/deer-revision'

it('keeps submitted reviews valid after the application cutoff and rejects obsolete versions', () => {
  const state = new DeerRevisionCoordinator()
  state.beginReview({ seat: 1, userId: 'alice', version: 2, records: [] })
  state.closeApplications()
  assert.equal(state.finishReview(1, 'alice', 1), undefined)
  assert.equal(state.finishReview(1, 'bob', 2), undefined)
  assert.equal(state.finishReview(1, 'alice', 2)?.version, 2)
})
it('uses the later deadline and waits for the next speech phase without extending on every round', () => {
  const state = new DeerRevisionCoordinator()
  const task = state.requestMakeup({ seat: 1, userId: 'alice', version: 2, round: 1, now: 10, durationMs: 120 })
  assert.equal(state.deadline(task), Infinity)
  state.noteSpeechDeadline(2, 100)
  assert.equal(state.deadline(task), 130)
  state.noteSpeechDeadline(2, 200)
  assert.equal(state.deadline(task), 200)
  state.noteSpeechDeadline(3, 500)
  assert.equal(state.deadline(task), 200)
  assert.equal(state.complete(1, 'alice', 1), undefined)
  assert.equal(state.complete(1, 'alice', 2)?.round, 1)
})
it('supports unlimited speech or makeup time and clears all pending state on reset', () => {
  const state = new DeerRevisionCoordinator()
  const task = state.requestMakeup({ seat: 1, userId: 'alice', version: 1, round: 1, now: 0, durationMs: 0, referencePhase: 1, referenceDeadline: 100 })
  assert.equal(state.deadline(task), Infinity)
  state.reset()
  assert.equal(state.applicationsClosed, false)
  assert.deepEqual(state.pendingMakeups(), [])
})
it('archives a departed identity without giving its obligations to a different replacement', () => {
  const state = new DeerRevisionCoordinator()
  state.beginReview({ seat: 1, userId: 'alice', version: 2, records: [], deadlineAt: 100 })
  state.suspend(1, 'person-a', 20)
  assert.equal(state.review(1), undefined)
  assert.equal(state.restore(1, 'person-b', 'bob', 2, 30), false)
  assert.equal(state.restore(1, 'person-a', 'alice-alt', 2, 50), true)
  assert.equal(state.review(1)?.userId, 'alice-alt')
  assert.equal(state.review(1)?.deadlineAt, 130)
})
