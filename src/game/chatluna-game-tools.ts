import { createRequire } from 'node:module'
import type { Context, Session } from 'koishi'
import { loadRuleCatalog } from './rule-catalog'
import type { GameToolSession, PublicGameState, PublicGameStateQuery } from './public-game-state'

interface ToolDefinition {
  id?: string
  createTool: (params: unknown) => unknown
  selector: () => boolean
  authorization: (session: Session) => boolean
  description: string
  meta: Record<string, unknown>
}
interface Platform {
  registerTool(name: string, definition: ToolDefinition): () => void
  getToolRegistry(): Record<string, unknown>
  getTool(name: string): { id?: string }
}
interface ToolRuntime { DynamicStructuredTool: new (input: Record<string, unknown>) => unknown }
interface Binding {
  child: Context
  read: (session: GameToolSession, query?: PublicGameStateQuery) => PublicGameState | undefined
  scores?: () => string
}
interface Registration { bindings: Set<Binding>, dispose: () => void }
const registrations = new WeakMap<Platform, Registration>()
const names = ['undercover_rules', 'undercover_status'] as const

function loadToolRuntime(): ToolRuntime {
  // Use ChatLuna's declared LangChain dependency and public export. The peer is
  // optional; no AI package is loaded until the optional service scope starts.
  const ownRequire = createRequire(__filename)
  const peerRequire = createRequire(ownRequire.resolve('koishi-plugin-chatluna'))
  const runtime = peerRequire('@langchain/core/tools')
  if (typeof runtime.DynamicStructuredTool !== 'function') throw new Error('Unsupported tool runtime')
  return runtime
}

