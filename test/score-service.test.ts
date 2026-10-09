import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ScoreService } from "../src/game/score-service"

describe("score service", () => {
  for (const initiallyFails of [false, true]) it(`derives retry warnings from final receipts (${initiallyFails ? 'failure then success' : 'success then failure'})`, async () => {
    let fails = initiallyFails
    const service = new ScoreService({ add: async () => { if (fails) throw new Error('offline'); return { journalId: 42 } } }, () => {})
    const input = { enabled: true, nickname: '清风', amount: 1, reason: 'reward', idempotencyKey: 'original-operation' }
    await service.add(input)
    fails = !initiallyFails
    await service.add(input)
    assert.deepEqual(service.results.map(row => [row.status, row.journalId]), [['written', 42]])
    assert.deepEqual(service.failedNames, [])
    assert.equal(service.failureNotice(), '')
  })
  it('keeps same-name rewards independent and success absorbing across concurrent retries', async () => {
    let reject: (reason: Error) => void
    let pending = true
    const service = new ScoreService({ add: input => {
      if (input.idempotencyKey === 'second') return Promise.reject(new Error('offline'))
      if (pending) { pending = false; return new Promise((_, no) => { reject = no }) }
      return Promise.resolve({ journalId: 7 })
    } }, () => {})
    const input = { enabled: true, nickname: '清风', amount: 1, reason: 'reward', idempotencyKey: 'first' }
    const delayed = service.add(input)
    await service.add({ ...input, idempotencyKey: 'second' })
    await service.add(input)
    reject!(new Error('late failure')); await delayed
    await service.add({ ...input, enabled: false })
    assert.deepEqual(service.results.map(row => [row.input.idempotencyKey, row.status]), [['second', 'failed'], ['first', 'written']])
    assert.deepEqual(service.failedNames, ['清风'])
    assert.match(service.failureNotice(), /清风的积分未能写入数据库/)
  })
  it('retains detached final receipts, actual journal IDs and explicit non-write statuses', async () => {
    let fail = true
    const service = new ScoreService({ add: async () => { if (fail) throw new Error('offline'); return { journalId: 42 } } }, () => {})
    const input = { enabled: true, nickname: '清风', amount: 0.5, reason: 'reward', idempotencyKey: 'game:reward:account', accountId: 'account' }
    assert.equal(await service.add(input), false)
    assert.equal(service.results[0].status, 'failed')
    fail = false
    assert.equal(await service.add(input), true)
    assert.equal(service.results.length, 1)
    assert.equal(service.results[0].journalId, 42)
    fail = true
    assert.equal(await service.add(input), false)
    assert.equal(service.results[0].status, 'written')
    assert.equal(service.results[0].journalId, 42)
    input.nickname = 'later rename'
    const copy = service.results as any[]; copy[0].input.amount = 500
    assert.equal(service.results[0].input.amount, 0.5)
    assert.equal(service.results[0].input.nickname, '清风')
    await service.add({ ...input, enabled: false, idempotencyKey: 'disabled' })
    await service.add({ ...input, amount: 0, idempotencyKey: 'zero' })
    assert.deepEqual(service.results.map(r => r.status), ['written', 'disabled', 'zero'])
    service.reset(); assert.deepEqual(service.results, [])
  })
  it('does not let a prior-game delayed score result pollute the next game receipts or warnings', async () => {
    let reject: (reason: Error) => void
    const service = new ScoreService({ add: () => new Promise((_, no) => { reject = no }) }, assert.fail)
    const promise = service.add({ enabled: true, nickname: '前局玩家', amount: 1, reason: 'reward', idempotencyKey: 'old' })
    service.reset(); reject!(new Error('old request failed'))
    assert.equal(await promise, false)
    assert.deepEqual(service.results, []); assert.deepEqual(service.failedNames, [])
  })
  it("uses the profile score increment adapter", async () => {
    const calls: Array<{
      nickname: string
      platform?: string
      guildId?: string
      amount: number
    }> = []
    const service = new ScoreService({
      add: async input => {
        calls.push({
          nickname: input.nickname,
          platform: input.platform,
          guildId: input.guildId,
          amount: input.amount,
        })
      },
    }, assert.fail)

    assert.equal(await service.add({
      enabled: true,
      nickname: "Alice",
      amount: 1.5,
      platform: "onebot",
      guildId: "1000",
      reason: "test",
      idempotencyKey: "game:test:alice",
    }), true)

    assert.deepEqual(calls, [{ nickname: "Alice", platform: "onebot", guildId: "1000", amount: 1.5 }])
  })

  it("does not access storage when scoring is disabled or amount is zero", async () => {
    let calls = 0
    const service = new ScoreService({
      add: async () => { calls += 1 },
    }, assert.fail)
    assert.equal(await service.add({
      enabled: false,
      nickname: "Alice",
      amount: 2,
      reason: "test",
      idempotencyKey: "disabled",
    }), true)
    assert.equal(await service.add({
      enabled: true,
      nickname: "Alice",
      amount: 0,
      reason: "test",
      idempotencyKey: "zero",
    }), true)
    assert.equal(calls, 0)
  })

  it("keeps disabled scoring free of failure notices", async () => {
    const service = new ScoreService({
      add: async () => { throw new Error("must not run") },
    }, assert.fail)
    assert.equal(await service.add({
      enabled: false,
      nickname: "Alice",
      amount: 1,
      reason: "test",
      idempotencyKey: "disabled-failure",
    }), true)
    assert.equal(service.failureNotice(), "")
  })
  it("records write failures once per nickname", async () => {
    const failures: string[] = []
    const failingWrite = new ScoreService({
      add: async () => { throw new Error("database offline") },
    }, nickname => failures.push(nickname))
    for (let index = 0; index < 2; index++) {
      assert.equal(await failingWrite.add({
        enabled: true,
        nickname: "Bob",
        amount: 1,
        reason: "test",
        idempotencyKey: "failure-" + index,
      }), false)
    }
    assert.deepEqual(failingWrite.failedNames, ["Bob"])
    assert.deepEqual(failures, ["Bob", "Bob"])
    assert.match(failingWrite.failureNotice(), /Bob的积分未能写入数据库/)
    failingWrite.reset()
    assert.equal(failingWrite.failureNotice(), "")
  })
})
