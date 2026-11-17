import assert from 'node:assert/strict'
import { it } from 'node:test'
import { ModeInteractionCoordinator } from '../src/game/game-mode'

function fixture() {
  const mode = new ModeInteractionCoordinator()
  mode.reset('deer'); mode.configureDeer('红色', '黄色', '苹果')
  mode.syncDeerRoster([{ seat: 1, userId: 'alice', nickname: 'Alice', identityKey: 'person-a' }], 0)
  return mode
}

it('replaces an unreviewed proposal and rejects stale review references', () => {
  const mode = fixture()
  assert.equal(mode.submitDeerSelection('alice', '草莓').kind, 'accepted')
  mode.recordDeerRequestMessage(1, ['old'], 'old request')
  assert.equal(mode.submitDeerSelection('alice', '樱桃').kind, 'accepted')
  assert.equal(mode.reviewDeerSelection({ requestMessageId: 'old', approved: true }).kind, 'superseded')
  assert.equal(mode.reviewDeerSelection({ seat: 1, approved: true }).kind, 'approved')
  assert.equal(mode.deerApprovedCandidate(1), '樱桃')
})

it('keeps the approved word effective while a new explicit proposal is pending or rejected', () => {
  const mode = fixture()
  mode.submitDeerSelection('alice', '草莓'); mode.reviewDeerSelection({ seat: 1, approved: true })
  assert.equal(mode.submitDeerSelection('alice', '樱桃').kind, 'approved')
  assert.equal(mode.submitDeerSelection('alice', '选词：樱桃').kind, 'accepted')
  assert.equal(mode.deerApprovedCandidate(1), '草莓')
  assert.equal(mode.deerAllApproved(), true)
  mode.reviewDeerSelection({ seat: 1, approved: false })
  assert.equal(mode.deerApprovedCandidate(1), '草莓')
  mode.submitDeerSelection('alice', '选人：樱桃')
  const result = mode.reviewDeerSelection({ seat: 1, approved: true })
  assert.equal(result.kind, 'approved')
  if (result.kind === 'approved') assert.equal(result.previousCandidate, '草莓')
  assert.equal(mode.deerApprovedCandidate(1), '樱桃')
})

it('restores each returning person at the fixed seat without inheriting another persons word', () => {
  const mode = fixture()
  mode.submitDeerSelection('alice', '草莓'); mode.reviewDeerSelection({ seat: 1, approved: true })
  mode.removeDeerSeat(1)
  mode.syncDeerRoster([{ seat: 1, userId: 'bob', nickname: 'Bob', identityKey: 'person-b' }], 0)
  assert.equal(mode.deerApprovedCandidate(1), undefined)
  mode.submitDeerSelection('bob', '樱桃'); mode.reviewDeerSelection({ seat: 1, approved: true })
  mode.removeDeerSeat(1)
  mode.syncDeerRoster([{ seat: 1, userId: 'alice-alt', nickname: 'Alice renamed', identityKey: 'person-a' }], 0)
  assert.equal(mode.deerApprovedCandidate(1), '草莓')
  assert.equal(mode.deerSelectionForSeat(1)?.userId, 'alice-alt')
  assert.equal(mode.submitDeerSelection('alice-alt', '杏').kind, 'approved')
})

it('retains pending proposals across a return but clears obsolete delivery references', () => {
  const mode = fixture()
  mode.submitDeerSelection('alice', '草莓'); mode.recordDeerRequestMessage(1, ['old'])
  const version = mode.deerSelectionForSeat(1)!.version
  mode.removeDeerSeat(1)
  mode.syncDeerRoster([{ seat: 1, userId: 'alice', nickname: 'Alice', identityKey: 'person-a' }], 0)
  assert.equal(mode.deerSelectionForSeat(1)?.status, 'pending-host')
  assert.equal(mode.deerSelectionForSeat(1)?.version, version)
  assert.equal(mode.deerSelectionForSeat(1)?.requestMessageIds, undefined)
  mode.submitDeerSelection('alice', '樱桃')
  assert.equal(mode.recordDeerRequestMessage(1, ['late-old'], undefined, version), false)
})
