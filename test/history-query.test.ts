import assert from 'node:assert/strict'
import { it, afterEach } from 'node:test'
import { randomUUID } from 'node:crypto'
import { App } from 'koishi'
import SQLiteDriver from '@koishijs/plugin-database-sqlite'
import { registerHistoryModels, HistoryStore } from '../src/game/history-store'
import { HistoryQueries, historyTextPages, historyContentPages, type HistoryViewer } from '../src/game/history-query'
import { h } from 'koishi'
import { HERO } from '../src/heroes'
import type { HistorySnapshot } from '../src/game/history-snapshot'
import { DeerHistoryControls } from '../src/game/history-deer'
import { historyIdentityKeys, redactHistory } from '../src/game/history-privacy'
const apps: App[] = []
afterEach(async () => { while (apps.length) await apps.pop()!.stop() })
async function fixture() {
  const app = new App(); app.plugin(SQLiteDriver, { path: ':memory:' }); app.plugin(registerHistoryModels)
  await app.start(); apps.push(app)
  return { app, store: new HistoryStore(app.database), queries: new HistoryQueries(app.database,
    async (_platform, id) => id === 'linked-alt' ? 20 : undefined, async id => id === 10 ? 20 : id) }
}
const group: HistoryViewer = { platform: 'onebot', selfId: 'bot', userId: 'stranger', isDirect: false, guildId: 'g' }
function input(index = 0): HistorySnapshot {
  return { version: 1, gameId: randomUUID(), platform: 'onebot', selfId: 'bot', guildId: 'g', mode: 'deer', sandbox: false,
    startedAt: 100 + index, endedAt: 200 + index, ruleVersion: '0.3.0', rules: {},
    host: { platform: 'onebot', userId: 'host', nickname: '主持人' },
    topics: { publicText: '易混', good: '好人规则', undercover: '卧底规则' },
    ending: { kind: 'completed', winner: 'good', reason: 'elimination' },
    participants: [{ tenureId: 'a', seat: 1, identity: { platform: 'onebot', userId: 'player', nickname: '清风', personId: 10, accountId: 'secret-account-id' },
      joinedAt: 100 + index, initialCamp: 'good', finalCamp: 'good', heroId: null }],
    phases: [{ sequence: 1, round: 1, kind: 'regular', eligibleTenures: ['a'], speeches: [{ tenureId: 'a', text: '公开发言检索' }], ballots: [], effectiveVotes: [], events: [] }],
    awards: [], deerChoices: [{ tenureId: 'a', choice: '绝不能搜到的私密选人', hidden: true }] }
}

it('allows original-group members, rejects other groups/bots and limits private history to participants or canonical alts', async () => {
  const { store, queries } = await fixture()
  const saved = await store.save(input()); assert.ok(saved.kind === 'saved')
  assert.equal((await queries.list(group)).total, 1)
  assert.equal(await queries.replay({ ...group, guildId: 'wrong' }, saved.id), undefined)
  assert.equal(await queries.replay({ ...group, selfId: 'other-bot' }, saved.id), undefined)
  const direct = { ...group, guildId: undefined, isDirect: true }
  assert.equal((await queries.list(direct)).total, 0)
  assert.equal(await queries.replay(direct, saved.id), undefined)
  for (const userId of ['host', 'player', 'linked-alt']) assert.equal((await queries.list({ ...direct, userId })).total, 1)
  assert.equal((await queries.list({ ...direct, userId: 'linked-alt', platform: 'elsewhere' })).total, 0)
})

