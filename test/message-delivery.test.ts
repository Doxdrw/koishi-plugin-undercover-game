import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { GameMessageDelivery } from "../src/game/message-delivery"

describe("game message delivery boundaries", () => {
  it("reports recoverable state-message failures without throwing", async () => {
    const failures: string[] = []
    const delivery = new GameMessageDelivery(label => failures.push(label))
    const delivered = await delivery.state("skill prompt", async () => { throw new Error("blocked") })
    assert.equal(delivered, false)
    assert.deepEqual(failures, ["skill prompt"])
  })

  it("preserves required-message failures", async () => {
    const delivery = new GameMessageDelivery(() => undefined)
    await assert.rejects(
      delivery.required("required", async () => { throw new Error("offline") }),
      /offline/,
    )
  })

  it('does not claim a rejected or empty API receipt proves non-delivery', async () => {
    const delivery = new GameMessageDelivery(() => undefined)
    const visible: string[] = []
    const result = await delivery.outcome('private prompt', async () => {
      visible.push('prompt')
      throw Object.assign(new Error('private request body'), { code: 1200, url: 'send_private_msg' })
    })
    assert.equal(result.status, 'unknown')
    assert.deepEqual(visible, ['prompt'])
    assert.equal((await delivery.outcome('empty', async () => [])).status, 'unknown')
    assert.equal((await delivery.outcome('empty id', async () => [''])).status, 'unknown')
    assert.equal((await delivery.outcome('receipt', async () => ['message'])).status, 'confirmed')
  })
})
