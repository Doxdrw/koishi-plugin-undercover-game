import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  RasterImageValidationError,
  validateRasterImage,
} from "../src/game/image-validation"
import { gif, jpeg, png, webp } from "./image-fixtures"

describe("structural raster image validation", () => {
  it("reads dimensions and frame counts from every supported format", () => {
    assert.deepEqual(validateRasterImage(png(1, 320, 180), { maxPixels: 100_000 }), {
      mimeType: "image/png",
      extension: "png",
      width: 320,
      height: 180,
      frameCount: 1,
    })
    assert.equal(validateRasterImage(jpeg(20, 10), { maxPixels: 1_000 }).width, 20)
    assert.equal(validateRasterImage(gif(20, 10, 2), { maxPixels: 1_000 }).frameCount, 2)
    assert.equal(validateRasterImage(webp(20, 10), { maxPixels: 1_000 }).height, 10)
  })

  it("rejects forged headers, truncated files, zero dimensions and pixel bombs", () => {
    for (const buffer of [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from("GIF89a"),
      Buffer.from("RIFF0000WEBP"),
    ]) {
      assert.throws(
        () => validateRasterImage(buffer, { maxPixels: 1_000 }),
        RasterImageValidationError,
      )
    }
    assert.throws(
      () => validateRasterImage(png(1, 0, 1), { maxPixels: 1_000 }),
      /非零正整数/,
    )
    assert.throws(
      () => validateRasterImage(png(1, 10_000, 10_000), { maxPixels: 40_000_000 }),
      /像素总量/,
    )
  })

  it("rejects abnormal animation frame counts", () => {
    assert.throws(
      () => validateRasterImage(gif(1, 1, 3), { maxPixels: 10, maxAnimationFrames: 2 }),
      /动画帧数不能超过 2/,
    )
  })
})