it('never reads deer choices or exposes internal account identifiers in normal replay/search', async () => {
  const { app, store, queries } = await fixture()
  await store.save(input())
  const original = app.database.get.bind(app.database)
  const guarded = new Proxy(app.database, { get(target, key) {
    if (key === 'get') return (table: string, ...args: any[]) => {
      assert.notEqual(table, 'undercover_history_choice', 'public query must not read selections')
      return (original as any)(table, ...args)
    }
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value
  } })
  const safe = new HistoryQueries(guarded)
  assert.equal((await safe.list(group, { keyword: '绝不能搜到' })).total, 0)
  assert.equal((await safe.list(group, { keyword: '公开发言' })).total, 1)
  assert.equal((await safe.list(group, { keyword: '清风' })).total, 1)
  const replay = await safe.replay(group)
  assert.ok(replay)
  const output = JSON.stringify(replay)
  assert.ok(output.includes('公开发言检索'))
  assert.doesNotMatch(output, /绝不能搜到|secret-account-id|personId|userId|digest|gameId/)
  assert.doesNotMatch(output, /规则版本|写入成功|原始票权|结束原因：规则结算/)
  assert.equal((await queries.list(group)).total, 1)
})

it('renders ending reason, phase outcomes, special vote weight and award write status', async () => {
  const { store, queries } = await fixture()
  const snapshot = input()
  snapshot.ending = { kind: 'completed', winner: 'undercover', reason: 'stalemate' }
  snapshot.phases[0].outcomes = ['本轮无人出局，平安夜。', '连续两轮平安夜且满足僵局条件，游戏结束，卧底胜利。']
  snapshot.phases[0].ballots = [{ voterTenureId: 'a', targetSeat: null, weight: 2, status: 'abstain' }]
  snapshot.awards = [{ tenureId: 'a', amount: 1, reason: 'win', idempotencyKey: 'failed-award', status: 'failed' }]
  await store.save(snapshot)
  const replay = await queries.replay(group)
  assert.ok(replay)
  assert.match(replay.introduction, /结束原因：连续两轮平安夜僵局/)
  assert.match(replay.introduction, /应得1分，但积分未写入/)
  assert.match(replay.phases[0].text, /本轮无人出局，平安夜/)
  assert.match(replay.phases[0].text, /弃权（2票）/)
})

it('matches a readable golden recap for ballots, replacements and natural hero effects', async () => {
  const { store, queries } = await fixture(), snapshot = input()
  snapshot.mode = 'classic'; snapshot.deerChoices = []
  snapshot.topics = { publicText: '', good: '好人词条', undercover: '卧底词条', goodHint: '好人雷点', undercoverHint: '卧底雷点' }
  const first = snapshot.participants[0]
  for (const [tenureId, seat, nickname] of [['b', 2, '明月'], ['c', 3, '流云'], ['d', 4, '星河']] as const) {
    snapshot.participants.push({ ...first, tenureId, seat, identity: { platform: 'onebot', userId: tenureId, nickname } })
  }
  first.leftAt = 150
  snapshot.participants.push({ ...first, tenureId: 'next', joinedAt: 151, leftAt: undefined, replacedTenureId: 'a',
    identity: { platform: 'onebot', userId: 'next', nickname: '松风' } })
  Object.assign(snapshot.phases[0], {
    eligibleTenures: ['a', 'b', 'c', 'd', 'next'], speeches: [{ tenureId: 'b', text: '2曾经当过皇帝' }],
    ballots: [
      { voterTenureId: 'next', targetSeat: 2, targetNickname: '明月', weight: 1, status: 'vote' },
      { voterTenureId: 'b', targetSeat: 3, targetNickname: '流云', weight: 2, status: 'vote' },
      { voterTenureId: 'c', targetSeat: null, weight: 1, status: 'timeout' },
      { voterTenureId: 'd', targetSeat: null, weight: 0, status: 'skip' },
    ],
    effectiveVotes: [{ seat: 1, count: 0 }, { seat: 2, count: 1 }, { seat: 3, count: 2 }, { seat: 4, count: 0 }],
    events: [
      { kind: 'departure', tenureId: 'a', reason: 'kick' }, { kind: 'replacement', tenureId: 'next' },
      { kind: 'skill', tenureId: 'd', heroId: HERO.MAO_WEN_LONG, effect: '迟投增加1票', targetSeats: [2] },
      { kind: 'skill', tenureId: 'next', heroId: HERO.LIN_DAN_HAN, effect: '避实抵消2票；本人投票未失效', targetSeats: [] },
      { kind: 'skill', tenureId: 'b', heroId: HERO.WU_SAN_GUI, effect: '权计指定出局', targetSeats: [3] },
    ],
  })
  await store.save(snapshot)
  const replay = await queries.replay(group); assert.ok(replay)
  assert.match(replay.introduction, /好人雷点：好人雷点\n卧底雷点：卧底雷点/)
  assert.doesNotMatch(replay.introduction, /题面：\s*\n/)
  assert.match(replay.introduction, /玩家：\n1号 清风/)
  assert.equal(replay.phases[0].text, [
    '第1轮', '2号玩家明月：2曾经当过皇帝', '投票结果：',
    '1号玩家松风投给了2号玩家明月。', '2号玩家明月投给了3号玩家流云（2票）。',
    '3号玩家流云未来得及投票。', '4号玩家星河跳过投票阶段。', '最终票数：',
    '2号玩家明月获得1票。', '3号玩家流云获得2票。', '1号玩家清风被主持人踢出。', '1号玩家松风补位加入游戏。',
    '4号玩家星河使2号玩家明月得票数增加1票。', '1号玩家松风“避实”抵消2票。',
    '2号玩家明月发动“权计”，指定3号玩家流云出局。',
  ].join('\n'))
})

