import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createHeroStateStore } from '../src/game/hero-state'
import { HERO } from '../src/heroes'
import { resetNativeHeroState } from '../src/game/hero-reset'
import { yuanChongHuanModule as yuan } from '../src/heroes/yuan-chong-huan'
import { linDanHanModule as lin } from '../src/heroes/lin-dan-han'

it('keeps guard editable until final locking and does not retain an abandoned retaliation', () => {
  const state = createHeroStateStore()
  yuan.beginVoteWindow(state, 7)
  yuan.selectGuard(state, 2)
  yuan.recordGuardedAttack(state, 2, 1, 1)
  assert.equal(yuan.retaliationTarget(state), null)
  yuan.selectGuard(state, 3)
  assert.equal(yuan.lockVoteWindow(state, 7, 1)?.effective, true)
  assert.equal(yuan.retaliationTarget(state), null)
  assert.equal(yuan.isVoteWindowOpen(state, 7), false)
  assert.equal(yuan.lockVoteWindow(state, 7, 1), null)
})

it('consumes self guard only when finally selected, and native reset preserves extra uses', () => {
  const state = createHeroStateStore()
  yuan.beginVoteWindow(state, 1)
  yuan.selectGuard(state, 1)
  yuan.abandonGuard(state)
  yuan.lockVoteWindow(state, 1, 1)
  assert.equal(yuan.selfGuardUses(state, 1), 1)
  yuan.beginVoteWindow(state, 2)
  yuan.selectGuard(state, 1)
  yuan.lockVoteWindow(state, 2, 1)
  assert.equal(yuan.selfGuardUses(state, 1), 0)
  yuan.grantExtraSelfGuard(state, 1)
  resetNativeHeroState(state, HERO.YUAN_CHONG_HUAN)
  assert.equal(yuan.selfGuardUses(state, 1), 2)
})

it('records numerical awakening eligibility without a temporary guard and commits against final protection', () => {
  for (const shielded of [false, true]) {
    const state = createHeroStateStore()
    lin.recordVoteAwakening(state, 3, { heroActive: true, heroPoll: 2, preventedVotePower: 1, maximumPoll: 2, unvote: 0, shielded: true })
    assert.equal(lin.isAwakened(state), false)
    assert.equal(lin.finalizeVoteAwakening(state, 3, { heroActive: true, heroPoll: 0, preventedVotePower: 1, maximumPoll: 1, unvote: 0, shielded }), !shielded)
  }
})

it('does not carry a pending awakening across a reset or another voting phase', () => {
  const state = createHeroStateStore()
  const input = { heroActive: true, heroPoll: 0, preventedVotePower: 4, maximumPoll: 2, unvote: 0, shielded: false }
  lin.recordVoteAwakening(state, 1, input)
  resetNativeHeroState(state, HERO.LIN_DAN_HAN)
  assert.equal(lin.finalizeVoteAwakening(state, 1, { ...input, preventedVotePower: 0 }), false)
  lin.recordVoteAwakening(state, 2, input)
  assert.equal(lin.finalizeVoteAwakening(state, 3, { ...input, preventedVotePower: 0 }), false)
})
