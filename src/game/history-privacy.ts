import { createHash } from 'node:crypto'
import type { Context } from 'koishi'
import type { HistoryIdentity, HistorySnapshot } from './history-snapshot'
import type { ProfileDeletionScopeLike } from './subscription-service'

export interface HistoryRedactionRow { key: string; cutoff: number }
declare module 'koishi' { interface Tables { undercover_history_redaction: HistoryRedactionRow } }
const key = (kind: string, value: unknown) => createHash('sha256').update('undercover-history-redaction:v1:' + kind + ':' + JSON.stringify(value)).digest('hex')
export function historyIdentityKeys(identity: HistoryIdentity) {
  if (identity.erased) return []
  return [key('account', [identity.platform, identity.userId]),
    ...(identity.personId === undefined ? [] : [key('person', identity.personId)])]
}
export function historyScopeKeys(scope: ProfileDeletionScopeLike) {
  const identities = scope.mode === 'identity' ? [scope.targetIdentity!] : scope.identities
  return [...new Set([...identities.map(i => key('account', [i.platform, i.userId])),
    ...(scope.mode === 'profile' ? scope.profileIds.map(id => key('person', id)) : [])])]
}
export function redactHistory(input: HistorySnapshot, markers: readonly HistoryRedactionRow[]): HistorySnapshot {
  const snapshot = structuredClone(input)
  const keys = new Set(markers.filter(m => m.cutoff >= snapshot.endedAt).map(m => m.key))
  const matches = (id: HistoryIdentity) => historyIdentityKeys(id).some(k => keys.has(k))
  const anonymous = (id: HistoryIdentity): HistoryIdentity => ({ platform: id.platform, userId: '', nickname: '已匿名玩家', erased: true })
  const authors = new Set(snapshot.participants.filter(p => matches(p.identity)).map(p => p.tenureId))
  if (matches(snapshot.host)) {
    snapshot.host = anonymous(snapshot.host)
    if (snapshot.topics) snapshot.topics = { publicText: '题面已匿名化删除', good: '已删除', undercover: '已删除' }
  }
  for (const p of snapshot.participants) if (authors.has(p.tenureId)) p.identity = anonymous(p.identity)
  for (const phase of snapshot.phases) {
    for (const s of phase.speeches) if (authors.has(s.tenureId)) {
      s.text = '发言已匿名化删除'
      delete s.segments
      if (s.question !== undefined) s.question = '已删除'
      if (s.answer !== undefined) s.answer = '已删除'
    }
    for (const e of phase.events) if (authors.has(e.tenureId) && e.kind === 'skill') e.effect = '技能描述已匿名化删除'
  }
  snapshot.awards = snapshot.awards.filter(a => !authors.has(a.tenureId))
  snapshot.deerChoices = snapshot.deerChoices.filter(c => !authors.has(c.tenureId))
  return snapshot
}
export async function loadStoredHistory(database: Context['database'], row: { payload: string; gameId: string }): Promise<HistorySnapshot> {
  return { ...JSON.parse(row.payload),
    phases: (await database.get('undercover_history_phase', { gameId: row.gameId }, { sort: { sequence: 'asc' } })).map(p => JSON.parse(p.payload)),
    deerChoices: (await database.get('undercover_history_choice', { gameId: row.gameId })).map(({ tenureId, choice, hidden }) => ({ tenureId, choice, hidden })),
  }
}
export async function writeRedactedHistory(database: Context['database'], snapshot: HistorySnapshot) {
  const { phases, deerChoices, ...header } = snapshot
  await database.set('undercover_history_game', { gameId: snapshot.gameId }, { payload: JSON.stringify(header) })
  for (const p of phases) await database.set('undercover_history_phase', { gameId: snapshot.gameId, sequence: p.sequence }, { payload: JSON.stringify(p) })
  const ids = new Set(deerChoices.map(c => c.tenureId))
  for (const row of await database.get('undercover_history_choice', { gameId: snapshot.gameId }))
    if (!ids.has(row.tenureId)) await database.remove('undercover_history_choice', { gameId: snapshot.gameId, tenureId: row.tenureId })
}