for (const mode of ['classic', 'turtle'] as const) it(`orders ${mode} replay speech by seat and occupant in both renderers`, async () => {
  const { app, store, queries } = await fixture(), snapshot = input()
  snapshot.mode = mode; snapshot.deerChoices = []
  const first = snapshot.participants[0]
  first.leftAt = 140
  snapshot.participants.push(
    { ...first, tenureId: 'b', seat: 2, leftAt: undefined, identity: { platform: 'onebot', userId: 'b', nickname: '明月' } },
    { ...first, tenureId: 'next', joinedAt: 141, leftAt: undefined, replacedTenureId: 'a', identity: { platform: 'onebot', userId: 'next', nickname: '松风' } },
  )
  snapshot.phases[0].eligibleTenures = ['a', 'b', 'next']
  snapshot.phases[0].speeches = ['b', 'next', 'a'].map(tenureId => ({ tenureId, text: tenureId + '公开发言',
    question: tenureId + '问题', answer: '是', segments: mode === 'classic' ? [
      { kind: 'text' as const, text: tenureId + '公开发言' }, { kind: 'face' as const, id: '14' },
    ] : undefined }))
  const saved = await store.save(snapshot); assert.equal(saved.kind, 'saved')
  const replay = await queries.replay(group); assert.ok(replay)
  for (const output of [replay.phases[0].text, replay.phases[0].content!.toString()]) {
    assert.ok(output.indexOf('1号玩家清风') < output.indexOf('1号玩家松风'))
    assert.ok(output.indexOf('1号玩家松风') < output.indexOf('2号玩家明月'))
  }
  if (mode === 'classic') assert.equal((replay.phases[0].content!.toString().match(/<face id="14"/g) ?? []).length, 3)
  const stored = await app.database.get('undercover_history_phase', { gameId: snapshot.gameId })
  assert.deepEqual(JSON.parse(stored[0].payload).speeches.map((s: any) => s.tenureId), ['b', 'next', 'a'])
})

