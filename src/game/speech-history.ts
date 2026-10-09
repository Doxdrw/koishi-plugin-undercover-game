import type { HistorySpeechSegment } from './history-snapshot'

export interface SpeechHistoryRecord {
  round: number
  overtime: boolean
  seat: number
  nickname: string
  text: string
  segments?: HistorySpeechSegment[]
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
    this.records.set(recordKey(input), { ...input, text, segments: input.segments ? structuredClone(input.segments) : undefined })
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
