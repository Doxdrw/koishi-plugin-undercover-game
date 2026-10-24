import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { createRuleCatalog } from '../src/game/rule-catalog'
import { projectPublicGameState, PublicGameTimelineStore, publicMessageText } from '../src/game/public-game-state'
import { installChatLunaGameTools } from '../src/game/chatluna-game-tools'

const guide = readFileSync(new URL('../GAME_GUIDE.md', import.meta.url), 'utf8')
const session = { platform: 'qq', selfId: 'bot', guildId: 'group', userId: 'user', isDirect: false }
const snapshot = {
  route: { platform: 'qq', selfId: 'bot', guildId: 'group' }, mode: 'classic' as const,
  heroesEnabled: true, phase: 'speech' as const, round: 2, overtime: false,
  hostNickname: 'Host', players: [{ seat: 1, nickname: 'Alice<face id="14"/>', status: '在场' as const }],
  publicEvents: [{ id: 1, round: 2, phase: 'speech' as const, overtime: false, text: '1号玩家发言：公开内容' }],
}

it('uses all guide topics as a rule catalog without maintaining a second ruleset', () => {
  const rules = createRuleCatalog(guide)
  const index = rules.read()
  for (const heading of guide.split('\n').filter(line => /^#{2,4} /.test(line))) {
    assert.ok(index.includes(heading.replace(/^#+ /, '').trim()), heading)
  }
  for (const topic of ['基本规则', '鹿模式（群雄逐鹿）', '龟模式（海龟汤）', '白板玩家特殊规则', '朱由检', '积分结算']) {
    const result = rules.read(topic)
    assert.ok(result.includes(topic))
    assert.ok(guide.replace(/\r\n/g, '\n').includes(result.slice(result.indexOf('\n') + 1)))
  }
  assert.match(rules.read('missing'), /主题目录/)
  assert.match(rules.read('../../private'), /主题目录/)
  assert.match(rules.read('朱由检', 999), /页码/)
  assert.match(rules.read('吴三桂'), /援寡/)
  assert.match(rules.read('毛文龙'), /塘报/)
})

it('paginates long guide sections without losing or reordering their source', () => {
  const content = '## 长主题\n' + Array.from({ length: 100 }, (_, i) => `段落${i}：${'字'.repeat(80)}`).join('\n')
  const rules = createRuleCatalog(content)
  assert.match(rules.read('长主题', 1), /第1\/2页/)
  assert.match(rules.read('长主题', 2), /段落99/)
})

it('projects only public state for the actual platform, bot and group', () => {
  const result = projectPublicGameState({ ...snapshot, secret: 'secret-canary', speeches: ['not-a-chat-stream'] } as any, session)
  assert.ok(result)
  assert.equal(result.players[0].nickname, 'Alice')
  assert.doesNotMatch(JSON.stringify(result), /secret|route|userId|speeches|not-a-chat-stream|face/)
  for (const mismatch of [{ platform: 'sandbox' }, { selfId: 'other' }, { guildId: 'other' }, { isDirect: true }]) {
    assert.equal(projectPublicGameState(snapshot, { ...session, ...mismatch }), undefined)
  }
})

it('projects a bounded public timeline without media markup or hidden fields', () => {
  const store = new PublicGameTimelineStore()
  for (let i = 1; i <= 10; i++) store.record({ round: i <= 5 ? 1 : 2, phase: 'voting', overtime: false,
    text: `第${i}条 <img src="https://private.example/${i}?token=secret"/>` })
  const state = projectPublicGameState({ ...snapshot, publicEvents: store.snapshot() }, session)!
  assert.equal(state.timeline.events.length, 8)
  assert.equal(state.timeline.events[0].id, 3)
  assert.match(state.timeline.events[0].text, /\[媒体\]/)
  assert.doesNotMatch(JSON.stringify(state), /private\.example|token=secret|<img/)
  const filtered = projectPublicGameState({ ...snapshot, publicEvents: store.snapshot() }, session,
    { round: 1, limit: 2, page: 2 })!
  assert.deepEqual(filtered.timeline.events.map(event => event.id), [3, 4])
  assert.equal(filtered.timeline.hasMore, true)
  assert.equal(projectPublicGameState({ ...snapshot, publicEvents: store.snapshot() }, { ...session, isDirect: true }), undefined)
})

it('redacts public face and media nodes to safe placeholders', () => {
  assert.equal(publicMessageText('公开内容<face id="123"/><img src="data:image/png;base64,secret"/>'), '公开内容[表情][媒体]')
})

function host(filter: (session: any) => boolean = () => true) {
  const tools = new Map<string, any>(), warnings: string[] = [], children: any[] = []
  const platform = {
    getToolRegistry: () => Object.fromEntries(tools),
    getTool: (name: string) => tools.get(name),
    registerTool(name: string, tool: any) {
      tool.id = name + '-id'; tools.set(name, tool)
      return () => { tools.delete(name) }
    },
  }
  const ctx = {
    inject(_names: string[], callback: (child: any) => void) {
      const disposers: (() => void)[] = []
      const child = { chatluna: { platform }, filter, logger: { warn: (text: string) => warnings.push(text) },
        on: (_event: string, fn: () => void) => disposers.push(fn) }
      children.push({ child, dispose: () => disposers.forEach(fn => fn()) })
      callback(child)
    },
  }
  class FakeTool { constructor(input: any) { Object.assign(this, input) } }
  return { ctx, platform, tools, warnings, children, load: () => ({ DynamicStructuredTool: FakeTool }) }
}

it('does not load AI dependencies when disabled or when ChatLuna is absent', () => {
  const h = host()
  installChatLunaGameTools(h.ctx as any, false, () => undefined, () => { throw new Error('loaded') })
  assert.equal(h.children.length, 0)
  let registered = false
  installChatLunaGameTools({ inject: () => { registered = true } } as any, true, () => undefined, () => { throw new Error('loaded') })
  assert.equal(registered, true)
})

it('separates on-demand rules from state and rechecks the real invocation session', async () => {
  const h = host(s => s.platform === 'qq')
  installChatLunaGameTools(h.ctx as any, true, s => projectPublicGameState(snapshot, s), h.load as any)
  assert.deepEqual([...h.tools.keys()], ['undercover_rules', 'undercover_status'])
  const rules = h.tools.get('undercover_rules').createTool({})
  const status = h.tools.get('undercover_status').createTool({})
  const config = { configurable: { session } }
  assert.match(await rules.func({ topic: '白板玩家特殊规则' }, undefined, config), /白板胜利方式/)
  assert.match(await status.func({}, undefined, config), /Alice/)
  assert.match(await status.func({ round: 2, phase: 'speech', limit: 1 }, undefined, config), /公开内容/)
  assert.doesNotMatch(await status.func({}, undefined, config), /原有发言|白板胜利方式/)
  assert.match(await rules.func({ topic: '朱由检' }, undefined, { configurable: { session: { ...session, platform: 'sandbox' } } }), /不可用/)
  assert.match(await status.func({}, undefined, { configurable: { session: { ...session, guildId: 'other' } } }), /没有进行中/)
  assert.match(await status.func({ guildId: 'group' }, undefined, {}), /不可用/)
  assert.match(await status.func({}, undefined, { configurable: { session: { ...session, isDirect: true } } }), /当前群/)
  h.children[0].dispose()
  assert.equal(h.tools.size, 0)
  assert.match(await rules.func({ topic: '朱由检' }, undefined, config), /不可用/)
})

it('shares one registration across instances and removes only its own tools', async () => {
  const h = host()
  installChatLunaGameTools(h.ctx as any, true, () => undefined, h.load as any)
  installChatLunaGameTools(h.ctx as any, true, s => projectPublicGameState(snapshot, s), h.load as any)
  assert.equal(h.tools.size, 2)
  const status = h.tools.get('undercover_status').createTool({})
  assert.match(await status.func({}, undefined, { configurable: { session } }), /Alice/)
  h.children[0].dispose()
  assert.equal(h.tools.size, 2)
  h.tools.set('undercover_status', { id: 'other-plugin' })
  h.children[1].dispose()
  assert.deepEqual([...h.tools.keys()], ['undercover_status'])
  assert.equal(h.tools.get('undercover_status').id, 'other-plugin')
})

it('does not overwrite collisions and isolates missing API or dependency failures', () => {
  const h = host()
  h.tools.set('undercover_rules', { id: 'existing' })
  installChatLunaGameTools(h.ctx as any, true, () => undefined, h.load as any)
  assert.equal(h.tools.size, 1)
  assert.equal(h.warnings.length, 1)
  const bad = host()
  installChatLunaGameTools(bad.ctx as any, true, () => undefined, () => { throw new Error('secret path') })
  assert.equal(bad.tools.size, 0)
  assert.equal(bad.warnings.length, 1)
  assert.doesNotMatch(bad.warnings[0], /secret path/)
})

it('reports public state read failures without exposing internal errors', async () => {
  const h = host()
  installChatLunaGameTools(h.ctx as any, true, () => { throw new Error('secret-canary') }, h.load as any)
  const result = await h.tools.get('undercover_status').createTool({}).func({}, undefined, { configurable: { session } })
  assert.match(result, /读取失败/)
  assert.doesNotMatch(result, /secret-canary/)
})

it('rolls back partial registration and contains cleanup errors', () => {
  const h = host(), register = h.platform.registerTool
  h.platform.registerTool = (name, tool) => {
    if (name === 'undercover_status') throw new Error('failed second registration')
    return register(name, tool)
  }
  installChatLunaGameTools(h.ctx as any, true, () => undefined, h.load as any)
  assert.equal(h.tools.size, 0)
  assert.equal(h.warnings.length, 1)
  const second = host()
  installChatLunaGameTools(second.ctx as any, true, () => undefined, second.load as any)
  second.platform.getTool = () => { throw new Error('cleanup failure') }
  assert.doesNotThrow(() => second.children[0].dispose())
  assert.equal(second.warnings.length, 2)
})