it('renders a failed white explosion once with its public reveal and redacts authored explosion text', async () => {
  const { store, queries } = await fixture(), snapshot = input()
  snapshot.mode = 'classic'; snapshot.deerChoices = []
  snapshot.participants[0].initialCamp = snapshot.participants[0].finalCamp = 'white'
  snapshot.phases[0].events = [
    { kind: 'self-explosion', tenureId: 'a', text: '1自爆公开猜词', outcome: 'white-departure', adjudicated: true },
    { kind: 'hero-reveal', tenureId: 'a', heroId: HERO.YUAN_CHONG_HUAN },
    { kind: 'departure', tenureId: 'a', reason: 'skill' },
  ]
  await store.save(snapshot)
  const replay = await queries.replay(group); assert.ok(replay)
  assert.match(replay.phases[0].text, /清风自爆，发言为：1自爆公开猜词\n主持人判定自爆失败/)
  assert.match(replay.phases[0].text, /白板1号玩家清风出局，游戏继续，亮出武将牌：袁崇焕/)
  assert.equal((replay.phases[0].text.match(/出局/g) ?? []).length, 1)
  assert.doesNotMatch(replay.phases[0].text, /因武将技能出局/)
  const redacted = redactHistory(snapshot, historyIdentityKeys(snapshot.participants[0].identity).map(key => ({ key, cutoff: 999 })))
  assert.doesNotMatch(JSON.stringify(redacted), /公开猜词|清风/)
  assert.match(JSON.stringify(redacted), /自爆发言已匿名化删除/)
})

it('keeps a standalone public hero reveal in the replay when no departure follows it', async () => {
  const { store, queries } = await fixture()
  const snapshot = input()
  snapshot.phases[0].events = [{ kind: 'hero-reveal', tenureId: 'a', heroId: 0 }]
  await store.save(snapshot)
  const replay = await queries.replay(group)
  assert.ok(replay)
  assert.match(replay.phases[0].text, /清风亮出武将牌：/)
})

it('keeps Zhu Youjian backlash distinct from self-execution in historical wording', async () => {
  const { store, queries } = await fixture()
  const backlash = input(1)
  backlash.mode = 'classic'; backlash.deerChoices = []
  backlash.topics = { publicText: '', good: '好人词条', undercover: '卧底词条' }
  backlash.participants.push({ ...backlash.participants[0], tenureId: 'b', seat: 2,
    identity: { platform: 'onebot', userId: 'target', nickname: '明月' }, joinedAt: 101 })
  backlash.phases[0].events = [
    { kind: 'skill', tenureId: 'a', heroId: HERO.ZHU_YOU_JIAN, effect: '处决：同阵营反噬', targetSeats: [2] },
    { kind: 'departure', tenureId: 'a', reason: 'skill' },
  ]
  await store.save(backlash)
  const failed = await queries.replay(group); assert.ok(failed)
  assert.match(failed.phases[0].text, /选择处决2号玩家明月，处决失败/)
  assert.match(failed.phases[0].text, /1号玩家清风因武将技能出局/)
  assert.doesNotMatch(failed.phases[0].text, /清风自裁/)

  const self = input(2)
  self.mode = 'classic'; self.deerChoices = []
  self.topics = { publicText: '', good: '好人词条', undercover: '卧底词条' }
  self.phases[0].events = [
    { kind: 'skill', tenureId: 'a', heroId: HERO.ZHU_YOU_JIAN, effect: '处决：自裁', targetSeats: [1] },
    { kind: 'departure', tenureId: 'a', reason: 'skill' },
  ]
  await store.save(self)
  const selfReplay = await queries.replay(group); assert.ok(selfReplay)
  assert.match(selfReplay.phases[0].text, /1号玩家清风自裁。/)
  assert.doesNotMatch(selfReplay.phases[0].text, /清风因武将技能出局/)

  const success = structuredClone(backlash)
  success.gameId = randomUUID(); success.startedAt = 103; success.endedAt = 203
  success.participants.forEach(p => { p.joinedAt = 103 })
  success.phases[0].events = [
    { kind: 'skill', tenureId: 'a', heroId: HERO.ZHU_YOU_JIAN, effect: '处决：命中异阵营', targetSeats: [2] },
    { kind: 'departure', tenureId: 'b', reason: 'skill' },
  ]
  await store.save(success)
  const won = await queries.replay(group); assert.ok(won)
  assert.match(won.phases[0].text, /选择处决2号玩家明月，处决成功/)
  assert.match(won.phases[0].text, /2号玩家明月因武将技能出局/)
  assert.doesNotMatch(won.phases[0].text, /自裁/)
})

