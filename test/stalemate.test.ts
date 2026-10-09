import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createHeroStateStore } from '../src/game/hero-state'
import { isStalemateEligible, StalemateTracker } from '../src/game/stalemate'
import { linDanHanModule } from '../src/heroes/lin-dan-han'

it('counts white as non-undercover and requires all permanent undercover targets to be lost', () => {
  const state = createHeroStateStore()
  linDanHanModule.initializeRealityRecords(state, [1, 2, 3, 5, 6], 1)
  assert.equal(isStalemateEligible([1, 2, 5, 6], [5, 6], 1, state), true)
  assert.equal(isStalemateEligible([1, 2, 3, 5, 6], [5, 6], 1, state), false)
  linDanHanModule.protectFromSkill(state, 5)
  assert.equal(isStalemateEligible([1, 2, 3, 5, 6], [5, 6], 1, state), false)
  linDanHanModule.protectFromSkill(state, 6)
  // The classifier deliberately needs no distinction between white and good Lin.
  assert.equal(isStalemateEligible([1, 2, 3, 5, 6], [5, 6], 1, state), true)
  assert.equal(isStalemateEligible([1, 2, 3, 5, 6], [1, 6], 1, state), false)
  assert.equal(isStalemateEligible([2, 3, 4, 5, 6], [5, 6], 1, state), false)
  assert.equal(isStalemateEligible([1, 2, 3, 4, 5, 6], [5, 6], 1, state), false)
  assert.equal(isStalemateEligible([1], [], 1, state), false)
})

it('does not infer awakening or consume a pending attack while inspecting eligibility', () => {
  const state = createHeroStateStore()
  state.linDanHan.realityRecords = []
  assert.equal(isStalemateEligible([1, 2, 3], [3], 1, state), false)
  linDanHanModule.awaken(state)
  state.linDanHan.realityRecords = [-3]
  assert.equal(isStalemateEligible([1, 2, 3], [3], 1, state), false)
  assert.deepEqual(state.linDanHan.realityRecords, [-3])
})

it('counts distinct consecutive final rounds, resetting on nonqualifying nights and roster changes', () => {
  const tracker = new StalemateTracker()
  assert.equal(tracker.recordSafeNight(1, true), false)
  assert.equal(tracker.recordSafeNight(1, true), false)
  assert.equal(tracker.recordSafeNight(2, true), true)
  tracker.reset()
  assert.equal(tracker.recordSafeNight(3, true), false)
  assert.equal(tracker.recordSafeNight(4, false), false)
  assert.equal(tracker.recordSafeNight(5, true), false)
  tracker.reset()
  assert.equal(tracker.recordSafeNight(6, true), false)
  assert.equal(tracker.recordSafeNight(8, true), false)
  assert.equal(tracker.recordSafeNight(7, true), false)
  assert.equal(tracker.recordSafeNight(9, true), true)
})
