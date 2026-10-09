import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { HERO } from "../src/heroes"
import {
  HeroCardService,
  HeroCardValidationError,
  detectImage,
} from "../src/game/hero-card-service"
import { UndercoverGameHarness } from "./game-harness"
import { gif, jpeg, png, webp } from "./image-fixtures"

async function withService(
  run: (service: HeroCardService, game: UndercoverGameHarness, baseDir: string) => Promise<void>,
  maxBytes = 1024,
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "undercover-card-"))
  const game = await UndercoverGameHarness.create(
    { heroCardMaxBytes: Math.max(maxBytes, 1024) },
    { baseDir },
  )
  const service = new HeroCardService(game.app, join(process.cwd(), "src"), { maxBytes })
  try {
    await run(service, game, baseDir)
  }
  finally {
    await game.stop()
    await rm(baseDir, { recursive: true, force: true })
  }
}

describe("hero card storage", () => {
  it("detects only the supported raster image formats", () => {
    assert.equal(detectImage(png(1))?.mimeType, "image/png")
    assert.equal(detectImage(jpeg())?.mimeType, "image/jpeg")
    assert.equal(detectImage(gif())?.mimeType, "image/gif")
    assert.equal(detectImage(webp())?.mimeType, "image/webp")
    assert.equal(detectImage(Buffer.from([0xff, 0xd8, 0xff])), undefined)
    assert.equal(detectImage(Buffer.from("GIF89a")), undefined)
    assert.equal(detectImage(Buffer.from("RIFF0000WEBP")), undefined)
    assert.equal(detectImage(Buffer.from("<svg/>")), undefined)
  })

  it("uses defaults until an override is atomically stored and can be restored", async () => {
    await withService(async (service, game) => {
      assert.equal((await service.resolve(HERO.ZHU_YOU_JIAN)).source, "default")

      const custom = await service.replaceBuffer(HERO.ZHU_YOU_JIAN, png(1), {
        platform: "sandbox",
        userId: "admin",
      })
      assert.equal(custom.source, "custom")
      assert.match(custom.path, /data[\\/]undercover-game[\\/]hero-cards/)
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 1)

      const reloaded = new HeroCardService(game.app, join(process.cwd(), "src"), { maxBytes: 1024 })
      assert.equal((await reloaded.resolve(HERO.ZHU_YOU_JIAN)).source, "custom")
      assert.equal(await reloaded.restoreDefault(HERO.ZHU_YOU_JIAN), true)
      assert.equal(await reloaded.restoreDefault(HERO.ZHU_YOU_JIAN), false)
      assert.equal((await reloaded.resolve(HERO.ZHU_YOU_JIAN)).source, "default")
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 0)
    })
  })

  it("rejects unsupported and oversized uploads without changing storage", async () => {
    await withService(async (service, game) => {
      await assert.rejects(
        service.replaceBuffer(HERO.ZHANG_XIAN_ZHONG, Buffer.from("<svg/>"), {
          platform: "sandbox",
          userId: "admin",
        }),
        (error: unknown) => error instanceof HeroCardValidationError && /仅支持/.test(error.message),
      )
      await assert.rejects(
        service.replaceBuffer(HERO.ZHANG_XIAN_ZHONG, png(1), {
          platform: "sandbox",
          userId: "admin",
        }),
        (error: unknown) => error instanceof HeroCardValidationError && /不能超过/.test(error.message),
      )
      assert.equal((await game.app.database.get("undercover_hero_card", {})).length, 0)
    }, 16)
  })

  it("falls back for missing, corrupted, and path-traversing records", async () => {
    await withService(async (service, game, baseDir) => {
      const custom = await service.replaceBuffer(HERO.LI_ZI_CHENG, png(2), {
        platform: "sandbox",
        userId: "admin",
      })
      await writeFile(custom.path, png(3))
      assert.equal((await service.resolve(HERO.LI_ZI_CHENG)).source, "default")
      assert.match((await service.resolve(HERO.LI_ZI_CHENG)).invalidReason ?? "", /校验值/)

      await game.app.database.upsert("undercover_hero_card", [{
        heroId: HERO.ZHANG_XIAN_ZHONG,
        relativePath: "../outside.png",
        mimeType: "image/png",
        size: png(4).length,
        sha256: createHash("sha256").update(png(4)).digest("hex"),
        updatedAt: new Date(),
        updatedByPlatform: "sandbox",
        updatedByUserId: "admin",
      }])
      await writeFile(join(baseDir, "data", "outside.png"), png(4)).catch(async () => {
        await mkdir(join(baseDir, "data"), { recursive: true })
        await writeFile(join(baseDir, "data", "outside.png"), png(4))
      })
      const reloaded = new HeroCardService(game.app, join(process.cwd(), "src"), { maxBytes: 1024 })
      const traversal = await reloaded.resolve(HERO.ZHANG_XIAN_ZHONG)
      assert.equal(traversal.source, "default")
      assert.match(traversal.invalidReason ?? "", /不在受管卡面目录/)

      await rm(custom.path, { force: true })
      const missing = await reloaded.resolve(HERO.LI_ZI_CHENG)
      assert.equal(missing.source, "default")
      assert.match(missing.invalidReason ?? "", /无法读取/)
    })
  })

  it("serializes concurrent replacements and keeps the last successful card", async () => {
    await withService(async (service, game, baseDir) => {
      const buffers = [png(5), png(6), png(7)]
      await Promise.all(buffers.map(buffer => service.replaceBuffer(
        HERO.DUO_ER_GUN,
        buffer,
        { platform: "sandbox", userId: "admin" },
      )))
      const [row] = await game.app.database.get("undercover_hero_card", { heroId: HERO.DUO_ER_GUN })
      assert.equal(row.sha256, createHash("sha256").update(buffers[2]).digest("hex"))
      assert.equal((await service.resolve(HERO.DUO_ER_GUN)).source, "custom")
      const files = await readdir(join(baseDir, "data", "undercover-game", "hero-cards"))
      assert.deepEqual(files, [row.relativePath.split("/").at(-1)])
    })
  })
})