it('keeps natural skill departure causes once, including Yuan retaliation on its own author', async () => {
  const { store, queries } = await fixture(), snapshot = input()
  for (let seat = 2; seat <= 6; seat++) snapshot.participants.push({ ...snapshot.participants[0],
    tenureId: 'p' + seat, seat, identity: { platform: 'onebot', userId: 'p' + seat, nickname: '玩家' + seat } })
  snapshot.phases[0].eligibleTenures = snapshot.participants.map(p => p.tenureId)
  snapshot.phases[0].events = [
    { kind: 'skill', tenureId: 'a', heroId: HERO.ZHANG_XIAN_ZHONG, effect: '出局带走', targetSeats: [2] },
    { kind: 'hero-reveal', tenureId: 'p2', heroId: HERO.SHI_KE_FA },
    { kind: 'departure', tenureId: 'p2', reason: 'skill' },
    { kind: 'skill', tenureId: 'p3', heroId: HERO.WU_SAN_GUI, effect: '权计指定出局', targetSeats: [4] },
    { kind: 'departure', tenureId: 'p4', reason: 'skill' },
    { kind: 'skill', tenureId: 'p5', heroId: HERO.YUAN_CHONG_HUAN, effect: '守卫连带出局', targetSeats: [6] },
    { kind: 'hero-reveal', tenureId: 'p5', heroId: HERO.YUAN_CHONG_HUAN },
    { kind: 'departure', tenureId: 'p5', reason: 'skill' },
  ]
  await store.save(snapshot)
  const replay = await queries.replay(group); assert.ok(replay)
  assert.equal(replay.phases[0].text, [
    '第1轮', '1号玩家清风：公开发言检索',
    '2号玩家玩家2被张献忠带走，亮出武将牌：史可法。',
    '4号玩家玩家4被吴三桂指定出局。',
    '5号玩家玩家5被其所守卫的6号玩家玩家6带走，亮出武将牌：袁崇焕。',
  ].join('\n'))
})

it('keeps Lin immunity targets and failed own vote without reporting an unaffected own vote', async () => {
  const { store, queries } = await fixture(), snapshot = input()
  snapshot.participants.push({ ...snapshot.participants[0], tenureId: 'b', seat: 2,
    identity: { platform: 'onebot', userId: 'b', nickname: '明月' } })
  snapshot.phases[0].events = [{ kind: 'skill', tenureId: 'a', heroId: HERO.LIN_DAN_HAN,
    effect: '避实抵消2票；免疫2号玩家明月的投票；本人投票失效', targetSeats: [] }]
  await store.save(snapshot)
  const replay = await queries.replay(group); assert.ok(replay)
  assert.match(replay.phases[0].text, /清风受武将技能保护，免疫2号玩家明月的投票，本人的投票失效。/)
  assert.doesNotMatch(replay.phases[0].text, /未失效/)

  const structured = structuredClone(snapshot)
  structured.gameId = randomUUID(); structured.endedAt = 202
  structured.phases[0].events = [{ kind: 'skill', tenureId: 'a', heroId: HERO.LIN_DAN_HAN,
    effect: '避实抵消2票；本人投票失效', targetSeats: [2] }]
  await store.save(structured)
  const current = await queries.replay(group); assert.ok(current)
  assert.match(current.phases[0].text, /清风受武将技能保护，免疫2号玩家明月的投票，本人的投票失效。/)
})

it('renders skill targets from structured identities after anonymization', async () => {
  const { store, queries } = await fixture(), snapshot = input()
  snapshot.participants.push({ ...snapshot.participants[0], tenureId: 'b', seat: 2,
    identity: { platform: 'onebot', userId: 'b', nickname: '明月' } })
  snapshot.phases[0].events = [{ kind: 'skill', tenureId: 'a', heroId: HERO.SHI_KE_FA,
    effect: '赠予2个伐', targetSeats: [2] },
    { kind: 'skill', tenureId: 'a', heroId: HERO.LIN_DAN_HAN,
      effect: '避实抵消1票', targetSeats: [2] }]
  const redacted = redactHistory(snapshot, historyIdentityKeys(snapshot.participants[1].identity).map(key => ({ key, cutoff: 201 })))
  await store.save(redacted)
  const replay = await queries.replay(group); assert.ok(replay)
  assert.match(replay.phases[0].text, /将2个“伐”标记赠予2号玩家已匿名玩家。/)
  assert.match(replay.phases[0].text, /免疫2号玩家已匿名玩家的投票。/)
  assert.doesNotMatch(replay.phases[0].text, /明月/)
})

