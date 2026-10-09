import assert from 'node:assert/strict'
import { afterEach, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { App } from 'koishi'
import SQLiteDriver from '@koishijs/plugin-database-sqlite'
import { archiveDisposition, captureHistory, type HistorySnapshot } from '../src/game/history-snapshot'
import { HistoryStore, registerHistoryModels } from '../src/game/history-store'
import { FileHistoryRetryQueue, HistoryPersistence } from '../src/game/history-retry'
import { createHistoryDeletionConsumer } from '../src/game/history-deletion-consumer'
import { registerSubscriptionModel } from '../src/game/subscription-service'

const apps: App[] = [], directories: string[] = []
afterEach(async () => {
  while (apps.length) await apps.pop()!.stop()
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true })
})
async function fixture(path = ':memory:') {
  const app = new App()
  app.plugin(SQLiteDriver, { path }); app.plugin(registerHistoryModels)
  await app.start(); apps.push(app)
  return { app, store: new HistoryStore(app.database) }
}
function snapshot(mode: HistorySnapshot['mode'] = 'classic'): HistorySnapshot {
  return {
    version: 1, gameId: randomUUID(), platform: 'onebot', selfId: 'bot', guildId: 'guild', sandbox: false,
    mode, startedAt: 100, endedAt: 500, host: { platform: 'onebot', userId: 'host', nickname: '主持人' },
    ruleVersion: '0.3.0', rules: { speakMode: 1, allowWhite: true },
    topics: { publicText: '公开题面', good: '好人规则', undercover: '卧底规则' },
    ending: { kind: 'completed', reason: 'elimination', winner: 'good' },
    participants: [
      { tenureId: 'first', seat: 1, identity: { platform: 'onebot', userId: 'first', nickname: '清风', personId: 1, accountId: 'account-1' },
        joinedAt: 100, leftAt: 250, initialCamp: 'good', finalCamp: 'good', heroId: 0 },
      { tenureId: 'next', seat: 1, replacedTenureId: 'first', identity: { platform: 'onebot', userId: 'next', nickname: '明月' },
        joinedAt: 250, initialCamp: 'good', finalCamp: 'good', heroId: 0 },
      { tenureId: 'second', seat: 2, identity: { platform: 'onebot', userId: 'second', nickname: '远山' },
        joinedAt: 100, initialCamp: 'undercover', finalCamp: 'undercover', heroId: null },
    ],
    phases: [1, 2, 3].map(sequence => ({ sequence, round: 1, kind: sequence === 1 ? 'regular' : 'overtime',
      eligibleTenures: [sequence === 1 ? 'first' : 'next', 'second'],
      speeches: [{ tenureId: sequence === 1 ? 'first' : 'next', text: '最终发言' + sequence,
        ...(mode === 'turtle' ? { question: '问题' + sequence, answer: '否' } : {}) }],
      ballots: [{ voterTenureId: 'second', targetSeat: 1 }], effectiveVotes: [{ seat: 1, count: 1 }],
      events: sequence === 1 ? [{ kind: 'hero-reveal', tenureId: 'first', heroId: 0 }, { kind: 'departure', tenureId: 'first', reason: 'kick' }] : [],
    })),
    awards: [{ tenureId: 'next', amount: 0.5, reason: 'good-win', status: 'failed', idempotencyKey: 'reward-first' }],
    deerChoices: mode === 'deer' ? [{ tenureId: 'first', choice: '不应搜索的旧选人', hidden: true }, { tenureId: 'next', choice: '另一个选人', hidden: false }] : [],
  }
}

it('captures immutable final data without conflating repeated overtime or replacement authors', () => {
  const input = snapshot('turtle'), saved = captureHistory(input)
  input.phases[0].speeches[0].text = 'later mutation'
  input.participants[0].identity.nickname = 'renamed'
  assert.equal(saved.phases[0].speeches[0].text, '最终发言1')
  assert.equal(saved.participants[0].identity.nickname, '清风')
  assert.deepEqual(saved.phases.map(p => p.sequence), [1, 2, 3])
  assert.ok(Object.isFrozen(saved.phases[0].speeches[0]))
  assert.equal(saved.participants[1].replacedTenureId, 'first')
})

