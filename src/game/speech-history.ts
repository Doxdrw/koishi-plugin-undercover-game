import type { HistorySpeechSegment, InvalidatedSpeech } from './history-snapshot'

export interface SpeechHistoryRecord {
  round: number
  overtime: boolean
  seat: number
  nickname: string
  text: string
  segments?: HistorySpeechSegment[]
  identityKey?: string
  invalidReason?: string
  previousInvalid?: InvalidatedSpeech[]
}

export interface SpeechHistoryPhase {
  round: number
  overtime: boolean
  records: SpeechHistoryRecord[]
}

const recordKey = (record: Pick<SpeechHistoryRecord, 'round' | 'overtime' | 'seat'>) =>
  `${record.round}:${record.overtime ? 'overtime' : 'regular'}:${record.seat}`

export class SpeechHistory {
  private readonly records = new Map<string, SpeechHistoryRecord>()

  record(input: SpeechHistoryRecord): void {
    const text = input.text.trim()
    if (!text) return
    const previous = this.records.get(recordKey(input))
    const previousInvalid = previous?.previousInvalid ? structuredClone(previous.previousInvalid) : []
    if (previous?.invalidReason) previousInvalid.push({ text: previous.text, reason: previous.invalidReason, segments: previous.segments })
    this.records.set(recordKey(input), { ...input, text, segments: input.segments ? structuredClone(input.segments) : undefined,
      ...(previousInvalid.length ? { previousInvalid } : {}) })
  }

  invalidate(records: readonly SpeechHistoryRecord[], reason: string): void {
    for (const input of records) {
      const record = this.records.get(recordKey(input))
      if (record && record.text === input.text && record.identityKey === input.identityKey) record.invalidReason = reason
    }
  }

  bySeat(seat: number): SpeechHistoryRecord[] {
    return this.sorted([...this.records.values()].filter(record => record.seat === seat))
  }

  phases(): SpeechHistoryPhase[] {
    const phases = new Map<string, SpeechHistoryPhase>()
    for (const record of this.sorted([...this.records.values()])) {
      const key = `${record.round}:${record.overtime ? 'overtime' : 'regular'}`
      let phase = phases.get(key)
      if (!phase) {
        phase = { round: record.round, overtime: record.overtime, records: [] }
        phases.set(key, phase)
      }
      phase.records.push(record)
    }
    return [...phases.values()]
  }

  clear(): void {
    this.records.clear()
  }

  private sorted(records: SpeechHistoryRecord[]): SpeechHistoryRecord[] {
    return records.sort((left, right) =>
      left.round - right.round
      || Number(left.overtime) - Number(right.overtime)
      || left.seat - right.seat)
  }
}
