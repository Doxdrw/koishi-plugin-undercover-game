import { GameUserError } from './errors'
import { createHash } from 'node:crypto'
import type { Context } from 'koishi'
import { captureHistory, archiveDisposition, type HistorySnapshot } from './history-snapshot'
import { redactHistory, loadStoredHistory } from './history-privacy'

export interface HistoryGameRow {
  id: number
  gameId: string
  platform: string
  selfId: string
  guildId: string
  mode: string
  disposition: string
  startedAt: number
  endedAt: number
  digest: string
  payload: string
}
export interface HistoryPhaseRow { gameId: string; sequence: number; payload: string }
export interface HistoryChoiceRow { gameId: string; tenureId: string; choice: string | null; hidden: boolean }
export interface HistoryErasureRow { key: string }
export type HistoryMediaRetention =
  | { mode: 'next-game' }
  | { mode: 'permanent' }
  | { mode: 'days'; days: number }
declare module 'koishi' {
  interface Tables {
    undercover_history_game: HistoryGameRow
    undercover_history_phase: HistoryPhaseRow
    undercover_history_choice: HistoryChoiceRow
    undercover_history_erasure: HistoryErasureRow
  }
}

/** Staged model: register only when live capture, privacy/deletion and retry are integrated. */
export function registerHistoryModels(ctx: Context) {
  ctx.model.extend('undercover_history_game', {
    id: 'unsigned', gameId: 'string', platform: 'string', selfId: 'string', guildId: 'string',
    mode: 'string', disposition: 'string', startedAt: 'double', endedAt: 'double', digest: 'string', payload: 'text',
  }, { primary: 'id', autoInc: true, unique: ['gameId'], indexes: [['platform', 'selfId', 'guildId', 'endedAt']] })
  ctx.model.extend('undercover_history_phase', { gameId: 'string', sequence: 'unsigned', payload: 'text' }, { primary: ['gameId', 'sequence'] })
  ctx.model.extend('undercover_history_choice', {
    gameId: 'string', tenureId: 'string', choice: { type: 'text', nullable: true }, hidden: 'boolean',
  }, { primary: ['gameId', 'tenureId'] })
  ctx.model.extend('undercover_history_erasure', { key: 'string' }, { primary: 'key' })
  ctx.model.extend('undercover_history_redaction', { key: 'string', cutoff: 'double' }, { primary: 'key' })
}

const erasureKey = (gameId: string) => createHash('sha256').update('undercover-history-erasure:v1:' + gameId).digest('hex')
const mediaKey = (platform: string, selfId: string) => createHash('sha256')
  .update('undercover-history-media-boundary:v1:' + JSON.stringify([platform, selfId])).digest('hex')

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}

