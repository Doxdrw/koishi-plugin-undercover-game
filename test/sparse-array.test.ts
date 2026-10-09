import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { removeArrayIndicesInPlace } from "../src/game/sparse-array"

describe("sparse roster projections", () => {
  it("removes active indices without collapsing unrelated sparse seats", () => {
    const announcements = Array<string>(6)
    announcements[3] = "4号回答"
    announcements[4] = "5号回答"

    removeArrayIndicesInPlace(announcements, [5, 2])

    assert.equal(announcements.length, 4)
    assert.equal(0 in announcements, false)
    assert.equal(1 in announcements, false)
    assert.equal(announcements[2], "4号回答")
    assert.equal(announcements[3], "5号回答")
  })

  it("deduplicates and sorts multiple removals before splicing", () => {
    const values = ["a", "b", "c", "d", "e"]
    removeArrayIndicesInPlace(values, [1, 3, 1])
    assert.deepEqual(values, ["a", "c", "e"])
  })
})
