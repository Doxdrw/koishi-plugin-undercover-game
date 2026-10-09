import { randomUUID } from 'node:crypto'
import { mkdir, readdir, lstat, unlink, appendFile, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Context, h, type Session } from 'koishi'
import { resolveModeMessageReference } from './game-mode'

export interface DiagnosticConfig {
  enabled?: boolean
  privateBodies?: boolean
  guilds?: string[]
  retentionDays?: number
  fileBytes?: number
  totalBytes?: number
  queueLimit?: number
  entryBytes?: number
}
export interface DiagnosticState { gameId?: string; guildId?: string; phase?: string; revision?: number; seat?: number }
const ownedFile = /^uc-debug-\d{8}-[0-9a-f-]{36}\.jsonl$/
const cleanupInterval = 3600000

function diagnosticText(elements: h[]): string {
  return elements.map(element => {
    if (element.type === 'text') return String(element.attrs.content ?? '')
    if (element.type === 'face') {
      const id = String(element.attrs.id ?? '')
      const name = String(element.attrs.name ?? '')
      return h('face', { ...(/^\d{1,16}$/.test(id) ? { id } : {}),
        ...(name.length <= 32 && /^[\p{L}\p{N} _-]+$/u.test(name) ? { name } : {}) }).toString()
    }
    // No attachment attributes (including filenames/URLs/encodings) reach disk.
    if (['img', 'image', 'audio', 'record', 'voice', 'video', 'file'].includes(element.type)) return '[media]'
    return diagnosticText(element.children)
  }).join('')
}

