import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { App } from 'koishi'
import SQLiteDriver from '@koishijs/plugin-database-sqlite'
import {
  createSubscriptionDeletionConsumer,
  registerSubscriptionModel,
  UndercoverSubscriptionService,
} from '../src/game/subscription-service'

const apps: App[] = []

afterEach(async () => {
  while (apps.length) await apps.pop()!.stop()
})

async function setup() {
  const app = new App({ autoAssign: true, autoAuthorize: 1 })
  app.plugin(SQLiteDriver, { path: ':memory:' })
  registerSubscriptionModel(app)
  await app.start()
  apps.push(app)
  return { app, service: new UndercoverSubscriptionService(app) }
}

describe('undercover subscription lifecycle', () => {
  it('reactivates presence-only legacy rows but preserves an administrator pause', async () => {
    const { app, service } = await setup()
    assert.equal(await service.subscribe('onebot', 'guild', 'alice'), 'created')
    assert.equal(await service.markExisting('onebot', 'guild', 'alice', 'inactive', 'member-removed'), true)
    assert.equal(await service.subscribe('onebot', 'guild', 'alice'), 'reactivated')
    const restored = await service.get('onebot', 'guild', 'alice')
    assert.equal(restored?.state, 'active')
    assert.equal(restored?.inactiveAt, null)
    assert.equal(await service.markExisting('onebot', 'guild', 'alice', 'inactive', 'manual-inactive'), true)
    assert.equal(await service.subscribe('onebot', 'guild', 'alice'), 'paused')
    assert.equal((await service.get('onebot', 'guild', 'alice'))?.reason, 'manual-inactive')
    assert.equal(await service.markExisting('onebot', 'guild', 'alice', 'active', 'manual-active'), true)
    assert.equal(await service.subscribe('onebot', 'guild', 'alice'), 'existing')
    assert.equal(await service.unsubscribe('onebot', 'guild', 'alice'), true)
    assert.equal(await service.get('onebot', 'guild', 'alice'), null)
    assert.equal((await app.database.get('undercover_subscription', {})).length, 0)
  })

  it('uses complete live membership without changing retained subscriptions', async () => {
    const { service } = await setup()
    await service.subscribe('onebot', 'guild', 'alice')
    await service.subscribe('onebot', 'guild', 'bob')
    await service.markExisting('onebot', 'guild', 'alice', 'inactive', 'member-removed')
    await service.markExisting('onebot', 'guild', 'bob', 'inactive', 'manual-inactive')
    const failingBot = {
      selfId: 'bot',
      async *getGuildMemberIter() {
        yield { user: { id: 'alice' } }
        throw new Error('page two failed')
      },
    }
    await assert.rejects(
      service.scanGuildMembers(failingBot as any, 'onebot', 'guild', true),
      /未修改任何订阅/,
    )
    assert.deepEqual((await service.list('onebot', 'guild')).map(row => row.reason), ['member-removed', 'manual-inactive'])

    const completeBot = {
      selfId: 'bot',
      async *getGuildMemberIter() {
        yield { user: { id: 'alice' } }
        yield { user: { id: 'bob' } }
      },
    }
    assert.deepEqual(await service.getCallableUserIds(completeBot as any, 'onebot', 'guild'), ['alice'])
    const inspection = await service.scanGuildMembers(completeBot as any, 'onebot', 'guild', true)
    assert.equal(inspection.callable, 1)
    assert.equal(inspection.manuallyPaused, 1)
    assert.equal(inspection.executeRequested, true)
    assert.deepEqual((await service.list('onebot', 'guild')).map(row => row.reason), ['member-removed', 'manual-inactive'])
  })

  it('shares only the current in-flight member read and retries after completion', async () => {
    const { service } = await setup()
    await service.subscribe('onebot', 'guild', 'alice')
    let reads = 0
    const bot = {
      selfId: 'bot',
      async *getGuildMemberIter() {
        reads += 1
        await new Promise<void>(resolve => setImmediate(resolve))
        yield { user: { id: 'alice' } }
      },
    }
    const [first, second] = await Promise.all([
      service.getCallableUserIds(bot as any, 'onebot', 'guild'),
      service.scanGuildMembers(bot as any, 'onebot', 'guild'),
    ])
    assert.deepEqual(first, ['alice'])
    assert.equal(second.callable, 1)
    assert.equal(reads, 1)
    assert.deepEqual(await service.getCallableUserIds(bot as any, 'onebot', 'guild'), ['alice'])
    assert.equal(reads, 2)
  })

  it('previews and deletes only subscriptions belonging to the requested identity scope', async () => {
    const { app, service } = await setup()
    await service.subscribe('onebot', 'guild-a', 'alice')
    await service.subscribe('onebot', 'guild-b', 'alice')
    await service.subscribe('onebot', 'guild-a', 'bob')
    const consumer = createSubscriptionDeletionConsumer()
    const scope = {
      mode: 'identity' as const,
      rootProfileId: 1,
      profileIds: [1],
      identities: [
        { platform: 'onebot', userId: 'alice', profileId: 1 },
        { platform: 'onebot', userId: 'bob', profileId: 1 },
      ],
      targetIdentity: { platform: 'onebot', userId: 'alice' },
    }
    const preview = await consumer.preview(app.database, scope)
    assert.equal(preview.affectedRows, 2)
    assert.match(preview.summary[0], /2 条叫人订阅/)
    await app.database.transact(database => consumer.delete(database, scope))
    assert.deepEqual((await service.list('onebot', 'guild-a')).map(row => row.userId), ['bob'])
    assert.equal((await service.list('onebot', 'guild-b')).length, 0)
  })
})
