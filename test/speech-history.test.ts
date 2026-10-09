import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SpeechHistory } from '../src/game/speech-history'

describe('fixed-seat speech history', () => {
  it('overwrites one seat in the same phase without losing older rounds', () => {
    const history = new SpeechHistory()
    history.record({ round: 1, overtime: false, seat: 2, nickname: 'Bob', text: '第一次' })
    history.record({ round: 1, overtime: false, seat: 2, nickname: 'Bob', text: '修改后' })
    history.record({ round: 1, overtime: true, seat: 2, nickname: 'Bob', text: '加时' })
    history.record({ round: 2, overtime: false, seat: 1, nickname: 'Alice', text: '下一轮' })

    assert.deepEqual(history.bySeat(2).map(record => record.text), ['修改后', '加时'])
    assert.deepEqual(history.phases().map(phase => [phase.round, phase.overtime, phase.records.length]), [
      [1, false, 1],
      [1, true, 1],
      [2, false, 1],
    ])
  })

  it('ignores empty input and clears all retained phases', () => {
    const history = new SpeechHistory()
    history.record({ round: 1, overtime: false, seat: 1, nickname: 'Alice', text: '   ' })
    assert.deepEqual(history.phases(), [])
    history.record({ round: 1, overtime: false, seat: 1, nickname: 'Alice', text: '发言' })
    history.clear()
    assert.deepEqual(history.bySeat(1), [])
  })
})