it('classifies explicit normal endings, aborts, deer records and sandbox policy', () => {
  const input = snapshot()
  for (const [reason, winner] of [['elimination', 'good'], ['stalemate', 'undercover'], ['white-survival', 'white'], ['rule-no-winner', 'none'], ['self-explosion', 'undercover'], ['recruitment', 'good']] as const) {
    input.ending = { kind: 'completed', reason, winner }
    assert.equal(archiveDisposition(captureHistory(input)), 'completed')
  }
  for (const reason of ['host-stop', 'host-timeout', 'setup-timeout', 'system-error', 'restart'] as const) {
    input.ending = { kind: 'aborted', reason }
    assert.equal(archiveDisposition(captureHistory(input)), reason === 'host-stop' ? 'aborted' : 'skip')
  }
  const prePhase = snapshot(); prePhase.phases = []; prePhase.ending = { kind: 'aborted', reason: 'host-stop' }
  assert.equal(archiveDisposition(captureHistory(prePhase)), 'skip')
  const deer = snapshot('deer'); deer.ending = { kind: 'aborted', reason: 'host-stop' }
  assert.equal(archiveDisposition(captureHistory(deer)), 'deer-aborted')
  deer.topics = null
  assert.equal(archiveDisposition(captureHistory(deer)), 'skip')
  input.ending = { kind: 'completed', reason: 'elimination', winner: 'good' }; input.sandbox = true
  assert.equal(archiveDisposition(captureHistory(input)), 'skip')
  assert.equal(archiveDisposition(captureHistory(input), { enabled: true, sandbox: true }), 'completed')
  assert.equal(archiveDisposition(captureHistory(input), { enabled: false, sandbox: true }), 'skip')
})

it('rejects malformed author chains, duplicate phases, secret misrouting and non-finite results', () => {
  const invalid = (change: (value: HistorySnapshot) => void) => { const v = snapshot(); change(v); assert.throws(() => captureHistory(v), /无效历史快照/) }
  invalid(v => { v.participants[1].replacedTenureId = 'unknown' })
  invalid(v => { v.participants[0].leftAt = undefined })
  invalid(v => { v.phases[1].sequence = 1 })
  invalid(v => { v.phases[0].speeches[0].tenureId = 'next' })
  invalid(v => { v.phases[0].eligibleTenures.push('first') })
  invalid(v => { v.awards[0].amount = Infinity })
  invalid(v => { v.deerChoices.push({ tenureId: 'first', choice: 'secret', hidden: true }) })
  invalid(v => { v.ending = { kind: 'completed', reason: 'stalemate', winner: 'good' } })
})

it('saves complete classic/deer/turtle games transactionally, with failed scores retained', async () => {
  const { app, store } = await fixture()
  for (const mode of ['classic', 'deer', 'turtle'] as const) {
    const input = snapshot(mode)
    const result = await store.save(input)
    assert.equal(result.kind, 'saved')
    const header = (await app.database.get('undercover_history_game', { gameId: input.gameId }))[0]
    assert.equal(header.disposition, 'completed')
    assert.equal(JSON.parse(header.payload).awards[0].status, 'failed')
    assert.equal((await app.database.get('undercover_history_phase', { gameId: input.gameId })).length, 3)
    assert.ok(!header.payload.includes('不应搜索的旧选人'))
    const choices = await app.database.get('undercover_history_choice', { gameId: input.gameId })
    assert.equal(choices.length, mode === 'deer' ? 2 : 0)
    if (mode === 'deer') assert.deepEqual(choices.map(c => c.tenureId).sort(), ['first', 'next'])
  }
  assert.equal((await app.database.get('undercover_history_game', {})).length, 3)
})

it('serializes duplicate UUID retries, rejects changed snapshots and never rewrites hidden flags', async () => {
  const { app, store } = await fixture(), input = snapshot('deer')
  const results = await Promise.all(Array.from({ length: 12 }, () => store.save(input)))
  assert.equal(results.filter(r => r.kind === 'saved' && !r.repeated).length, 1)
  assert.equal(new Set(results.map(r => r.kind === 'saved' && r.id)).size, 1)
  await app.database.set('undercover_history_choice', { gameId: input.gameId, tenureId: 'next' }, { hidden: true })
  await store.save(input)
  assert.equal((await app.database.get('undercover_history_choice', { gameId: input.gameId, tenureId: 'next' }))[0].hidden, true)
  input.phases[0].speeches[0].text = 'conflicting final snapshot'
  await assert.rejects(store.save(input), /拒绝覆盖/)
})

