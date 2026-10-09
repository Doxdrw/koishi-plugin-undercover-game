import { createHash } from 'node:crypto'
import type { Context } from 'koishi'
import type { ProfileDeletionScopeLike } from './subscription-service'
import { createSubscriptionDeletionConsumer } from './subscription-service'
import type { HistoryRetryQueue, HistoryPersistence } from './history-retry'
import { historyIdentityKeys, historyScopeKeys, loadStoredHistory, redactHistory, writeRedactedHistory } from './history-privacy'
import type { HistorySnapshot } from './history-snapshot'

export function createHistoryDeletionConsumer(queue: HistoryRetryQueue, persistence: HistoryPersistence, busy: () => boolean = () => false) {
  const subscriptions = createSubscriptionDeletionConsumer()
  const affected = (snapshot: HistorySnapshot, keys: Set<string>) => [snapshot.host, ...snapshot.participants.map(p => p.identity)]
    .some(i => historyIdentityKeys(i).some(key => keys.has(key)))
  const read = async (database: Context['database'], scope: ProfileDeletionScopeLike) => {
    if (busy()) throw new Error('对局历史仍在写入，请稍后重新预览删除。')
    const keys = new Set(historyScopeKeys(scope))
    const histories = []
    for (const row of await database.get('undercover_history_game', {})) {
      const snapshot = await loadStoredHistory(database, row)
      if (affected(snapshot, keys)) histories.push({ row, snapshot })
    }
    const pending = []
    for (const name of await queue.names()) {
      const snapshot = await queue.read(name)
      if (affected(snapshot, keys)) pending.push({ gameId: snapshot.gameId,
        digest: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') })
    }
    return { keys, histories, pending }
  }
  return {
    name: 'undercover-game',
    async preview(database: Context['database'], scope: ProfileDeletionScopeLike) {
      const subs = await subscriptions.preview(database, scope), state = await read(database, scope)
      return { affectedRows: subs.affectedRows + state.histories.length + state.pending.length,
        summary: [...subs.summary, `匿名化 ${state.histories.length} 局历史中的身份及其本人内容，处理 ${state.pending.length} 份待重试记录。`,
          '其他玩家发言中提到该人的文字不能保证自动识别；必要时请用“历史清理 编号”删除整局。'],
        snapshot: { subs: subs.snapshot, histories: state.histories.map(h => ({ id: h.row.id, digest: createHash('sha256').update(JSON.stringify(h.snapshot)).digest('hex') })), pending: state.pending } }
    },
    async delete(database: Context['database'], scope: ProfileDeletionScopeLike) {
      const state = await read(database, scope), cutoff = Date.now()
      for (const key of state.keys) {
        const old = (await database.get('undercover_history_redaction', { key }))[0]
        if (old) await database.set('undercover_history_redaction', { key }, { cutoff: Math.max(old.cutoff, cutoff) })
        else await database.create('undercover_history_redaction', { key, cutoff })
      }
      const markers = await database.get('undercover_history_redaction', {})
      for (const { snapshot } of state.histories) await writeRedactedHistory(database, redactHistory(snapshot, markers))
      await subscriptions.delete(database, scope)
    },
    async afterDelete() {
      // Committed redaction markers guard every retry. Now remove pending raw
      // files by safely saving their sanitized snapshots; never re-award scores.
      const result = await persistence.retry()
      if (result.failed) throw new Error('部分历史待重试文件未清理，数据库匿名化已提交。')
    },
  }
}
