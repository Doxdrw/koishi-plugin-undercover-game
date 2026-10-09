import assert from 'node:assert/strict'
import { it, mock } from 'node:test'
import type { Context } from 'koishi'
import { GameUserError, safeErrorSummary } from '../src/game/errors'
import { registerHistoryCommands } from '../src/game/history-commands'
import { HeroCardService } from '../src/game/hero-card-service'
import { UndercoverGameHarness } from './game-harness'

const secret = 'synthetic-credential'
const failure = () => Object.assign(new Error(`请求失败：Authorization=Bearer ${secret} C:/fixture/private.json`),
  { code: 'ECONNRESET', config: { headers: { Authorization: secret } } })

function commands() {
  const actions = new Map<string, (...args: any[]) => any>(), logs: unknown[][] = []
  const ctx = { logger: { warn: (...args: unknown[]) => logs.push(args) }, middleware() {}, on() {},
    command: (declaration: string) => {
      let chain: any
      chain = new Proxy({}, { get: (_, key) => key === 'action'
        ? (fn: (...args: any[]) => any) => { actions.set(declaration.split(' ')[0], fn); return chain }
        : () => chain })
      return chain
    } } as unknown as Context
  return { ctx, actions, logs }
}
const session = { platform: 'onebot', selfId: 'test-bot', userId: 'tester', guildId: 'test-group', channelId: 'test-group', isDirect: false }

it('hides unknown history errors and logs only a bounded error summary', async () => {
  const { ctx, actions, logs } = commands()
  registerHistoryCommands(ctx, { list: async () => { throw failure() } } as any, {} as any, {} as any, async () => {})
  const result = await actions.get('历史对局')!({ session, options: {} }, 1)
  assert.equal(result, '历史操作未完成，请管理员检查日志。')
  assert.doesNotMatch(JSON.stringify(logs), /synthetic-credential|private\.json|Authorization|headers|config/)
})

it('keeps explicitly authored history validation useful', async () => {
  const { ctx, actions } = commands()
  registerHistoryCommands(ctx, { list: async () => { throw new GameUserError('页码须为正整数。') } } as any, {} as any, {} as any, async () => {})
  assert.equal(await actions.get('历史对局')!({ session, options: {} }, 1), '页码须为正整数。')
})

it('does not leak an unknown card-replacement exception to the administrator', async () => {
  const game = await UndercoverGameHarness.create()
  const replacement = mock.method(HeroCardService.prototype, 'replaceFromSource', async () => { throw failure() })
  try {
    await game.addUser('admin', '管理员', 5)
    await game.sendGroup('admin', '替换卡面 朱由检 <img src="https://example.invalid/card.png"/>')
    const body = game.transcript.filter(row => row.direction === 'out').map(row => row.content).join('\n')
    assert.match(body, /卡面替换失败/)
    assert.doesNotMatch(body, /synthetic-credential|private\.json|Authorization/)
  } finally { replacement.mock.restore(); await game.stop() }
})

it('error summaries ignore arbitrary properties, text, stack and hostile getters', () => {
  assert.equal(safeErrorSummary(failure()), 'Error [ECONNRESET]')
  assert.equal(safeErrorSummary({ name: secret, code: secret, message: secret, status: 503 }), 'Error [HTTP 503]')
  assert.equal(safeErrorSummary({ get name() { throw failure() } }), 'UnknownError')
  assert.equal(safeErrorSummary(secret), 'UnknownError')
  let nameReads = 0, codeReads = 0
  assert.equal(safeErrorSummary({
    get name() { return ++nameReads < 3 ? 'Error' : secret },
    get code() { return ++codeReads < 3 ? 'ECONNRESET' : secret },
  }), 'Error [ECONNRESET]')
  assert.deepEqual([nameReads, codeReads], [1, 1])
})