export function installChatLunaGameTools(
  ctx: Context, enabled: boolean, read: Binding['read'], load: () => ToolRuntime = loadToolRuntime,
  scores?: Binding['scores'],
): void {
  if (!enabled) return
  ;(ctx as any).inject(['chatluna'], (child: Context) => {
    const platform = (child as Context & { chatluna?: { platform?: Platform } }).chatluna?.platform
    if (!platform || typeof platform.registerTool !== 'function' || typeof platform.getToolRegistry !== 'function'
      || typeof platform.getTool !== 'function') {
      child.logger.warn('卧底规则工具未启用：ChatLuna 缺少公开工具接口。')
      return
    }
    let registration = registrations.get(platform)
    if (!registration) {
      const cleanup: Array<() => void> = []
      const clean = () => {
        for (const dispose of [...cleanup].reverse()) {
          try { dispose() }
          catch { child.logger.warn('卧底规则工具注销失败，请检查 ChatLuna 服务。') }
        }
      }
      try {
        if (names.some(name => Object.hasOwn(platform.getToolRegistry(), name))) throw new Error('Tool name collision')
        const { DynamicStructuredTool } = load(), rules = loadRuleCatalog(), bindings = new Set<Binding>()
        const select = (session: Session | undefined) => {
          if (!session || !session.platform || !session.selfId) return []
          return [...bindings].filter(binding => binding.child.filter(session))
        }
        for (const name of names) {
          const description = name === 'undercover_rules'
            ? '按需读取本插件游戏指南。topic为空先列全部主题，再按主题读取模式、阶段、武将或计分规则；page用于长主题。'
            : '只读查询当前群的卧底模式、阶段、轮次、公开名单和已公开时间线。不接收目标群参数；不会返回题面、雷点、身份、未公开武将或私聊。可用 round/phase/page/limit 缩小公开事件范围。'
          const definition: ToolDefinition = {
            description, selector: () => true,
            authorization: session => select(session).length > 0 && (name === 'undercover_rules' || !!session.guildId && !session.isDirect),
            meta: { source: 'extension', group: 'undercover-game', tags: ['read-only'],
              defaultAvailability: { enabled: true, main: true, subAgent: true, chatluna: true, characterScope: name === 'undercover_rules' ? 'all' : 'group' } },
            createTool: () => new DynamicStructuredTool({
              name, description,
              schema: { type: 'object', properties: name === 'undercover_rules'
                ? { topic: { type: 'string', description: '主题目录中的标题或完整路径；留空查询目录' }, page: { type: 'integer', minimum: 1 } }
                : {
                  round: { type: 'integer', minimum: 1, description: '只看指定轮次的公开事件' },
                  phase: { type: 'string', enum: ['gathering', 'setup', 'dealing', 'speech', 'voting', 'resolving', 'adjudication'], description: '只看指定阶段' },
                  page: { type: 'integer', minimum: 1, description: '时间线页码' },
                  limit: { type: 'integer', minimum: 1, maximum: 20, description: '每页事件数，默认8' },
                }, additionalProperties: false },
              func: async (input: Record<string, unknown>, _manager: unknown, config: { configurable?: { session?: Session } } | undefined) => {
                const session = config?.configurable?.session, available = select(session), binding = available[0]
                if (!binding) return '当前会话不可用此工具。'
                if (!input || typeof input !== 'object' || Array.isArray(input)
                  || Object.keys(input).some(key => name === 'undercover_rules'
                    ? !['topic', 'page'].includes(key)
                    : !['round', 'phase', 'page', 'limit'].includes(key))) return '工具参数不正确。'
                if (name === 'undercover_rules') {
                  if (input.topic !== undefined && (typeof input.topic !== 'string' || input.topic.length > 160)
                    || input.page !== undefined && (!Number.isSafeInteger(input.page) || Number(input.page) < 1)) return '主题或页码不正确。'
                  const topic = (input.topic as string | undefined) ?? ''
                  const result = rules.read(topic, (input.page as number | undefined) ?? 1)
                  return result + (/(?:^|\/)\s*积分结算$/.test(topic.trim()) && binding.scores
                    ? '\n\n当前配置分值：\n' + binding.scores() : '')
                }
                if (session!.isDirect || !session!.guildId) return '仅支持查询当前群的公开对局状态。'
                try {
                  const query: PublicGameStateQuery = {}
                  for (const key of ['round', 'page', 'limit'] as const) {
                    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || Number(input[key]) < 1)) return '轮次、页码和条数必须是正整数。'
                    if (key === 'limit' && input[key] !== undefined && Number(input[key]) > 20) return '每页最多查询20条公开事件。'
                    if (input[key] !== undefined) query[key] = Number(input[key])
                  }
                  if (input.phase !== undefined) {
                    if (typeof input.phase !== 'string' || !['gathering', 'setup', 'dealing', 'speech', 'voting', 'resolving', 'adjudication'].includes(input.phase)) return '阶段参数不正确。'
                    query.phase = input.phase as PublicGameStateQuery['phase']
                  }
                  for (const current of available) {
                    const state = current.read(session!, query)
                    if (state) return JSON.stringify(state)
                  }
                  return '当前群没有进行中的卧底对局。'
                }
                catch { return '本次公开状态读取失败，请稍后重试。' }
              },
            }),
          }
          const dispose = platform.registerTool(name, definition)
          if (typeof dispose !== 'function') throw new Error('Unsupported tool lifecycle')
          if (!definition.id) { dispose(); throw new Error('Missing tool registration identity') }
          cleanup.push(() => { if (platform.getTool(name)?.id === definition.id) dispose() })
        }
        registration = { bindings, dispose: clean }
        registrations.set(platform, registration)
      }
      catch {
        clean()
        child.logger.warn('卧底规则工具未启用：请检查 ChatLuna 版本、依赖或工具名称冲突；游戏继续运行。')
        return
      }
    }
    const current = registration, binding: Binding = { child, read, scores }
    current.bindings.add(binding)
    child.on('dispose', () => {
      current.bindings.delete(binding)
      if (current.bindings.size) return
      registrations.delete(platform)
      try { current.dispose() }
      catch { child.logger.warn('卧底规则工具注销失败，请检查 ChatLuna 服务。') }
    })
  })
}
