import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, realpath, unlink, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { captureHistory, archiveDisposition, type HistorySnapshot } from './history-snapshot'
import type { HistoryStore } from './history-store'

const fileName = /^[0-9a-f-]{36}\.json$/i
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export interface HistoryRetryQueue {
  put(snapshot: HistorySnapshot): Promise<void>
  names(): Promise<string[]>
  read(name: string): Promise<HistorySnapshot>
  remove(name: string): Promise<void>
}

/** Instance-private spool for idempotent history persistence retries. */
export class FileHistoryRetryQueue implements HistoryRetryQueue {
  private directory: string
  constructor(private readonly baseDir: string) { this.directory = resolve(baseDir, 'data/undercover-game/history-pending') }
  private async ready() {
    await mkdir(this.directory, { recursive: true })
    // Canonicalize the caller-owned root first (Windows may use an 8.3 temp path).
    const expected = resolve(await realpath(this.baseDir), 'data/undercover-game/history-pending')
    if ((await realpath(this.directory)).toLowerCase() !== expected.toLowerCase()) throw new Error('历史待重试目录不能为链接。')
    return this.directory
  }
  private async path(name: string) {
    if (!fileName.test(name)) throw new Error('无效存档队列文件名。')
    return join(await this.ready(), name)
  }
  async put(input: HistorySnapshot) {
    const snapshot = captureHistory(input)
    const name = snapshot.gameId + '.json', target = await this.path(name)
    const payload = JSON.stringify(snapshot)
    const temp = target + '.' + randomUUID() + '.tmp'
    const handle = await open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ version: 1, digest: digest(payload), payload }))
      await handle.sync()
    } catch (error) {
      await handle.close(); await unlink(temp).catch(() => undefined); throw error
    }
    await handle.close()
    try {
      // Exclusive atomic publication: never replace an existing queued snapshot.
      try { await link(temp, target) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (JSON.stringify(await this.read(name)) !== payload) throw new Error('同一对局已有不同待重试快照。')
      }
    } finally { await unlink(temp).catch(() => undefined) }
  }
  async names() {
    return (await readdir(await this.ready(), { withFileTypes: true })).filter(e => e.isFile() && fileName.test(e.name)).map(e => e.name).sort()
  }
  async read(name: string) {
    const path = await this.path(name), stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 17 * 1024 * 1024) throw new Error('无效待重试文件。')
    const envelope = JSON.parse(await readFile(path, 'utf8'))
    if (envelope.version !== 1 || typeof envelope.payload !== 'string' || digest(envelope.payload) !== envelope.digest) throw new Error('待重试文件校验失败。')
    const snapshot = captureHistory(JSON.parse(envelope.payload))
    if (snapshot.gameId + '.json' !== name) throw new Error('待重试对局 ID 不符。')
    return snapshot as HistorySnapshot
  }
  async remove(name: string) { await unlink(await this.path(name)) }
}

/** Never accepts a callback that runs game logic or awards scores. */
export class HistoryPersistence {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: Pick<HistoryStore, 'save'>, private readonly queue: HistoryRetryQueue,
    private readonly warn: (event: string, gameId?: string) => void) {}
  private report(event: string, gameId?: string) { try { this.warn(event, gameId) } catch {} }
  private serial<T>(task: () => Promise<T>) {
    const result = this.tail.then(task); this.tail = result.catch(() => undefined); return result
  }
  save(input: HistorySnapshot, options = { enabled: true, sandbox: false }) {
    let snapshot: HistorySnapshot
    try { snapshot = captureHistory(input) as HistorySnapshot }
    catch { this.report('invalid-snapshot'); return Promise.resolve({ kind: 'failed' as const }) }
    if (archiveDisposition(snapshot, options) === 'skip') return Promise.resolve({ kind: 'skipped' as const })
    return this.serial(async () => {
      try { return await this.store.save(snapshot, options) }
      catch {
        this.report('database-save-failed', snapshot.gameId)
        try { await this.queue.put(snapshot); return { kind: 'queued' as const } }
        catch { this.report('archive-and-spool-failed', snapshot.gameId); return { kind: 'failed' as const } }
      }
    })
  }
  retry() {
    return this.serial(async () => {
      let names: string[]
      try { names = await this.queue.names() }
      catch { this.report('spool-read-failed'); return { saved: 0, failed: 1 } }
      let saved = 0, failed = 0
      for (const name of names) {
        let id: string | undefined
        try {
          const snapshot = await this.queue.read(name); id = snapshot.gameId
          // Already accepted by capture policy. Allow intentionally archived sandbox
          // records even if the current default excludes new sandbox games.
          const result = await this.store.save(snapshot, { enabled: true, sandbox: true })
          if (result.kind !== 'saved' && result.kind !== 'erased') throw new Error('队列中包含不应保存的对局。')
          await this.queue.remove(name); saved++
        } catch { failed++; this.report('archive-retry-failed', id) }
      }
      return { saved, failed }
    })
  }
}
