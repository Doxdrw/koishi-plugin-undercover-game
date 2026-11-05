import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { Config } from '../src'
import { assertGroups, fields, semanticSchema } from './config-contract'

const before = JSON.parse(readFileSync(new URL('./fixtures/config-before-ui.json', import.meta.url), 'utf8'))
const addedKeys = ['aiTools', 'reportImages', 'deerReselectionDeadline', 'deerPreviousSpeechPolicy', 'deerMakeupTimeout', 'deerSpeechReviewDefault',
  'deerHostTimeoutAction', 'boomHostTimeoutAction', 'turtleHostTimeoutAction', 'deerSpeechReviewTimeoutAction', 'hostRecruitmentTimeout', 'realtimeSkillNoticeDefault']
const originalDefaults = (values: any) => {
  const result: any = structuredClone(Object.fromEntries(Object.entries(values).filter(([key]) => !addedKeys.includes(key))))
  delete result.history?.winrateMinimumGames
  delete result.notifications?.whiteGuessHost
  return result
}

it('preserves every configuration key, type, default, constraint and enum value', () => {
  const originalSchema = semanticSchema(Config)
  for (const key of addedKeys) delete originalSchema.dict[key]
  delete originalSchema.dict.history.dict.winrateMinimumGames
  delete originalSchema.dict.notifications.dict.whiteGuessHost
  assert.deepEqual(originalSchema, before.schema)
  assert.deepEqual(originalDefaults(Config({})), before.defaults)
  assert.deepEqual(originalDefaults(Config()), before.defaults)
  // Schemastery's intersect simplifier omits the old empty debug placeholder.
  // Both serializations must resolve to exactly the frozen old defaults.
  assert.deepEqual(originalDefaults(Config(before.emptySimplified)), before.defaults)
  assert.deepEqual(originalDefaults(Config(Config.simplify(Config({})))), before.defaults)
})

it('preserves legacy explicit false, zero, empty lists and nested configuration', () => {
  const input = { heroesByDefault: false, allowLateJoinByDefault: false, minPlayers: 0,
    enabledHeroes: [], enabledSpecialModes: [], dealMessageInterval: 0, scoreGoodWin: -0.25,
    history: { enabled: false, sandbox: true, retentionDays: 0, mediaRetention: 'days', mediaRetentionDays: 0 },
    notifications: { voteStartPrivate: false, voteHurryGroup: false },
    debug: { enabled: false, privateBodies: true, guilds: ['test-guild'], fileBytes: 16384, entryBytes: 32768 } }
  const expected = { ...before.defaults, aiTools: { enabled: false }, ...input,
    debug: { ...before.defaults.debug, ...input.debug },
    notifications: { ...before.defaults.notifications, ...input.notifications } }
  assert.deepEqual(originalDefaults(Config(structuredClone(input))), originalDefaults(expected))
  assert.deepEqual(originalDefaults(Config(Config.simplify(Config(structuredClone(input))))), originalDefaults(expected))
})

it('puts short business groups first and one compatible collapsed debug object last', () => {
  assert.equal(Config({}).notifications.whiteGuessHost, true)
  assert.equal(Config({ notifications: { whiteGuessHost: false } }).notifications.whiteGuessHost, false)
  assertGroups(Config, ['游戏设置', '开局与发题', '发言、投票与技能时限', '鹿模式重选与补发言', '主持人超时与协同主持', '消息提醒', '积分结算', '对局历史', '武将卡面', '总结与选词图片', 'AI 工具', '高级诊断'])
  const all = fields(Config)
  assert.equal(Object.keys(Config.list.at(-1).dict).join(), 'debug')
  assert.equal(all.debug.type, 'object')
  assert.equal(all.debug.meta.collapse, true)
  assert.ok(!all.debug.list, 'no ineffective nested intersect/collapse')
  assert.equal(all.history.meta.description, undefined, 'no duplicate history heading')
  assert.equal(all.notifications.meta.description, undefined, 'no duplicate notification heading')
})

it('shows readable mode/media choices without changing their stored values', () => {
  const all = fields(Config)
  assert.deepEqual(all.enabledSpecialModes.inner.list.map((item: any) => [item.value, item.meta.description]),
    [['deer', '鹿模式'], ['turtle', '龟模式']])
  assert.deepEqual(all.history.dict.mediaRetention.list.map((item: any) => [item.value, item.meta.description]),
    [['next-game', '保留至同一机器人下一局'], ['permanent', '永久保留引用'], ['days', '按结束时间保留指定天数']])
})

it('groups the independent skill notice switch with message reminders and defaults it off', () => {
  assert.equal(Config({}).realtimeSkillNoticeDefault, false)
  const explicit = Config({ realtimeSkillNoticeDefault: true, realtimeVoteNoticeDefault: false })
  assert.equal(explicit.realtimeSkillNoticeDefault, true)
  assert.equal(explicit.realtimeVoteNoticeDefault, false)
  const messageGroup = Config.list.find((group: any) => group.meta.description === '消息提醒')
  assert.ok(messageGroup?.dict.realtimeSkillNoticeDefault)
  assert.ok(messageGroup?.dict.realtimeVoteNoticeDefault)
})

it('keeps distinct host timeout defaults and accepts an explicit abort policy', () => {
  const defaults = Config({})
  assert.equal(defaults.deerHostTimeoutAction, 'auto')
  assert.equal(defaults.boomHostTimeoutAction, 'auto')
  assert.equal(defaults.turtleHostTimeoutAction, 'abort')
  assert.equal(defaults.deerSpeechReviewTimeoutAction, 'auto')
  assert.equal(defaults.deerSpeechReviewDefault, 'reject')
  assert.equal(defaults.hostRecruitmentTimeout, 300)
  assert.equal(defaults.history.winrateMinimumGames, 5)
  const explicit = Config({ deerHostTimeoutAction: 'abort', boomHostTimeoutAction: 'recruit', turtleHostTimeoutAction: 'recruit' })
  assert.equal(explicit.deerHostTimeoutAction, 'abort')
  assert.equal(explicit.boomHostTimeoutAction, 'recruit')
  assert.equal(explicit.turtleHostTimeoutAction, 'recruit')
})