it('does not duplicate the tail when a replay phase has multi-line turtle speech', async () => {
  const { store, queries } = await fixture()
  const snapshot = input()
  snapshot.mode = 'turtle'
  snapshot.deerChoices = []
  snapshot.phases[0].speeches = [{ tenureId: 'a', text: '问题：1这是问题；主持回答：1是', question: '这是问题', answer: '是' }]
  snapshot.phases[0].outcomes = ['本轮无人出局，平安夜。']
  await store.save(snapshot)
  const replay = await queries.replay(group)
  assert.ok(replay)
  const content = JSON.stringify(replay.phases[0].content)
  assert.equal((content.match(/答：是/g) ?? []).length, 1)
  assert.equal((content.match(/本轮无人出局，平安夜。/g) ?? []).length, 1)
})

it('renders structured faces after persistence without escaping XML or indexing face attributes', async () => {
  const { app, store, queries } = await fixture()
  const snapshot = input()
  snapshot.phases[0].speeches[0].segments = [
    { kind: 'text', text: '1公开发言' },
    { kind: 'face', id: '14', name: '表情名称测试', platform: 'onebot' },
    { kind: 'face', id: '66', platform: 'onebot' },
  ]
  await store.save(snapshot)
  const replay = await new HistoryQueries(app.database).replay(group)
  assert.ok(replay)
  const content = replay.phases[0].content!.toString()
  assert.match(content, /<face id="14"/)
  assert.match(content, /<face id="66"/)
  assert.doesNotMatch(content, /&lt;face/)
  assert.equal((await queries.list(group, { keyword: '表情名称测试' })).total, 0)
})

it('renders structured media and splits large replay nodes without escaping image markup', async () => {
  const { store, queries } = await fixture()
  const snapshot = input()
  snapshot.phases[0].speeches[0].segments = [{ kind: 'text', text: '1发言[图片]' },
    { kind: 'media', type: 'img', src: 'https://cdn.example/photo.png?signature=needed' }]
  await store.save(snapshot)
  const replay = await queries.replay(group)
  assert.ok(replay)
  assert.match(replay.phases[0].content!.toString(), /<img src="https:\/\/cdn.example\/photo.png\?signature=needed"/)
  assert.doesNotMatch(replay.phases[0].content!.toString(), /&lt;img/)
  const pages = historyContentPages(h('template', {}, h.text('字'.repeat(6000)), replay.phases[0].content!))
  assert.ok(pages.length >= 3)
  assert.equal((pages.map(p => p.toString()).join('').match(/<img /g) ?? []).length, 1)
})

it('filters before ten-row pagination, skips aborted games, and chooses latest normal game after reopen', async () => {
  const { app, store, queries } = await fixture()
  for (let i = 0; i < 13; i++) await store.save(input(i))
  const stopped = input(100); stopped.ending = { kind: 'aborted', reason: 'host-stop' }
  const stoppedSaved = await store.save(stopped)
  assert.ok(stoppedSaved.kind === 'saved')
  const otherGroup = input(110); otherGroup.guildId = 'other'; await store.save(otherGroup)
  const first = await queries.list(group), last = await queries.list(group, { page: 2 })
  assert.equal(first.total, 13); assert.equal(first.entries.length, 10); assert.equal(last.entries.length, 3)
  assert.equal(first.entries[0].startedAt, 112); assert.equal(last.entries.at(-1)!.startedAt, 100)
  assert.equal((await queries.list(group, { from: 103, until: 105 })).total, 2)
  assert.equal((await queries.list(group, { mode: 'turtle' })).total, 0)
  assert.equal((await queries.list(group, { disposition: 'aborted' })).total, 1)
  assert.match((await queries.replay(group, stoppedSaved.id))!.introduction, /中止局.*结束原因：主持人或管理员终止/s)
  const fresh = new HistoryQueries(app.database)
  assert.equal((await fresh.replay(group))!.id, first.entries[0].id)
  await assert.rejects(queries.list(group, { page: 3 }), /只有2页/)
  await assert.rejects(queries.list(group, { from: 100, until: 100 }), /日期范围/)
  assert.equal((await queries.replay(group, undefined, { overtime: true }))!.phases.length, 0)
  assert.equal((await queries.replay(group, undefined, { sequence: 1 }))!.phases.length, 1)
})

