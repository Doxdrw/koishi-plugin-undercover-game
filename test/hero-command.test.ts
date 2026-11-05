import assert from 'node:assert/strict'
import { it } from 'node:test'
import { normalizeHeroCommand, parseHeroNumber } from '../src/game/hero-command'
import { classifyWeiZhongXianInquiry } from '../src/heroes/wei-zhong-xian'
import { classifyDelegationInput, classifyProxyVoteInput, classifyHeirTargetInput } from '../src/heroes/zhu-you-xiao'

it('removes whitespace, punctuation and symbols without dropping unrelated letters or folding digits', () => {
  for (const [input, expected] of [['处决+1', '处决1'], ['伐，1', '伐1'], ['处决1.2', '处决12'],
    ['处决-1', '处决1'], [' 放 权 ＋ 2！', '放权2'], ['处决1e2', '处决1e2'], ['守１', '守１']]) {
    assert.equal(normalizeHeroCommand(input), expected)
  }
  assert.ok(Number.isNaN(parseHeroNumber('1e2')))
  assert.ok(Number.isNaN(parseHeroNumber('１')))
  assert.ok(Number.isNaN(parseHeroNumber('999999999999999999999')))
})

it('normalizes the new hero commands and preserves multi-digit inquiry targets', () => {
  assert.deepEqual(classifyWeiZhongXianInquiry('查2+10'), { kind: 'voted-by', targetSeat: 10 })
  assert.deepEqual(classifyWeiZhongXianInquiry('缉，1！'), { kind: 'vote-target' })
  assert.deepEqual(classifyDelegationInput({ content: '放+2', activeSeats: [1, 2], ownerSeat: 1 }), { kind: 'delegate', seat: 2 })
  assert.deepEqual(classifyProxyVoteInput({ content: '代投＋2', activeSeats: [1, 2], ownerSeat: 1 }), { kind: 'target', seat: 2 })
  assert.deepEqual(classifyHeirTargetInput({ content: '传，2', activeSeats: [1, 2] }), { kind: 'target', seat: 2 })
})