it('rolls back header and phase writes on a mid-save failure then allows a clean retry', async () => {
  const { app } = await fixture(), input = snapshot('deer')
  const database = new Proxy(app.database, { get(target, key) {
    if (key === 'transact') return (callback: any) => target.transact(db => callback(new Proxy(db, { get(tx, prop) {
      if (prop === 'create') return (table: string, row: any) => {
        if (table === 'undercover_history_phase' && row.sequence === 2) throw new Error('injected phase failure')
        return (tx.create as any)(table, row)
      }
      const value = Reflect.get(tx, prop); return typeof value === 'function' ? value.bind(tx) : value
    } })))
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } })
  await assert.rejects(new HistoryStore(database).save(input), /injected phase failure/)
  assert.equal((await app.database.get('undercover_history_game', {})).length, 0)
  assert.equal((await app.database.get('undercover_history_phase', {})).length, 0)
  assert.equal((await app.database.get('undercover_history_choice', {})).length, 0)
  assert.equal((await new HistoryStore(app.database).save(input)).kind, 'saved')
})

it('keeps pre-phase aborted archives skipped while preserving eligible aborted and deer archives', async () => {
  const { app, store } = await fixture()
  const ordinary = snapshot(); ordinary.ending = { kind: 'aborted', reason: 'host-stop' }
  const ordinarySaved = await store.save(ordinary)
  assert.ok(ordinarySaved.kind === 'saved')
  assert.equal((await app.database.get('undercover_history_game', { disposition: 'aborted' })).length, 1)
  const prePhase = snapshot(); prePhase.gameId = randomUUID(); prePhase.phases = []; prePhase.ending = { kind: 'aborted', reason: 'host-stop' }
  assert.deepEqual(await store.save(prePhase), { kind: 'skipped' })
  const sandbox = snapshot(); sandbox.sandbox = true
  assert.deepEqual(await store.save(sandbox), { kind: 'skipped' })
  const deer = snapshot('deer'); deer.ending = { kind: 'aborted', reason: 'host-timeout' }
  await store.save(deer)
  assert.equal((await app.database.get('undercover_history_game', { disposition: 'completed' })).length, 0)
  assert.equal((await app.database.get('undercover_history_game', {})).length, 2)
})

it('reopens persisted data and retains IDs and final overtime answers without replaying game or scores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-test-')); directories.push(dir)
  const path = join(dir, 'history.db'), input = snapshot('turtle')
  const first = await fixture(path)
  const saved = await first.store.save(input)
  await apps.pop()!.stop()
  const second = await fixture(path)
  const repeated = await second.store.save(input)
  assert.ok(saved.kind === 'saved' && repeated.kind === 'saved')
  assert.equal(saved.id, repeated.id); assert.equal(repeated.repeated, true)
  const rows = await second.app.database.get('undercover_history_phase', { gameId: input.gameId })
  assert.deepEqual(rows.sort((a, b) => a.sequence - b.sequence).map(r => JSON.parse(r.payload).speeches[0].question), ['问题1', '问题2', '问题3'])
})

it('spools a failed archive to private files then restart-retries without duplicate scores or games', async () => {
  const { app, store } = await fixture(), input = snapshot('deer')
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-spool-')); directories.push(dir)
  const queue = new FileHistoryRetryQueue(dir), warnings: string[] = []
  const failing = new HistoryPersistence({ save: async () => { throw new Error('private SQL failure') } }, queue, event => warnings.push(event))
  assert.deepEqual(await failing.save(input), { kind: 'queued' })
  input.deerChoices[0].choice = 'mutated-after-save'
  const restored = new FileHistoryRetryQueue(dir)
  assert.equal((await restored.read((await restored.names())[0])).deerChoices[0].choice, '不应搜索的旧选人')
  const running = new HistoryPersistence(store, restored, event => warnings.push(event))
  assert.deepEqual(await running.retry(), { saved: 1, failed: 0 })
  assert.deepEqual(await running.retry(), { saved: 0, failed: 0 })
  assert.equal((await app.database.get('undercover_history_game', {})).length, 1)
  assert.deepEqual(warnings, ['database-save-failed'])
})

