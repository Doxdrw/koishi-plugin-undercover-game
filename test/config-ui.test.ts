import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { Config } from '../src'
import { assertGroups, fields, semanticSchema } from './config-contract'

const before = JSON.parse(readFileSync(new URL('./fixtures/config-before-ui.json', import.meta.url), 'utf8'))

it('preserves every configuration key, type, default, constraint and enum value', () => {
  assert.deepEqual(semanticSchema(Config), before.schema)
  assert.deepEqual(Config({}), before.defaults)
  assert.deepEqual(Config(), before.defaults)
  // Schemastery's intersect simplifier omits the old empty debug placeholder.
  // Both serializations must resolve to exactly the frozen old defaults.
  assert.deepEqual(Config(before.emptySimplified), before.defaults)
  assert.deepEqual(Config(Config.simplify(Config({}))), before.defaults)
})

it('preserves legacy explicit false, zero, empty lists and nested configuration', () => {
  const input = { heroesByDefault: false, allowLateJoinByDefault: false, minPlayers: 0,
    enabledHeroes: [], enabledSpecialModes: [], dealMessageInterval: 0, scoreGoodWin: -0.25,
    history: { enabled: false, sandbox: true, retentionDays: 0, mediaRetention: 'days', mediaRetentionDays: 0 },
    notifications: { voteStartPrivate: false, voteHurryGroup: false },
    debug: { enabled: false, privateBodies: true, guilds: ['test-guild'], fileBytes: 16384, entryBytes: 32768 } }
  const expected = { ...before.defaults, ...input,
    debug: { ...before.defaults.debug, ...input.debug },
    notifications: { ...before.defaults.notifications, ...input.notifications } }
  assert.deepEqual(Config(structuredClone(input)), expected)
  assert.deepEqual(Config(Config.simplify(Config(structuredClone(input)))), expected)
})

it('puts short business groups first and one compatible collapsed debug object last', () => {
  assertGroups(Config, ['游戏设置', '开局与发题', '发言、投票与技能时限', '消息提醒', '积分结算', '对局历史', '武将卡面', '高级诊断'])
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
