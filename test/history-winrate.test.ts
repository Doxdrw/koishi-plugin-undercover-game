import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterEach, it } from 'node:test'
import { App } from 'koishi'
import SQLiteDriver from '@koishijs/plugin-database-sqlite'
import { HERO } from '../src/heroes'
import { WinrateAccumulator, winrateText, type WinrateHeader } from '../src/game/history-winrate'
import { parseWinrateInput } from '../src/game/winrate-commands'
import { HistoryQueries, type HistoryViewer } from '../src/game/history-query'
import { HistoryStore, registerHistoryModels } from '../src/game/history-store'
import type { HistorySnapshot, HistoryParticipant } from '../src/game/history-snapshot'

const participant = (seat: number, userId: string, camp: HistoryParticipant['finalCamp'] = 'good'): HistoryParticipant => ({
  seat, tenureId: userId, identity: { platform: 'onebot', userId, nickname: userId }, joinedAt: 100, initialCamp: camp, finalCamp: camp, heroId: null,
})
function snapshot(): HistorySnapshot {
  return { version: 1, gameId: randomUUID(), platform: 'onebot', selfId: 'bot', guildId: 'g', sandbox: false, mode: 'classic',
    startedAt: 100, endedAt: 200, host: { platform: 'onebot', userId: 'host', nickname: 'Host' }, ruleVersion: '0.4.0', rules: {},
    topics: { publicText: '', good: '甲', undercover: '乙' }, ending: { kind: 'completed', winner: 'good', reason: 'elimination' },
    participants: [participant(1, 'alice'), participant(2, 'bob', 'undercover')],
    phases: [{ sequence: 1, round: 1, kind: 'regular', eligibleTenures: ['alice', 'bob'], speeches: [], ballots: [], effectiveVotes: [], events: [] }],
    awards: [], deerChoices: [] }
}

it('counts only final seat occupants and excludes non-game departures without falling back to the previous player', async () => {
  const data = new WinrateAccumulator(), game = snapshot()
  game.participants.push({ ...participant(1, 'replacement'), replacedTenureId: 'alice', joinedAt: 150 })
  game.participants.push(participant(3, 'kicked'), participant(4, 'timeout'), participant(5, 'exit'), participant(6, 'vote'), participant(7, 'skill'))
  await data.add(game, [
    { tenureId: 'alice', reason: 'kick' }, { tenureId: 'kicked', reason: 'kick' }, { tenureId: 'timeout', reason: 'timeout' },
    { tenureId: 'exit', reason: 'self-exit' }, { tenureId: 'vote', reason: 'vote' }, { tenureId: 'skill', reason: 'skill' },
  ])
  for (const userId of ['alice', 'kicked', 'timeout', 'exit']) assert.equal((await data.summary('onebot', { userId })).total.games, 0)
  for (const userId of ['replacement', 'vote', 'skill']) assert.deepEqual((await data.summary('onebot', { userId })).total, { games: 1, wins: 1 })
  const excludedFinal = { ...snapshot(), participants: [participant(1, 'first'), { ...participant(1, 'last'), replacedTenureId: 'first' }] }
  await data.add(excludedFinal, [{ tenureId: 'last', reason: 'timeout' }])
  assert.equal((await data.summary('onebot', { userId: 'first' })).total.games, 0)
})

it('excludes sandbox, aborts and no-winner games, ignores consolation points, and uses the final actual camp', async () => {
  const data = new WinrateAccumulator()
  for (const ending of [{ kind: 'completed', winner: 'none', reason: 'rule-no-winner' }, { kind: 'aborted', reason: 'host-stop' }] as const) await data.add({ ...snapshot(), ending }, [])
  await data.add({ ...snapshot(), sandbox: true }, [])
  const white = snapshot(); white.participants[0].initialCamp = white.participants[0].finalCamp = 'white'
  white.awards.push({ tenureId: 'alice', amount: 1, reason: 'consolation', idempotencyKey: 'one', status: 'written' })
  await data.add(white, [])
  const recruited = snapshot(); recruited.participants[0].initialCamp = 'white'; recruited.participants[0].finalCamp = 'good'
  await data.add(recruited, [])
  const result = await data.summary('onebot', { userId: 'alice' })
  assert.deepEqual(result.total, { games: 2, wins: 1 })
  assert.deepEqual(result.camps.get('white'), { games: 1, wins: 0 })
  assert.deepEqual(result.camps.get('good'), { games: 1, wins: 1 })
})

it('deduplicates a game, canonicalizes linked identities and still finds a recorded account without XP', async () => {
  const game = snapshot(); game.participants[0].identity.personId = 10
  const data = new WinrateAccumulator(async (_platform, userId) => userId === 'alt' ? 20 : undefined, async id => id === 10 ? 20 : id)
  await data.add(game, []); await data.add(game, [])
  assert.deepEqual((await data.summary('onebot', { userId: 'alt' })).total, { games: 1, wins: 1 })
  const noXp = new WinrateAccumulator(); await noXp.add(game, [])
  assert.equal((await noXp.summary('onebot', { userId: 'alice' })).total.games, 1)
  const erased = snapshot(); erased.participants[0].identity = { platform: 'onebot', userId: '', nickname: '已匿名玩家', erased: true }
  await noXp.add(erased, [])
  assert.equal(noXp.leaderboard({}, 1).entries.some(row => row.nickname === '已匿名玩家'), false)
})

