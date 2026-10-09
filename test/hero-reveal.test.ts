import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PublicHeroRevealState } from '../src/game/hero-reveal'

describe('fixed-seat public hero reveals', () => {
  it('reveals once and retains the public state for a replacement at that seat', () => {
    const state = new PublicHeroRevealState()
    assert.equal(state.reveal(3), true)
    assert.equal(state.reveal(3), false)
    assert.equal(state.isRevealed(3), true)
    assert.deepEqual(state.seats(), [3])
  })

  it('sorts revealed seats and resets for a new game', () => {
    const state = new PublicHeroRevealState()
    state.reveal(5)
    state.reveal(1)
    assert.deepEqual(state.seats(), [1, 5])
    state.clear()
    assert.deepEqual(state.seats(), [])
  })
})
