import assert from 'node:assert/strict'
import { it } from 'node:test'
import { captureVoteFacts } from '../src/game/vote-facts'

it('captures skipped, pending, locked and invalidated ballots without consulting later state', () => {
  const facts = captureVoteFacts({ voterIds: ['a', 'b', 'c', 'd', 'e'], ballots: [2, undefined, undefined, -1, undefined],
    playerIds: ['a', 'b', 'c', 'd', 'e'], seats: [1, 2, 3, 4, 5], names: ['A', 'B', 'C', 'D', 'E'],
    weights: [3, 0, 1, 1, 1], maoSeat: 5, closed: false, lockedSeats: new Set([4]),
    effects: [{ voterSeat: 1, targetSeat: 2, weight: 3, countedWeight: 0, invalidReasons: ['zhu-you-xiao-delegation'] }] })
  assert.deepEqual(facts.map(f => f.status), ['vote', 'skip', 'pending', 'locked', 'skip'])
  assert.equal(facts[0].weight, 3)
  assert.deepEqual(facts[0].invalidReasons, ['zhu-you-xiao-delegation'])
  assert.equal(facts[0].countedWeight, 0)
})