it('bounded fallback pages preserve unicode and never dump a whole long replay at once', () => {
  const text = '🙂清风'.repeat(2000), pages = historyTextPages(text, 101)
  assert.ok(pages.length > 1); assert.ok(pages.every(p => p.length <= 101))
  assert.equal(pages.join(''), text)
  assert.ok(pages.every(p => !/[\uD800-\uDBFF]$/.test(p)))
})

it('hides historical choices, permits repeated host publication, and lets the original player unhide by publishing', async () => {
  const { app, store } = await fixture(), snapshot = input()
  const saved = await store.save(snapshot); assert.ok(saved.kind === 'saved')
  const controls = new DeerHistoryControls(app.database, async (_p, id) => id === 'linked-alt' ? 20 : undefined, async id => id === 10 ? 20 : id)
  const host = { ...group, userId: 'host' }, player = { ...group, userId: 'player' }
  assert.doesNotMatch(await controls.change(host, 'reveal'), /清风|绝不能搜到/)
  assert.match(await controls.change(player, 'reveal'), /清风.*绝不能搜到/s)
  assert.match(await controls.change(host, 'reveal'), /清风/)
  assert.match(await controls.change(host, 'reveal'), /清风/)
  await controls.change({ ...group, userId: 'linked-alt' }, 'hide', saved.id)
  assert.doesNotMatch(await controls.change(host, 'reveal'), /清风|隐藏/)
  await assert.rejects(controls.change(group, 'reveal'), /只有该局主持人或参赛玩家/)
  await assert.rejects(controls.change(host, 'hide'), /实际参赛玩家/)
  await assert.rejects(controls.change({ ...player, guildId: 'other' }, 'reveal', saved.id), /没有对应/)
  await assert.rejects(controls.change({ ...player, isDirect: true }, 'reveal'), /原群/)
})

it('lists aborted deer games separately and never grants replacements ownership of earlier occupants choices', async () => {
  const { app, store } = await fixture(), snapshot = input()
  snapshot.ending = { kind: 'aborted', reason: 'host-stop' }
  snapshot.participants[0].leftAt = 150
  snapshot.participants.push({ ...snapshot.participants[0], tenureId: 'replacement', replacedTenureId: 'a', joinedAt: 151, leftAt: undefined,
    identity: { platform: 'onebot', userId: 'replacement', nickname: '补位玩家' } })
  snapshot.deerChoices.push({ tenureId: 'replacement', choice: '补位词', hidden: false })
  await store.save(snapshot)
  const controls = new DeerHistoryControls(app.database)
  assert.deepEqual((await controls.list(group)).entries.map(e => e.aborted), [true])
  const own = await controls.change({ ...group, userId: 'replacement' }, 'reveal')
  assert.match(own, /中止局.*补位玩家.*补位词/s)
  assert.doesNotMatch(own, /清风|绝不能搜到/)
  const later = input(2); await store.save(later)
  const earlier = (await controls.list(group)).entries[1].id
  assert.match(await controls.change({ ...group, userId: 'replacement' }, 'reveal', earlier), /补位词/)
  await assert.rejects(controls.change({ ...group, userId: 'replacement' }, 'reveal'), /只有该局主持人或参赛玩家/)
})