it('reports dual storage failure safely and does not queue excluded sandbox or invalid snapshots', async () => {
  let calls = 0; const warnings: string[] = []
  const service = new HistoryPersistence({ save: async () => { calls++; throw new Error('db') } }, {
    put: async () => { throw new Error('disk') }, names: async () => [], read: async () => snapshot(), remove: async () => {},
  }, event => { warnings.push(event); throw new Error('broken logger') })
  assert.deepEqual(await service.save(snapshot()), { kind: 'failed' })
  assert.deepEqual(warnings, ['database-save-failed', 'archive-and-spool-failed'])
  const sandbox = snapshot(); sandbox.sandbox = true
  assert.deepEqual(await service.save(sandbox), { kind: 'skipped' })
  const invalid = snapshot(); invalid.awards[0].amount = NaN
  assert.deepEqual(await service.save(invalid), { kind: 'failed' })
  assert.equal(calls, 1)
})

it('rejects conflicting/corrupt spool files, ignores temp files, and continues retrying healthy records', async () => {
  const { app, store } = await fixture()
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-spool-')); directories.push(dir)
  const queue = new FileHistoryRetryQueue(dir), first = snapshot(), second = snapshot()
  await queue.put(first); await queue.put(first); await queue.put(second)
  first.phases[0].speeches[0].text = 'conflicting snapshot'
  await assert.rejects(queue.put(first), /不同待重试快照/)
  const folder = join(dir, 'data/undercover-game/history-pending')
  assert.equal((await readdir(folder)).filter(n => n.endsWith('.tmp')).length, 0)
  await writeFile(join(folder, first.gameId + '.json'), '{"version":1,"payload":"bad","digest":"bad"}')
  await writeFile(join(folder, 'unrelated.tmp'), 'not a snapshot')
  await assert.rejects(queue.read('../outside.json'), /无效存档队列文件名/)
  const warnings: string[] = []
  assert.deepEqual(await new HistoryPersistence(store, queue, event => warnings.push(event)).retry(), { saved: 1, failed: 1 })
  assert.deepEqual(warnings, ['archive-retry-failed'])
  assert.equal((await app.database.get('undercover_history_game', {}))[0].gameId, second.gameId)
  assert.deepEqual(await queue.names(), [first.gameId + '.json'])
})

it('retries an acknowledged database write after spool removal failed without duplicate records', async () => {
  const { app, store } = await fixture()
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-spool-')); directories.push(dir)
  const queue = new FileHistoryRetryQueue(dir), input = snapshot()
  await queue.put(input)
  let failRemove = true
  const faulty = { put: queue.put.bind(queue), read: queue.read.bind(queue), names: queue.names.bind(queue),
    remove: async (name: string) => { if (failRemove) throw new Error('disk'); await queue.remove(name) } }
  const service = new HistoryPersistence(store, faulty, () => {})
  assert.deepEqual(await service.retry(), { saved: 0, failed: 1 })
  failRemove = false
  assert.deepEqual(await service.retry(), { saved: 1, failed: 0 })
  assert.equal((await app.database.get('undercover_history_game', {})).length, 1)
  assert.equal((await app.database.get('undercover_history_phase', {})).length, 3)
})

it('never resurrects erased history from queued or replayed snapshots, including a new store instance', async () => {
  const { app, store } = await fixture(), input = snapshot('deer')
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-erasure-')); directories.push(dir)
  const queue = new FileHistoryRetryQueue(dir)
  await queue.put(input); await store.save(input)
  await store.erase(input.gameId); await store.erase(input.gameId)
  const restarted = new HistoryStore(app.database)
  assert.deepEqual(await restarted.save(input), { kind: 'erased' })
  const persistence = new HistoryPersistence(restarted, queue, assert.fail)
  await persistence.retry()
  assert.deepEqual(await queue.names(), [])
  for (const table of ['undercover_history_game', 'undercover_history_phase', 'undercover_history_choice'] as const)
    assert.equal((await app.database.get(table, {})).length, 0)
  const markers = await app.database.get('undercover_history_erasure', {})
  assert.equal(markers.length, 1)
  assert.deepEqual(Object.keys(markers[0]), ['key'])
  assert.match(markers[0].key, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(markers), new RegExp(input.gameId))
})