/** Keep readable text and safe face markers, never media payloads or secrets. */
export function sanitizeDiagnosticBody(value: unknown, limit = 8192): string {
  let text: string
  try { text = typeof value === 'string' ? value : h.normalize(value as h.Fragment).join('') } catch { return '[unrenderable]' }
  if (text.length > limit * 4) text = text.slice(0, limit * 4) + '[truncated]'
  try { text = diagnosticText(h.parse(text)) } catch { return '[unrenderable]' }
  text = text.replace(/(?:XPACCOUNT|XPDEL|XPSYSDEL|XPSYSTEM|UCHIST)-[A-Za-z0-9_-]+/g, '[confirmation-token]')
    .replace(/data:[^\s"'<>]+/gi, '[encoded-media]')
    .replace(/\[CQ:(?:image|record|video|audio|file),[^\]]*\]/gi, '[media]')
    .replace(/base64:\/\/[^\s"'<>]+/gi, '[encoded-media]')
    .replace(/(?:https?|file):\/\/[^\s"'<>]+/gi, url => {
      try { const parsed = new URL(url); return parsed.protocol === 'file:' ? '[local-file]' : `[url:${parsed.hostname}]` }
      catch { return '[url]' }
    })
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[credentials]')
    .replace(/\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;<>]+)/gi, '[credential]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[credentials]')
    .replace(/["'](?:[A-Za-z]:[\\/]|\\\\)[^"'\r\n]*["']/g, '[local-path]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>，。；]+|\\\\[^\s"'<>，。；]+/g, '[local-path]')
    .replace(/(^|[\s"'(=:])\/(?:[^\s"'<>，。；]+\/)*[^\s"'<>，。；]+/g, '$1[local-path]')
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[encoded-media]')
  let result = '', size = 0
  for (const char of text) { const bytes = Buffer.byteLength(char); if (size + bytes > limit) return result + '[truncated]'; result += char; size += bytes }
  return result
}

export class DiagnosticLog {
  private queue: string[] = []
  private writing?: Promise<void>
  private current?: { path: string; bytes: number }
  private closed = false
  private dropped = 0
  private lastWarning = 0
  private cleanupRequested = false
  private readonly cleanupTimer: ReturnType<typeof setInterval>
  private readonly directory: string
  private readonly config: Required<DiagnosticConfig>
  constructor(private readonly baseDir: string, input: DiagnosticConfig = {}, private readonly warning: (message: string) => void = () => {}) {
    this.directory = resolve(baseDir, 'data/undercover-game/logs')
    this.config = { enabled: input.enabled ?? false, privateBodies: input.privateBodies ?? false, guilds: input.guilds ?? [],
      retentionDays: input.retentionDays ?? 7, fileBytes: input.fileBytes ?? 10 * 1024 * 1024, totalBytes: input.totalBytes ?? 200 * 1024 * 1024,
      queueLimit: input.queueLimit ?? 1000, entryBytes: input.entryBytes ?? 16384 }
    if (this.config.enabled && ([this.config.retentionDays, this.config.fileBytes, this.config.totalBytes, this.config.queueLimit, this.config.entryBytes].some(v => !Number.isSafeInteger(v) || v <= 0)
      || this.config.entryBytes < 512 || this.config.fileBytes < this.config.entryBytes || this.config.totalBytes < this.config.fileBytes)) {
      this.config.enabled = false
      this.warn('诊断日志配置无效，已停用诊断；游戏继续。请检查大小、保存期和队列设置。')
    }
    // Expiry remains active when collection is off. Invalid inactive write
    // settings do not prevent startup, and cleanup uses safe retention bounds.
    if (!Number.isSafeInteger(this.config.retentionDays) || this.config.retentionDays <= 0) this.config.retentionDays = 7
    if (!Number.isSafeInteger(this.config.totalBytes) || this.config.totalBytes <= 0) this.config.totalBytes = 200 * 1024 * 1024
    this.requestCleanup()
    this.cleanupTimer = setInterval(() => this.requestCleanup(), cleanupInterval)
    this.cleanupTimer.unref?.()
  }
  get enabled() { return this.config.enabled }
  record(entry: Record<string, unknown> & { guildId?: string; scope: 'group' | 'private'; body?: unknown }) {
    if (!this.config.enabled || this.closed || this.config.guilds.length && !this.config.guilds.includes(entry.guildId ?? '')) return
    if (this.queue.length >= this.config.queueLimit) { this.dropped++; this.warn('诊断日志队列已满，正在丢弃记录。'); return }
    const body = entry.scope === 'private' && !this.config.privateBodies ? '[private body disabled]' : sanitizeDiagnosticBody(entry.body, Math.floor(this.config.entryBytes / 3))
    // Caller supplies allowlisted metadata, never a session/config/error object.
    const data = { ...entry, body, timestamp: Date.now(), ...(this.dropped ? { droppedBefore: this.dropped } : {}) }
    this.dropped = 0
    let line = JSON.stringify(data) + '\n'
    if (Buffer.byteLength(line) > this.config.entryBytes) line = JSON.stringify({ timestamp: Date.now(), scope: entry.scope, event: 'entry-metadata-truncated' }) + '\n'
    this.queue.push(line)
    this.pump()
  }
  private warn(message: string) { if (this.lastWarning && Date.now() - this.lastWarning < 60000) return; this.lastWarning = Date.now(); try { this.warning(message) } catch {} }
  private async ready(create: boolean) {
    if (create) await mkdir(this.directory, { recursive: true })
    let info
    try { info = await lstat(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !create) return false; throw error }
    if (!info.isDirectory() || info.isSymbolicLink()
      || (await realpath(this.directory)).toLowerCase() !== resolve(await realpath(this.baseDir), 'data/undercover-game/logs').toLowerCase()) throw new Error('日志目录不能是链接。')
    return true
  }
  private async clean(incoming = 0) {
    const files = []
    for (const entry of await readdir(this.directory, { withFileTypes: true })) if (entry.isFile() && ownedFile.test(entry.name)) {
      const path = join(this.directory, entry.name), info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) continue
      files.push({ path, size: info.size, time: info.mtimeMs })
    }
    files.sort((a,b) => a.time - b.time || a.path.localeCompare(b.path))
    let total = files.reduce((sum, f) => sum + f.size, 0)
    for (const file of files) {
      if (file.time >= Date.now() - this.config.retentionDays * 86400000 && total + incoming <= this.config.totalBytes) continue
      await unlink(file.path); total -= file.size
      if (this.current?.path === file.path) this.current = undefined
    }
  }
  private requestCleanup() {
    if (this.closed) return
    this.cleanupRequested = true
    this.pump()
  }
  private pump() {
    if (this.writing) return
    this.writing = (async () => {
      try {
        if (!await this.ready(this.queue.length > 0)) { this.cleanupRequested = false; return }
        if (this.cleanupRequested) { this.cleanupRequested = false; await this.clean() }
        while (this.queue.length) {
          const line = this.queue.shift()!, bytes = Buffer.byteLength(line)
          if (this.current && this.current.bytes + bytes > this.config.fileBytes) this.current = undefined
          await this.clean(bytes)
          if (!this.current) this.current = { path: join(this.directory, `uc-debug-${new Date().toISOString().slice(0,10).replaceAll('-', '')}-${randomUUID()}.jsonl`), bytes: 0 }
          await appendFile(this.current.path, line, { encoding: 'utf8', mode: 0o600 }); this.current.bytes += bytes
        }
      } catch { this.cleanupRequested = false; this.dropped += this.queue.length; this.queue = []; this.current = undefined; this.warn('诊断日志写入或清理失败，游戏继续；请检查目录或磁盘。') }
    })().finally(() => { this.writing = undefined; if (this.queue.length || this.cleanupRequested) this.pump() })
  }
  async flush() { while (this.writing) await this.writing }
  async close() { this.closed = true; clearInterval(this.cleanupTimer); await this.flush() }
}