/** Internal persistence boundary, not a user-facing query API. No score writes. */
export class HistoryStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly database: Context['database'],
    private readonly retentionDays = 0,
    private readonly mediaRetention: HistoryMediaRetention = { mode: 'next-game' },
  ) {}
  async deletionFingerprint(gameId: string, database = this.database) {
    const row = (await database.get('undercover_history_game', { gameId }))[0]
    if (!row) throw new GameUserError('历史记录已不存在。')
    return createHash('sha256').update(canonical(await loadStoredHistory(database, row))).digest('hex')
  }

  save(input: HistorySnapshot, options = { enabled: true, sandbox: false }): Promise<{ kind: 'skipped' | 'erased' } | { kind: 'saved'; id: number; repeated: boolean }> {
    const snapshot = captureHistory(input)
    const disposition = archiveDisposition(snapshot, { ...options })
    if (disposition === 'skip') return Promise.resolve({ kind: 'skipped' })
    const json = canonical(snapshot)
    const digest = createHash('sha256').update(json).digest('hex')
    const task = this.tail.then(() => this.database.transact(async db => {
      if ((await db.get('undercover_history_erasure', { key: erasureKey(snapshot.gameId) })).length) return { kind: 'erased' as const }
      if (this.retentionDays > 0 && snapshot.endedAt < Date.now() - this.retentionDays * 86400000) {
        await db.create('undercover_history_erasure', { key: erasureKey(snapshot.gameId) })
        return { kind: 'erased' as const }
      }
      const old = (await db.get('undercover_history_game', { gameId: snapshot.gameId }))[0]
      if (old) {
        if (old.digest !== digest) throw new Error('对局 UUID 已存在但快照内容不同，拒绝覆盖。')
        return { kind: 'saved' as const, id: old.id, repeated: true }
      }
      const sanitized = redactHistory(snapshot, await db.get('undercover_history_redaction', {}))
      // A late database retry must respect a next-game cleanup which already
      // committed. Store the boundary in the existing generic cutoff table.
      const marker = (await db.get('undercover_history_redaction', { key: mediaKey(snapshot.platform, snapshot.selfId) }))[0]
      if ((marker && snapshot.endedAt < marker.cutoff) || this.mediaRetention.mode === 'days'
        && snapshot.endedAt < Date.now() - Math.max(1, this.mediaRetention.days) * 86400000) {
        for (const phase of sanitized.phases) for (const speech of phase.speeches) {
          if (speech.segments?.some(s => s.kind === 'media')) speech.segments = speech.segments.filter(s => s.kind !== 'media')
        }
      }
      const { phases, deerChoices, ...header } = sanitized
      const row = await db.create('undercover_history_game', {
        gameId: snapshot.gameId, platform: snapshot.platform, selfId: snapshot.selfId, guildId: snapshot.guildId,
        mode: snapshot.mode, disposition, startedAt: snapshot.startedAt, endedAt: snapshot.endedAt,
        digest, payload: JSON.stringify(header),
      })
      for (const phase of phases) await db.create('undercover_history_phase', {
        gameId: snapshot.gameId, sequence: phase.sequence, payload: JSON.stringify(phase),
      })
      for (const choice of deerChoices) await db.create('undercover_history_choice', { gameId: snapshot.gameId, ...choice })
      return { kind: 'saved' as const, id: row.id, repeated: false }
    }))
    this.tail = task.catch(() => undefined)
    return task
  }

  /** Internal only: public caller must authorize, preview and confirm first.
   * The non-identifying digest intentionally outlives content to block queued
   * stale copies from resurrecting an erased game after a crash or restart. */
  erase(gameId: string, expectedFingerprint?: string) {
    const task = this.tail.then(() => this.database.transact(async db => {
      const key = erasureKey(gameId)
      await db.get('undercover_history_erasure', { key })
      if (expectedFingerprint !== undefined && await this.deletionFingerprint(gameId, db) !== expectedFingerprint) throw new GameUserError('历史内容或隐藏状态已变化，请重新预览。')
      if (!(await db.get('undercover_history_erasure', { key })).length) await db.create('undercover_history_erasure', { key })
      await db.remove('undercover_history_choice', { gameId })
      await db.remove('undercover_history_phase', { gameId })
      await db.remove('undercover_history_game', { gameId })
    }))
    this.tail = task.catch(() => undefined)
    return task
  }
  async prune() {
    if (this.retentionDays <= 0) return 0
    let removed = 0
    const cutoff = Date.now() - this.retentionDays * 86400000
    while (true) {
      const rows = await this.database.get('undercover_history_game', { endedAt: { $lt: cutoff } }, { limit: 100 })
      if (!rows.length) return removed
      for (const row of rows) { await this.erase(row.gameId); removed++ }
    }
  }

  /**
   * Remove only persisted media fragments for this bot identity.  Text,
   * searchable fields and the replay structure remain intact.  The operation
   * is serialized with saves/erasure so a just-finished game cannot be
   * partially rewritten while it is being archived.
   */
  private async removeMediaRows(db: Context['database'], rows: HistoryGameRow[], cutoff: number) {
    let changed = 0
    for (const row of rows) {
      if (row.endedAt >= cutoff) continue
      const phases = await db.get('undercover_history_phase', { gameId: row.gameId })
      for (const phaseRow of phases) {
        const phase = JSON.parse(phaseRow.payload) as { speeches?: Array<{ segments?: Array<{ kind: string }> }> }
        let phaseChanged = false
        if (Array.isArray(phase.speeches)) {
          for (const speech of phase.speeches) {
            if (!Array.isArray(speech.segments)) continue
            const retainedSegments = speech.segments.filter(segment => segment.kind !== 'media')
            if (retainedSegments.length === speech.segments.length) continue
            phaseChanged = true
            if (retainedSegments.length) speech.segments = retainedSegments
            else delete speech.segments
          }
        }
        if (phaseChanged) {
          await db.set('undercover_history_phase', { gameId: row.gameId, sequence: phaseRow.sequence }, { payload: JSON.stringify(phase) })
          changed++
        }
      }
    }
    return changed
  }
  pruneMediaForBot(platform: string, selfId: string, before = Date.now()) {
    if (this.mediaRetention.mode === 'permanent') return Promise.resolve(0)
    const cutoff = this.mediaRetention.mode === 'days'
      ? before - Math.max(1, this.mediaRetention.days) * 86400000
      : before + 1 // A game ended in this same millisecond is still a previous game.
    const task = this.tail.then(() => this.database.transact(async db => {
      const rows = await db.get('undercover_history_game', { platform, selfId })
      const key = mediaKey(platform, selfId)
      const old = (await db.get('undercover_history_redaction', { key }))[0]
      const marker = { key, cutoff: Math.max(cutoff, old?.cutoff ?? 0) }
      await db.upsert('undercover_history_redaction', [marker])
      return this.removeMediaRows(db, rows, cutoff)
    }))
    this.tail = task.catch(() => undefined)
    return task
  }
  pruneExpiredMedia(before = Date.now()) {
    if (this.mediaRetention.mode !== 'days') return Promise.resolve(0)
    const cutoff = before - Math.max(1, this.mediaRetention.days) * 86400000
    const task = this.tail.then(() => this.database.transact(async db =>
      this.removeMediaRows(db, await db.get('undercover_history_game', { endedAt: { $lt: cutoff } }), cutoff)))
    this.tail = task.catch(() => undefined)
    return task
  }
}
