import assert from 'node:assert/strict'
import { it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { HistoryRecorder } from '../src/game/history-recorder'
import { ScoreService } from '../src/game/score-service'

function recorder(mode: 'classic' | 'deer' | 'turtle' = 'classic') {
  const r = new HistoryRecorder({ gameId: randomUUID(), mode, platform: 'onebot', selfId: 'bot', guildId: 'group',
    sandbox: false, startedAt: 10, host: { platform: 'onebot', userId: 'host', nickname: '主持人' }, ruleVersion: '0.3.0', rules: { timeoutMode: 1 } })
  r.topics({ publicText: '共同题面', good: '好人', undercover: '卧底' })
  return r
}
const identity = (id: string) => ({ platform: 'onebot', userId: id, nickname: id, accountId: 'account-' + id })

it('records sequential occupants in the same phase without transferring their speech or deer choices', () => {
  const r = recorder('deer')
  const first = r.join(1, identity('first'), 'good', 0, 10)
  r.join(2, identity('second'), 'undercover', null, 10)
  r.beginPhase('regular-1', 1, 'regular', [1, 2]); r.choice(1, '原玩家选人'); r.speech(1, '原发言')
  r.event(1, { kind: 'hero-reveal', heroId: 0 }); r.leave(1, 'kick', 20)
  const next = r.join(1, identity('next'), 'good', 0, 21)
  r.allowSpeakers([1]); r.choice(1, '补位选人'); r.speech(1, '补位发言')
  r.vote([{ voterSeat: 1, targetSeat: 2 }, { voterSeat: 2, targetSeat: 1 }], [{ seat: 1, count: 1 }, { seat: 2, count: 1 }])
  const result = r.finish({ kind: 'completed', reason: 'elimination', winner: 'good' }, 40)
  assert.deepEqual(result.phases[0].speeches.map(s => [s.tenureId, s.text]), [[first, '原发言'], [next, '补位发言']])
  assert.deepEqual(result.deerChoices.map(c => [c.tenureId, c.choice]), [[first, '原玩家选人'], [next, '补位选人']])
  assert.equal(result.phases[0].ballots[0].voterTenureId, next)
  assert.equal(result.participants[2].replacedTenureId, first)
  assert.deepEqual(result.phases[0].events.find(e => e.kind === 'replacement'), { kind: 'replacement', tenureId: next })
})

it('overwrites only the final answer in one phase and retains multiple overtime windows independently', () => {
  const r = recorder('turtle')
  r.join(1, identity('one'), 'good', null, 10); r.join(2, identity('two'), 'undercover', null, 10)
  for (const [i, kind] of ['regular', 'overtime', 'overtime'].entries()) {
    r.beginPhase('turn-' + i, 1, kind as 'regular' | 'overtime', [1, 2])
    r.outcome(kind === 'regular' ? '本轮无人出局，平安夜。' : '平票，进入加时。')
    r.speech(1, '最初回答', '他是吗' + i, '是'); r.speech(1, '最终回答' + i, '他是吗' + i, '否')
    assert.equal(r.beginPhase('turn-' + i, 1, kind as 'regular' | 'overtime', [1, 2]), i + 1)
  }
  const result = r.finish({ kind: 'completed', reason: 'stalemate', winner: 'undercover' }, 50)
  assert.equal(result.phases.length, 3)
  assert.deepEqual(result.phases.map(p => p.outcomes), [['本轮无人出局，平安夜。'], ['平票，进入加时。'], ['平票，进入加时。']])
  assert.deepEqual(result.phases.map(p => p.speeches[0].text), ['最终回答0', '最终回答1', '最终回答2'])
  assert.deepEqual(result.phases.map(p => p.speeches[0].answer), ['否', '否', '否'])
  assert.throws(() => r.speech(1, 'later'), /已经结束/)
  assert.equal(r.finish({ kind: 'aborted', reason: 'host-stop' }, 999), result)
})

it('keeps account-targeted award receipts and post-elimination skill authors separate', () => {
  const r = recorder()
  const a = r.join(1, { ...identity('alt'), nickname: '相同管理昵称' }, 'good', 1, 10)
  r.join(2, { ...identity('main'), nickname: '相同管理昵称' }, 'undercover', null, 10)
  r.beginPhase('one', 1, 'regular', [1, 2]); r.leave(1, 'vote', 30)
  r.event(1, { kind: 'skill', heroId: 1, effect: '出局后发动', targetSeats: [2] })
  const result = r.finish({ kind: 'completed', reason: 'elimination', winner: 'good' }, 40, [{
    input: { enabled: true, accountId: 'account-alt', nickname: '相同管理昵称', amount: 0.5, reason: 'win', idempotencyKey: 'one-win' },
    status: 'written', journalId: 22,
  }], 'event')
  assert.equal(result.awards[0].tenureId, a)
  assert.equal(result.awards[0].journalId, 22)
  assert.equal(result.phases[0].events[1].tenureId, a)
})
it('archives the same final reward outcomes used by the retry failure notice', async () => {
  const r = recorder(), first = r.join(1, identity('one'), 'good', null, 10), second = r.join(2, identity('two'), 'good', null, 10)
  r.beginPhase('one', 1, 'regular', [1, 2])
  let failFirst = true
  const scores = new ScoreService({ add: async input => {
    if (input.idempotencyKey === 'second' || failFirst) throw new Error('offline')
    return { journalId: 31 }
  } }, () => {})
  const input = { enabled: true, accountId: 'account-one', nickname: '相同昵称', amount: 1, reason: 'win', idempotencyKey: 'first' }
  await scores.add(input)
  await scores.add({ ...input, accountId: 'account-two', idempotencyKey: 'second' })
  failFirst = false; await scores.add(input)
  failFirst = true; await scores.add(input)
  const result = r.finish({ kind: 'completed', reason: 'elimination', winner: 'good' }, 40, scores.results)
  assert.deepEqual(result.awards.map(award => [award.tenureId, award.status, award.journalId]),
    [[first, 'written', 31], [second, 'failed', undefined]])
  assert.deepEqual(scores.failedNames, ['相同昵称'])
  assert.match(scores.failureNotice(), /相同昵称的积分未能写入数据库/)
})

it('refuses unqualified or unknown authors and records initial versus final camp', () => {
  const r = recorder(); r.join(1, identity('white'), 'white', null, 10); r.join(2, identity('other'), 'good', null, 10)
  r.beginPhase('extra', 1, 'overtime', [2])
  assert.throws(() => r.speech(1, 'not eligible'), /不是本次/)
  assert.throws(() => r.join(1, identity('replacement'), 'good', null, 11), /尚未离场/)
  r.camp(1, 'undercover')
  const result = r.finish({ kind: 'completed', reason: 'elimination', winner: 'undercover' }, 50)
  assert.equal(result.participants[0].initialCamp, 'white'); assert.equal(result.participants[0].finalCamp, 'undercover')
})
