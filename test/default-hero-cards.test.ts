import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { describe, it } from "node:test"
import { HEROES } from "../src/heroes"
import { validateRasterImage } from "../src/game/image-validation"

interface CardManifestEntry {
  heroId: number
  heroKey: string
  heroName: string
  fileName: string
  sha256: string
}

interface CardManifest {
  schemaVersion: number
  setId: string
  status: string
  width: number
  height: number
  cards: CardManifestEntry[]
}

function readPngDimensions(buffer: Buffer): { width: number, height: number } {
  assert.ok(buffer.length >= 24, "PNG 文件过短")
  assert.deepEqual(
    buffer.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "卡面必须为 PNG 文件",
  )
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", "PNG 缺少 IHDR")
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

describe("default hero card release assets", () => {
  it("matches the public manifest, stable hero order, dimensions and hashes", async () => {
    const assetDir = join(process.cwd(), "uc-pics")
    const manifest = JSON.parse(
      await readFile(join(assetDir, "manifest.json"), "utf8"),
    ) as CardManifest

    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.status, "final")
    assert.equal(manifest.setId, "default-heroes-v1")
    assert.deepEqual(Object.keys(manifest).sort(), [
      "cards", "height", "schemaVersion", "setId", "status", "width",
    ])
    assert.equal(manifest.cards.length, HEROES.length)
    assert.equal(new Set(manifest.cards.map((card) => card.heroKey)).size, HEROES.length)
    assert.equal(new Set(manifest.cards.map((card) => card.fileName)).size, HEROES.length)
    assert.deepEqual((await readdir(assetDir)).sort(), [
      "ASSET-LICENSE.md", "manifest.json", ...manifest.cards.map((card) => card.fileName),
    ].sort(), "卡面目录只分发清单、许可与正式 PNG")

    for (const [heroId, hero] of HEROES.entries()) {
      const card = manifest.cards[heroId]
      assert.deepEqual(Object.keys(card).sort(), [
        "fileName", "heroId", "heroKey", "heroName", "sha256",
      ])
      assert.equal(card.heroId, heroId)
      assert.equal(card.heroName, hero.name)
      assert.equal(card.fileName, `${hero.cardImageBase ?? `${hero.name}卡面`}.png`)
      assert.match(card.sha256, /^[a-f0-9]{64}$/)

      const buffer = await readFile(join(assetDir, card.fileName))
      assert.equal(createHash("sha256").update(buffer).digest("hex"), card.sha256)
      assert.deepEqual(readPngDimensions(buffer), {
        width: manifest.width,
        height: manifest.height,
      })
      const validated = validateRasterImage(buffer, { maxPixels: 40_000_000 })
      assert.equal(validated.mimeType, "image/png")
      assert.deepEqual({ width: validated.width, height: validated.height }, {
        width: manifest.width,
        height: manifest.height,
      })
    }
  })

  it("records the current raster typefaces and official license sources", async () => {
    const notice = await readFile(join(process.cwd(), "NOTICE.md"), "utf8")
    for (const typeface of [
      "QIJIC Combo 0.0.1", "Source Han Serif", "Noto Sans CJK 2.004",
      "Noto Serif CJK 2.003", "LXGW WenKai", "DFKai-SB",
    ]) assert.ok(notice.includes(typeface), `缺少当前字体来源：${typeface}`)
    for (const source of [
      "LingDong-/qiji-font/blob/v0.0.1/LICENSE",
      "adobe-fonts/source-han-serif/blob/release/LICENSE.txt",
      "notofonts/noto-cjk/blob/Sans2.004/LICENSE",
      "notofonts/noto-cjk/blob/Serif2.003/Serif/LICENSE",
      "lxgw/LxgwWenKai/blob/v1.522/OFL.txt",
      "learn.microsoft.com/en-us/typography/fonts/font-faq",
    ]) assert.ok(notice.includes(source), `缺少官方许可来源：${source}`)
  })
})