it('filters all three dimensions, applies the board threshold and compares fractions without rounding', async () => {
  const data = new WinrateAccumulator()
  for (let i = 0; i < 5; i++) {
    const game = snapshot(); game.participants[0].heroId = HERO.YUAN_CHONG_HUAN; game.mode = 'deer'
    if (i >= 2) game.ending = { kind: 'completed', winner: 'undercover', reason: 'elimination' }
    await data.add(game, [])
  }
  const result = await data.summary('onebot', { userId: 'alice' }, { mode: 'deer', camp: 'good', heroId: HERO.YUAN_CHONG_HUAN })
  assert.equal(winrateText(result.total), '40%（2/5）')
  assert.deepEqual(data.leaderboard().entries.map(row => row.nickname), ['bob', 'alice'])
  assert.equal(data.leaderboard({}, 6).total, 0)
  assert.throws(() => data.leaderboard({}, 1, 0), /页码/)
  assert.equal((await data.summary('onebot', { userId: 'alice' }, { mode: 'turtle' })).total.games, 0)
})

it('parses Chinese filters, mentions, historical periods and pages without command-line flags', () => {
  const result = parseWinrateInput('<at id="alice"/> 上周 身份=好人 模式=鹿 武将=朱由检')
  assert.deepEqual(result.target, { userId: 'alice' })
  assert.deepEqual(result.period, { kind: 'week', offset: 1 })
  assert.deepEqual(result.filter, { camp: 'good', mode: 'deer', heroId: HERO.ZHU_YOU_JIAN })
  assert.deepEqual(parseWinrateInput('周 前2期 3', true).period, { kind: 'week', offset: 2 })
  assert.equal(parseWinrateInput('前2赛季 3', true).page, 3)
  assert.throws(() => parseWinrateInput('前121周'), /120/)
  assert.throws(() => parseWinrateInput('<img src="file:///private"/>'), /文字/)
})

const apps: App[] = []
afterEach(async () => { while (apps.length) await apps.pop()!.stop() })
async function fixture() {
  const app = new App(); app.plugin(SQLiteDriver, { path: ':memory:' }); app.plugin(registerHistoryModels)
  await app.start(); apps.push(app)
  return { app, store: new HistoryStore(app.database), queries: new HistoryQueries(app.database) }
}
const viewer: HistoryViewer = { platform: 'onebot', selfId: 'bot', userId: 'observer', guildId: 'g', isDirect: false }

it('uses end-time windows and existing group/bot/private permissions, without loading choices or media', async () => {
  const { app, store } = await fixture()
  await store.save(snapshot())
  await store.save({ ...snapshot(), guildId: 'other' })
  const get = app.database.get.bind(app.database)
  const guarded = new Proxy(app.database, { get(target, name) {
    if (name === 'get') return (table: string, ...args: any[]) => {
      assert.notEqual(table, 'undercover_history_choice'); assert.notEqual(table, 'undercover_history_phase')
      return (get as any)(table, ...args)
    }
    const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value
  } })
  const queries = new HistoryQueries(guarded)
  assert.equal((await (await queries.winrates(viewer, { from: 200, until: 201 })).summary('onebot', { userId: 'alice' })).total.games, 1)
  assert.equal((await queries.winrates(viewer, { until: 200 })).leaderboard({}, 1).total, 0)
  assert.equal((await queries.winrates({ ...viewer, selfId: 'other' })).leaderboard({}, 1).total, 0)
  assert.equal((await queries.winrates({ ...viewer, isDirect: true, guildId: undefined })).leaderboard({}, 1).total, 0)
  assert.equal((await (await queries.winrates({ ...viewer, userId: 'alice', isDirect: true, guildId: undefined })).summary('onebot', { userId: 'alice' })).total.games, 2)
})

it('reads departure events in retained histories without a summary and reflects deletion on the next query', async () => {
  const { app, store, queries } = await fixture(), game = snapshot()
  game.participants[0].leftAt = 150; game.phases[0].events.push({ kind: 'departure', tenureId: 'alice', reason: 'self-exit' })
  await store.save(game)
  const row = (await app.database.get('undercover_history_game', { gameId: game.gameId }))[0]
  const header = JSON.parse(row.payload) as WinrateHeader; delete header.departureReasons
  await app.database.set('undercover_history_game', { gameId: game.gameId }, { payload: JSON.stringify(header) })
  assert.equal((await (await queries.winrates(viewer)).summary('onebot', { userId: 'alice' })).total.games, 0)
  assert.equal((await queries.winrates(viewer)).leaderboard({}, 1).total, 1)
  await store.erase(game.gameId)
  assert.equal((await queries.winrates(viewer)).leaderboard({}, 1).total, 0)
})
