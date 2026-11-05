import assert from 'node:assert/strict'
import { it } from 'node:test'
import { HostSupportCoordinator } from '../src/game/host-support'

const request = (key: string, pending = () => true) => ({ key, pending, resume() {}, fallback() {} })
it('merges requests and excludes everyone who previously occupied a seat', () => {
  const support = new HostSupportCoordinator()
  support.recordParticipant('former')
  const first = support.request(request('one'))
  assert.equal(first.kind, 'opened')
  const second = support.request(request('two'))
  assert.deepEqual(second, { kind: 'joined', window: support.activeWindow })
  assert.deepEqual(support.request(request('one')), second, 'an existing request keeps waiting for the shared window')
  assert.equal(support.claim('former'), undefined)
  const window = support.claim('observer')!
  assert.equal(support.claim('other'), undefined)
  assert.equal(support.grant('observer', window)?.length, 2)
  assert.equal(support.isAssistant('observer'), true)
  assert.equal(support.request(request('one')).kind, 'fallback')
})
it('allows recovery after a failed private delivery and rejects stale claim or ended requests', () => {
  const support = new HostSupportCoordinator()
  let pending = true
  support.request(request('one', () => pending))
  const window = support.claim('observer')!
  support.releaseClaim('observer', window)
  assert.equal(support.claim('other'), window)
  pending = false
  assert.equal(support.grant('other', window), undefined)
  assert.equal(support.isAssistant('other'), false)
  support.reset()
  assert.deepEqual(support.expire(window), [])
  assert.equal(support.request(request('one')).kind, 'opened')
})