it('rolls back deletion and its retry marker together if any table removal fails', async () => {
  const { app, store } = await fixture(), input = snapshot('deer')
  await store.save(input)
  const tables = ['undercover_history_game', 'undercover_history_phase', 'undercover_history_choice', 'undercover_history_erasure'] as const
  const before = await Promise.all(tables.map(t => app.database.get(t, {})))
  const faulty = new Proxy(app.database, { get(target, key) {
    if (key === 'transact') return (callback: any) => target.transact(db => callback(new Proxy(db, { get(tx, prop) {
      if (prop === 'remove') return (table: string, query: any) => {
        if (table === 'undercover_history_game') throw new Error('injected erase failure')
        return (tx.remove as any)(table, query)
      }
      const value = Reflect.get(tx, prop); return typeof value === 'function' ? value.bind(tx) : value
    } })))
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } })
  await assert.rejects(new HistoryStore(faulty).erase(input.gameId), /injected erase failure/)
  assert.deepEqual(await Promise.all(tables.map(t => app.database.get(t, {}))), before)
  const again = await store.save(input)
  assert.ok(again.kind === 'saved' && again.repeated)
})

it('anonymizes only the deleted author and sanitizes queued snapshots after commit without reviving original text', async () => {
  const { app, store } = await fixture()
  registerSubscriptionModel(app)
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-anonymize-')); directories.push(dir)
  const queue = new FileHistoryRetryQueue(dir), persistence = new HistoryPersistence(store, queue, assert.fail)
  const consumer = createHistoryDeletionConsumer(queue, persistence)
  const existing = snapshot('deer'), queued = snapshot('deer')
  for (const data of [existing, queued]) data.phases[0].speeches[0].segments = [
    { kind: 'text', text: '应删除的媒体作者正文' }, { kind: 'media', type: 'img', src: 'https://cdn.example/private.png' },
  ]
  await store.save(existing); await queue.put(queued)
  const scope = { mode: 'profile' as const, profileIds: [1], identities: [{ platform: 'onebot', userId: 'first', profileId: 1 }] }
  const preview = await consumer.preview(app.database, scope)
  assert.equal(preview.affectedRows, 2)
  assert.match(preview.summary.join(''), /其他玩家发言/)
  await app.database.transact(db => consumer.delete(db, scope))
  await consumer.afterDelete()
  assert.deepEqual(await queue.names(), [])
  for (const original of [existing, queued]) {
    const header = JSON.parse((await app.database.get('undercover_history_game', { gameId: original.gameId }))[0].payload)
    assert.equal(header.participants[0].identity.nickname, '已匿名玩家')
    assert.equal(header.participants[0].identity.erased, true)
    assert.ok(!JSON.stringify(header.participants[0]).includes('account-1'))
    assert.equal(header.participants[1].identity.nickname, '明月')
    const choices = await app.database.get('undercover_history_choice', { gameId: original.gameId })
    assert.deepEqual(choices.map(c => c.tenureId), ['next'])
    const phases = await app.database.get('undercover_history_phase', { gameId: original.gameId }, { sort: { sequence: 'asc' } })
    assert.equal(JSON.parse(phases[0].payload).speeches[0].text, '发言已匿名化删除')
    assert.equal(JSON.parse(phases[0].payload).speeches[0].segments, undefined)
    assert.equal(JSON.parse(phases[1].payload).speeches[0].text, '最终发言2')
    await store.save(original)
    assert.equal(JSON.parse((await app.database.get('undercover_history_game', { gameId: original.gameId }))[0].payload).participants[0].identity.erased, true)
  }
})

it('rolls back anonymity markers and content when a consumer transaction fails before commit', async () => {
  const { app, store } = await fixture(); registerSubscriptionModel(app)
  const dir = await mkdtemp(join(tmpdir(), 'uc-history-anonymize-')); directories.push(dir)
  const queue = new FileHistoryRetryQueue(dir), input = snapshot('deer')
  await queue.put(input); await store.save(input)
  const consumer = createHistoryDeletionConsumer(queue, new HistoryPersistence(store, queue, assert.fail))
  const scope = { mode: 'identity' as const, profileIds: [1], identities: [{ platform: 'onebot', userId: 'first', profileId: 1 }], targetIdentity: { platform: 'onebot', userId: 'first' } }
  await assert.rejects(app.database.transact(async db => { await consumer.delete(db, scope); throw new Error('other consumer failed') }), /other consumer failed/)
  assert.equal((await app.database.get('undercover_history_redaction', {})).length, 0)
  assert.equal(JSON.parse((await app.database.get('undercover_history_game', {}))[0].payload).participants[0].identity.nickname, '清风')
  assert.equal((await queue.read(input.gameId + '.json')).participants[0].identity.nickname, '清风')
})