interface InputRecord { raw: string; recorded: boolean; session: Session; state?: DiagnosticState }
/** Scoped proxies affect this plugin's callbacks only. next() always receives the
 * original session in the dispatcher; other plugins are neither logged nor patched. */
export class GameDiagnostics {
  private readonly inputs = new WeakMap<object, InputRecord>()
  private readonly contexts = new WeakMap<object, Context>()
  private readonly commands = new WeakMap<object, any>()
  private readonly returned = new Map<string, Array<{ body: string; meta: ReturnType<GameDiagnostics['metadata']>; time: number }>>()
  private readonly observerContexts = new WeakSet<object>()
  private readonly sending = new WeakMap<object, { body: string; meta: ReturnType<GameDiagnostics['metadata']> }>()
  constructor(readonly log: DiagnosticLog, private readonly state: (session?: Session) => DiagnosticState) {}
  private metadata(session: Session) {
    let state: DiagnosticState = {}
    try { state = this.state(session) } catch {}
    const input = this.inputs.get(session)
    if (!state.gameId && input?.state?.gameId) state = { ...input.state, ...state, gameId: input.state.gameId, guildId: input.state.guildId }
    else if (state.gameId && input) input.state = { ...state }
    const reference = resolveModeMessageReference({ quote: session.quote, eventQuote: session.event.message?.quote,
      rawMessage: session.event._data?.message, onebotMessage: (session as any).onebot?.message })
    return { ...state, platform: session.platform, selfId: session.selfId, userId: session.userId,
      guildId: session.guildId ?? state.guildId, messageId: session.messageId,
      referenceId: reference?.messageId,
      scope: session.isDirect ? 'private' as const : 'group' as const }
  }
  private input(session: Session): InputRecord {
    let record = this.inputs.get(session)
    if (record) return record
    let initial: DiagnosticState = {}
    try { initial = this.state(session) } catch {}
    record = { raw: session.content, recorded: false, session, state: initial }
    this.inputs.set(session, record)
    return record
  }
  private handled(record: InputRecord, handler: string, result?: unknown, failure = false) {
    if (!record.recorded) {
      record.recorded = true
      this.log.record({ ...this.metadata(record.session), direction: 'in', handler, result: failure ? 'exception' : 'handled', body: record.raw })
    }
  }
  private returnedResult(session: Session, result: unknown) {
    if (!result) return
    const key = this.replyKey(session)
    const body = h.normalize(result as h.Fragment).join(''), pending = this.returned.get(key) ?? []
    pending.push({ body, meta: this.metadata(session), time: Date.now() })
    if (pending.length > 16) pending.shift()
    this.returned.set(key, pending)
    for (const [id, entries] of this.returned) if (!entries.length || entries.at(-1)!.time < Date.now() - 300000) this.returned.delete(id)
    while (this.returned.size > 500) this.returned.delete(this.returned.keys().next().value!)
    this.log.record({ ...this.metadata(session), direction: 'return', result: 'returned-to-caller', body })
  }
  private replyKey(session: { platform: string; selfId: string; channelId?: string; userId?: string; messageId?: string; id?: string | number }) {
    return JSON.stringify([session.platform, session.selfId, session.channelId, session.userId, session.messageId ?? session.id])
  }
  private async sendOwned(session: Session, body: h.Fragment) {
    const elements = h.normalize(body)
    if (!elements.length) return []
    const meta = this.metadata(session)
    try {
      const ids = await session.bot.sendMessage(session.channelId, elements, session.event.referrer, { session })
      this.log.record({ ...meta, direction: 'out', result: ids?.length ? 'api-success' : 'api-empty', body, returnedIds: ids })
      return ids
    } catch {
      this.log.record({ ...meta, direction: 'out', result: 'api-failed', body })
      // Match Koishi Session.send: report a failed send, do not make it a game
      // transition failure. Direct bot sends still propagate their own errors.
      return []
    }
  }
  private wrapSession(session: Session, record: InputRecord): Session {
    const bot = new Proxy(session.bot, { get: (target, property) => {
      const value = Reflect.get(target, property, target)
      if (property !== 'sendMessage' && property !== 'sendPrivateMessage') return typeof value === 'function' ? value.bind(target) : value
      return async (...args: any[]) => {
        this.handled(record, 'send')
        const meta = this.metadata(session), direct = property === 'sendPrivateMessage' || session.isDirect && args[0] === session.channelId
        const entry = { ...meta, scope: direct ? 'private' as const : 'group' as const, target: String(args[0]),
          guildId: direct ? meta.guildId : String(args[0]), direction: 'out', body: args[1] }
        try { const result = await value.apply(target, args); this.log.record({ ...entry, result: 'api-success', returnedIds: result }); return result }
        catch (error) { this.log.record({ ...entry, result: 'api-failed' }); throw error }
      }
    } })
    const proxy = new Proxy(session, { get: (target, key, receiver) => {
      if (key === 'bot') return bot
      if (key === 'send') return async (...args: any[]) => {
        // Explicit sends are owned without relying on the dispatcher's reply matcher.
        this.handled(record, 'send')
        return this.sendOwned(session, args[0])
      }
      return Reflect.get(target, key, receiver)
    } })
    return proxy
  }
  private middleware(callback: any, name: string) {
    return async (session: Session, next: any) => {
      const record = this.input(session); let forwarded = false
      try {
        const result = await callback(this.wrapSession(session, record), (...args: any[]) => { forwarded = true; return next(...args) })
        if (!forwarded) {
          this.handled(record, name, result)
          this.returnedResult(session, result)
        }
        return result
      } catch (error) { this.handled(record, name, undefined, true); throw error }
    }
  }
  context(ctx: Context): Context {
    if (!this.log.enabled) return ctx
    if (!this.observerContexts.has(ctx)) {
      this.observerContexts.add(ctx)
      ctx.before('send', (outgoing, options) => {
        const original = options.session
        if (!original) return
        const pending = this.returned.get(this.replyKey(original))
        if (!pending?.length) return
        const body = h.normalize(outgoing.elements).join('')
        const index = pending.findIndex(p => p.body === body)
        if (index < 0) return
        const [item] = pending.splice(index, 1)
        this.sending.set(outgoing, item)
        this.log.record({ ...item.meta, direction: 'out', result: 'framework-send-requested', body })
      })
      ctx.on('send', outgoing => {
        const item = this.sending.get(outgoing)
        if (!item) return
        this.sending.delete(outgoing)
        this.log.record({ ...item.meta, direction: 'out', result: 'adapter-send-event', body: item.body,
          returnedIds: outgoing.messageId ? [outgoing.messageId] : [] })
      })
    }
    const existing = this.contexts.get(ctx); if (existing) return existing
    const proxy = new Proxy(ctx, { get: (target, property) => {
      const value = Reflect.get(target, property, target)
      // Callable services carry methods/properties; Function.bind would strip
      // logger.warn/error (and similar service surfaces).
      if (property === 'logger' || property === 'http') return value
      if (property === 'middleware') return (callback: any, ...args: any[]) => value.call(target, this.middleware(callback, 'middleware'), ...args)
      if (property === 'command') return (...args: any[]) => this.command(value.apply(target, args))
      if (['guild', 'exclude', 'intersect', 'union', 'select'].includes(String(property))) return (...args: any[]) => {
        const result = value.apply(target, args); return result instanceof Context ? this.context(result) : result
      }
      return typeof value === 'function' ? value.bind(target) : value
    } })
    this.contexts.set(ctx, proxy); return proxy
  }
  private command(command: any): any {
    if (this.commands.has(command)) return this.commands.get(command)
    const execute = command.execute
    command.execute = async (argv: any, ...args: any[]) => {
      if (!argv.session) return execute.call(command, argv, ...args)
      const record = this.input(argv.session)
      const result = await execute.call(command, argv, ...args)
      this.handled(record, 'command:' + command.name, result)
      this.returnedResult(argv.session, result)
      return result
    }
    const proxy = new Proxy(command, { get: (target, property) => {
      const value = Reflect.get(target, property, target)
      if (property === 'action') return (callback: any, ...rest: any[]) => {
        value.call(target, async (argv: any, ...args: any[]) => {
          const record = this.input(argv.session)
          try {
            const result = await callback({ ...argv, session: this.wrapSession(argv.session, record) }, ...args)
            this.handled(record, 'command:' + target.name, result)
            return result
          } catch (error) { this.handled(record, 'command:' + target.name, undefined, true); throw error }
        }, ...rest)
        return proxy
      }
      return typeof value === 'function' ? (...args: any[]) => { const result = value.apply(target, args); return result === target ? proxy : result } : value
    } })
    this.commands.set(command, proxy); return proxy
  }
}
