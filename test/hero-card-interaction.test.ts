import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, mock } from "node:test"
import { HERO } from "../src/heroes"
import { UndercoverGameHarness } from "./game-harness"
import { png } from "./image-fixtures"

const PNG = png(1)
const IMAGE = `<img src="data:image/png;base64,${PNG.toString("base64")}"/>`

const output = (game: UndercoverGameHarness) => game.transcript
  .filter(entry => entry.direction === "out")
  .map(entry => entry.content)
  .join("\n")

async function withHarness(run: (game: UndercoverGameHarness) => Promise<void>): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "undercover-card-command-"))
  const game = await UndercoverGameHarness.create({}, { baseDir })
  try {
    await game.addUser("admin", "Admin", 5)
    await game.addUser("operator", "Operator", 4)
    await run(game)
  }
  finally {
    await game.stop()
    await rm(baseDir, { recursive: true, force: true })
  }
}

describe("interactive hero card commands", { concurrency: false }, () => {
  it("keeps direct hero queries and supports interactive name and number choices", async () => {
    await withHarness(async game => {
      await game.sendGroup("operator", "查询武将 朱由检")
      assert.match(output(game), /朱由检武将技能：.*处决/)

      await game.sendGroup("operator", "查询武将")
      assert.match(output(game), /请选择要查询的武将.*1\. 张献忠/s)
      await game.sendGroup("operator", "3")
      assert.equal((output(game).match(/朱由检武将技能：/g) ?? []).length, 2)

      await game.sendGroup("operator", "查询武将 不存在")
      assert.match(output(game), /暂时没有该武将.*请选择要查询的武将/s)
      await game.sendGroup("operator", "选择武将 10")
      assert.match(output(game), /多尔衮武将技能：.*定策/s)
    })
  })

  it("lets only authority 5 replace cards and restores the packaged default", async () => {
    await withHarness(async game => {
      await game.sendGroup("operator", `替换卡面 朱由检 ${IMAGE}`)
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 0)
      assert.doesNotMatch(output(game), /已替换朱由检的卡面/)

      await game.sendGroup("admin", `替换卡面 朱由检 ${IMAGE}`)
      assert.match(output(game), /已替换朱由检的卡面/)
      const [record] = await game.app.database.get("undercover_hero_card", { heroId: HERO.ZHU_YOU_JIAN })
      assert.equal(record.updatedByUserId, "admin")

      await game.sendGroup("admin", "卡面管理.列表")
      assert.match(output(game), /朱由检：自定义/)
      await game.sendGroup("admin", "查看卡面 朱由检")
      assert.match(output(game), /朱由检当前卡面来源：管理员自定义/)

      await game.sendGroup("admin", "查看卡面")
      await game.sendGroup("admin", "选择武将 3")
      assert.equal((output(game).match(/朱由检当前卡面来源：管理员自定义/g) ?? []).length, 2)

      await game.sendGroup("admin", "恢复默认卡面 朱由检")
      assert.match(output(game), /已恢复朱由检的默认卡面/)
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 0)
    })
  })

  it("collects a hero and one image without swallowing unrelated messages", async () => {
    await withHarness(async game => {
      await game.sendGroup("admin", "替换卡面")
      await game.sendGroup("admin", "这是一句无关聊天")
      assert.doesNotMatch(output(game), /已选择/)

      await game.sendGroup("admin", "朱由检")
      assert.match(output(game), /已选择朱由检.*上传一张图片/s)
      await game.sendGroup("admin", IMAGE + IMAGE)
      assert.match(output(game), /一次只能上传一张卡面图片/)
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 0)

      await game.sendGroup("admin", IMAGE)
      assert.match(output(game), /已替换朱由检的卡面/)
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 1)

      await game.sendGroup("admin", "替换卡面 张献忠")
      await game.sendGroup("admin", "取消")
      assert.match(output(game), /已取消武将卡面交互/)
    })
  })

  it("does not treat a bare number as menu input while a game is active", async () => {
    await withHarness(async game => {
      await game.addUser("host", "Host")
      await game.sendGroup("host", "卧底")
      await game.sendGroup("admin", "查询武将")
      await game.sendGroup("admin", "1")
      assert.doesNotMatch(output(game), /张献忠武将技能：/)

      await game.sendGroup("admin", "选择武将 1")
      assert.match(output(game), /张献忠武将技能：.*殒阵/s)
    })
  })

  it("isolates simultaneous administrators and expires stale interactions", async () => {
    await withHarness(async game => {
      await game.addUser("admin2", "Admin2", 5)
      await game.sendGroup("admin", "替换卡面")
      await game.sendGroup("admin2", "替换卡面")
      await game.sendGroup("admin", "朱由检")
      await game.sendGroup("admin2", "张献忠")
      await game.sendGroup("admin2", IMAGE)
      await game.sendGroup("admin", IMAGE)

      const rows = await game.app.database.get("undercover_hero_card", {})
      assert.deepEqual(rows.map(row => row.heroId).sort(), [HERO.ZHANG_XIAN_ZHONG, HERO.ZHU_YOU_JIAN])
      assert.deepEqual(new Set(rows.map(row => row.updatedByUserId)), new Set(["admin", "admin2"]))

      mock.timers.enable({ apis: ["Date", "setTimeout"] })
      try {
        await game.sendGroup("admin", "查询武将")
        mock.timers.tick(301_000)
        await new Promise<void>(resolve => setImmediate(resolve))
        const before = (output(game).match(/多尔衮武将技能：/g) ?? []).length
        await game.sendGroup("admin", "多尔衮")
        assert.equal((output(game).match(/多尔衮武将技能：/g) ?? []).length, before)
      }
      finally {
        mock.timers.reset()
      }
    })
  })
})
