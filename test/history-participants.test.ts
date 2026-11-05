import assert from 'node:assert/strict'
import { it } from 'node:test'
import { projectHistoryParticipants } from '../src/game/history-participants'
import type { HistoryParticipant } from '../src/game/history-snapshot'

function participant(seat: number, userId: string, tenureId: string, personId?: number): HistoryParticipant {
  return { seat, tenureId, joinedAt: 1, initialCamp: 'good', finalCamp: 'good', heroId: null,
    identity: { platform: 'test', userId, nickname: '同名', ...(personId === undefined ? {} : { personId }) } }
}

it('orders final seats first and retains distinct former players without changing source authorship', async () => {
  const rows = [participant(2, 'b', 'b'), participant(1, 'a', 'a'), participant(3, 'c', 'c'), participant(1, 'd', 'd')]
  const roster = await projectHistoryParticipants(rows)
  assert.deepEqual(roster.current.map(p => p.tenureId), ['d', 'b', 'c'])
  assert.deepEqual(roster.former.map(p => p.tenureId), ['a'])
  assert.deepEqual(rows.map(p => p.tenureId), ['b', 'a', 'c', 'd'])
})

it('deduplicates returning players and linked accounts but not anonymous records', async () => {
  const rows = [participant(1, 'a', 'a1', 10), participant(1, 'b', 'b'), participant(1, 'alt-a', 'a2', 11)]
  const roster = await projectHistoryParticipants(rows, async () => 10)
  assert.deepEqual(roster.current.map(p => p.tenureId), ['a2'])
  assert.deepEqual(roster.former.map(p => p.tenureId), ['b'])
  const anonymous = [participant(1, '', 'x'), participant(1, '', 'y')]
  assert.deepEqual((await projectHistoryParticipants(anonymous)).former.map(p => p.tenureId), ['x'])
  assert.deepEqual((await projectHistoryParticipants([participant(1, 'a', 'a1'), participant(1, 'a', 'a2')])).former, [])
})
