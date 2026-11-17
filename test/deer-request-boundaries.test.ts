import assert from 'node:assert/strict'
import { it } from 'node:test'
import { ModeInteractionCoordinator } from '../src/game/game-mode'

function fixture() {
  const mode = new ModeInteractionCoordinator()
  mode.reset('deer')
  mode.configureDeer('规则甲', '规则乙', '易混')
  mode.syncDeerRoster([{ seat: 1, userId: 'alice', nickname: 'Alice' }], 0)
  return mode
}

it('distinguishes superseded, processed and unknown references without touching the latest choice', () => {
  const mode = fixture()
  mode.submitDeerSelection('alice', '词甲')
  mode.recordDeerRequestMessage(1, ['old'], '旧提示', 1)
  mode.submitDeerSelection('alice', '词乙')
  mode.recordDeerRequestMessage(1, ['new'], '新提示', 2)
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'old', approved: true }).kind, 'superseded')
  assert.equal(mode.deerSelectionForSeat(1)?.status, 'pending-host')
  assert.equal(mode.deerSelectionForSeat(1)?.candidate, '词乙')
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'unknown', approved: true }).kind, 'not-found')
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'new', approved: true }).kind, 'approved')
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'new', approved: true }).kind, 'processed')
})

it('keeps every same-version copy valid and rejects references after reset or replacement', () => {
  const mode = fixture()
  mode.submitDeerSelection('alice', '词甲')
  mode.recordDeerRequestMessage(1, ['first'], '提示', 1)
  mode.recordDeerRequestMessage(1, ['copy'], '提示', 1)
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'first', approved: false }).kind, 'rejected')
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'copy', approved: true }).kind, 'processed')
  mode.submitDeerSelection('alice', '词乙')
  mode.recordDeerRequestMessage(1, ['reset'], '提示', 2)
  mode.resetDeerSelection(1)
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'reset', approved: true }).kind, 'inactive-reference')
  mode.submitDeerSelection('alice', '选词词丙')
  mode.recordDeerRequestMessage(1, ['left'], '提示', 4)
  mode.syncDeerRoster([{ seat: 1, userId: 'bob', nickname: 'Bob' }], 0)
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'left', approved: true }).kind, 'inactive-reference')
})

it('requires explicit choice input for a replacement without consuming ballots or skills', () => {
  const mode = fixture()
  mode.markDeerFirstRoundStarted()
  mode.syncDeerRoster([{ seat: 1, userId: 'bob', nickname: 'Bob' }], 0)
  for (const input of ['2', '弃', '伐1', '代1', '放2']) {
    assert.equal(mode.submitDeerSelection('bob', input).kind, 'explicit-required')
  }
  assert.equal(mode.submitDeerSelection('bob', '选词 词甲').kind, 'accepted')
})

it('does not attach a delayed old receipt to a same-content new submission', () => {
  const mode = fixture()
  mode.submitDeerSelection('alice', '词甲')
  mode.recordDeerRequestMessage(1, ['old'], '第一条提示', 1)
  mode.submitDeerSelection('alice', '词甲')
  assert.equal(mode.recordDeerRequestMessage(1, ['late'], '迟到提示', 1), false)
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'old', approved: true }).kind, 'superseded')
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'late', approved: true }).kind, 'not-found')
  assert.equal(mode.deerSelectionForSeat(1)?.version, 2)
  assert.equal(mode.deerSelectionForSeat(1)?.status, 'pending-host')
})
