import assert from 'node:assert/strict'
import { it } from 'node:test'
import { Config } from '../src'
import { fields } from './config-contract'

it('keeps flat diagnostic settings compatible and explains advanced parameters in Chinese', () => {
  const values = Config({ debug: { enabled: false, fileBytes: 16384, entryBytes: 32768 } })
  assert.equal(values.debug.enabled, false)
  assert.equal(values.debug.fileBytes, 16384)
  assert.equal(values.debug.entryBytes, 32768)
  const all = fields(Config)
  const debug = all.debug
  assert.equal(debug.meta.collapse, true)
  for (const property of Object.values(debug.dict) as any[]) {
    assert.match(property.meta.description, /[\u4e00-\u9fff]/)
  }
  assert.match(all.history.dict.enabled.meta.description, /第一阶段.*终止/)
  assert.match(all.scoreWhiteWin.meta.description, /苟赢.*招安后按所加入阵营/)
})
