import type { HistoryParticipant } from './history-snapshot'

/** A display-only projection. Original tenures remain authoritative authors. */
export async function projectHistoryParticipants(
  participants: readonly HistoryParticipant[],
  canonical: (personId: number) => Promise<number | undefined> = async id => id,
): Promise<{ current: HistoryParticipant[]; former: HistoryParticipant[] }> {
  const people = new Map<number, number | undefined>()
  const keys = new Map<HistoryParticipant, string>()
  const seats = new Map<number, HistoryParticipant[]>()
  for (const participant of participants) {
    const identity = participant.identity
    let key = `tenure:${participant.tenureId}`
    if (!identity.erased) {
      if (identity.personId !== undefined) {
        if (!people.has(identity.personId)) people.set(identity.personId, await canonical(identity.personId))
        const person = people.get(identity.personId)
        if (person !== undefined) key = `person:${person}`
        else if (identity.userId) key = `account:${JSON.stringify([identity.platform, identity.userId])}`
      }
      else if (identity.userId) key = `account:${JSON.stringify([identity.platform, identity.userId])}`
    }
    keys.set(participant, key)
    const rows = seats.get(participant.seat) ?? []
    rows.push(participant)
    seats.set(participant.seat, rows)
  }
  const current: HistoryParticipant[] = []
  const former: HistoryParticipant[] = []
  for (const [, rows] of [...seats].sort(([a], [b]) => a - b)) {
    const last = rows.at(-1)!
    current.push(last)
    const seen = new Set([keys.get(last)!])
    const prior: HistoryParticipant[] = []
    for (const row of rows.slice(0, -1).reverse()) {
      const key = keys.get(row)!
      if (seen.has(key)) continue
      seen.add(key)
      prior.push(row)
    }
    former.push(...prior.reverse())
  }
  return { current, former }
}