it('refuses stale deletion previews after a hidden-state change and prunes expired games without resurrection', async () => {
  const { app, store } = await fixture(), input = snapshot('deer')
  await store.save(input)
  const before = await store.deletionFingerprint(input.gameId)
  await app.database.set('undercover_history_choice', { gameId: input.gameId, tenureId: 'next' }, { hidden: true })
  await assert.rejects(store.erase(input.gameId, before), /已变化/)
  assert.equal((await app.database.get('undercover_history_game', {})).length, 1)
  const retention = new HistoryStore(app.database, 7)
  assert.equal(await retention.prune(), 1)
  assert.deepEqual(await retention.save(input), { kind: 'erased' })
})

it('cleans only media for the same bot at the next game boundary and by ended-at age', async () => {
  const { app } = await fixture()
  const input = snapshot()
  input.phases[0].speeches[0].segments = [
    { kind: 'text', text: '最终发言1' },
    { kind: 'face', id: '14', platform: 'onebot' },
    { kind: 'media', type: 'img', src: 'https://cdn.example/image.png?token=secret' },
  ]
  const nextGame = new HistoryStore(app.database, 0, { mode: 'next-game' })
  await nextGame.save(input)
  assert.match((await app.database.get('undercover_history_phase', { gameId: input.gameId }))[0].payload, /cdn\.example/)
  assert.equal(await nextGame.pruneMediaForBot('onebot', 'other-bot', input.endedAt), 0)
  assert.match((await app.database.get('undercover_history_phase', { gameId: input.gameId }))[0].payload, /cdn\.example/)
  assert.equal(await nextGame.pruneMediaForBot('onebot', 'bot', input.endedAt), 1)
  const cleaned = JSON.parse((await app.database.get('undercover_history_phase', { gameId: input.gameId }))[0].payload)
  assert.deepEqual(cleaned.speeches[0].segments, [{ kind: 'text', text: '最终发言1' }, { kind: 'face', id: '14', platform: 'onebot' }])

  const aged = snapshot()
  aged.gameId = randomUUID()
  aged.endedAt = 2000
  aged.phases[0].speeches[0].segments = [{ kind: 'media', type: 'img', src: 'https://cdn.example/old.png' }]
  const byDays = new HistoryStore(app.database, 0, { mode: 'permanent' })
  await byDays.save(aged)
  assert.equal(await byDays.pruneMediaForBot('onebot', 'bot', aged.endedAt + 31 * 86400000), 0)
  assert.match((await app.database.get('undercover_history_phase', { gameId: aged.gameId }))[0].payload, /cdn\.example/)
  assert.equal(await new HistoryStore(app.database, 0, { mode: 'days', days: 30 }).pruneExpiredMedia(aged.endedAt + 30 * 86400000), 0)
  assert.equal(await new HistoryStore(app.database, 0, { mode: 'days', days: 30 }).pruneExpiredMedia(aged.endedAt + 31 * 86400000), 1)
  const agedPhase = JSON.parse((await app.database.get('undercover_history_phase', { gameId: aged.gameId }))[0].payload)
  assert.equal(agedPhase.speeches[0].segments, undefined)
})

it('does not restore media when a delayed archive is saved after the next-game boundary', async () => {
  const { app } = await fixture()
  const data = snapshot()
  data.phases[0].speeches[0].segments = [{ kind: 'media', type: 'img', src: 'https://cdn.example/late.png' }]
  const store = new HistoryStore(app.database, 0, { mode: 'next-game' })
  await store.pruneMediaForBot(data.platform, data.selfId, data.endedAt + 1)
  await store.save(data)
  const phase = JSON.parse((await app.database.get('undercover_history_phase', { gameId: data.gameId }))[0].payload)
  assert.deepEqual(phase.speeches[0].segments, [])
})
