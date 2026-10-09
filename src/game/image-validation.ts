export type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif"

export interface ValidatedImage {
  mimeType: SupportedImageMime
  extension: "png" | "jpg" | "webp" | "gif"
  width: number
  height: number
  frameCount: number
}

export interface ImageValidationLimits {
  maxPixels: number
  maxAnimationFrames?: number
}

export class RasterImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RasterImageValidationError"
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
])

export function validateRasterImage(
  buffer: Buffer,
  limits: ImageValidationLimits,
): ValidatedImage {
  if (!Number.isSafeInteger(limits.maxPixels) || limits.maxPixels <= 0) {
    throw new RangeError("maxPixels 必须是正整数")
  }
  const maxAnimationFrames = limits.maxAnimationFrames ?? 200
  if (!Number.isSafeInteger(maxAnimationFrames) || maxAnimationFrames <= 0) {
    throw new RangeError("maxAnimationFrames 必须是正整数")
  }

  let image: ValidatedImage
  if (matchesBytes(buffer, 0, PNG_SIGNATURE)) {
    image = parsePng(buffer, maxAnimationFrames)
  }
  else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    image = parseJpeg(buffer)
  }
  else if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    image = parseGif(buffer, maxAnimationFrames)
  }
  else if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    image = parseWebp(buffer, maxAnimationFrames)
  }
  else {
    throw new RasterImageValidationError("仅支持 PNG、JPEG、WebP 或 GIF 图片。")
  }

  assertDimensions(image.width, image.height, limits.maxPixels)
  return image
}

function parsePng(buffer: Buffer, maxFrames: number): ValidatedImage {
  let offset = 8
  let width = 0
  let height = 0
  let frameCount = 1
  let sawHeader = false
  let sawData = false
  let sawEnd = false

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) invalid("PNG 数据被截断。")
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii")
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (dataEnd < dataStart || chunkEnd > buffer.length) invalid("PNG 区块长度无效或数据被截断。")

    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) invalid("PNG 缺少有效的 IHDR。")
      width = buffer.readUInt32BE(dataStart)
      height = buffer.readUInt32BE(dataStart + 4)
      const compression = buffer[dataStart + 10]
      const filter = buffer[dataStart + 11]
      const interlace = buffer[dataStart + 12]
      if (compression !== 0 || filter !== 0 || interlace > 1) invalid("PNG IHDR 参数无效。")
      sawHeader = true
    }
    else if (type === "IHDR") {
      invalid("PNG 包含重复 IHDR。")
    }

    if (type === "IDAT") sawData = true
    if (type === "acTL") {
      if (length !== 8) invalid("APNG acTL 区块长度无效。")
      frameCount = buffer.readUInt32BE(dataStart)
      if (frameCount < 1 || frameCount > maxFrames) invalid(`动画帧数不能超过 ${maxFrames}。`)
    }
    if (type === "IEND") {
      if (length !== 0) invalid("PNG IEND 区块长度无效。")
      sawEnd = true
      offset = chunkEnd
      break
    }
    offset = chunkEnd
  }

  if (!sawHeader || !sawData || !sawEnd) invalid("PNG 缺少完整图像数据或结束区块。")
  if (offset !== buffer.length) invalid("PNG 结束区块后存在多余数据。")
  return { mimeType: "image/png", extension: "png", width, height, frameCount }
}

function parseJpeg(buffer: Buffer): ValidatedImage {
  let offset = 2
  let width = 0
  let height = 0
  let sawScan = false
  let sawEnd = false

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) invalid("JPEG 标记结构无效。")
    while (offset < buffer.length && buffer[offset] === 0xff) offset++
    if (offset >= buffer.length) invalid("JPEG 数据被截断。")
    const marker = buffer[offset++]
    if (marker === 0xd9) {
      sawEnd = true
      break
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) invalid("JPEG 段长度被截断。")
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) invalid("JPEG 段长度无效。")

    if (SOF_MARKERS.has(marker)) {
      if (length < 8) invalid("JPEG 尺寸段无效。")
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
    }

    if (marker === 0xda) {
      sawScan = true
      offset += length
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset++
          continue
        }
        let next = offset + 1
        while (next < buffer.length && buffer[next] === 0xff) next++
        if (next >= buffer.length) invalid("JPEG 扫描数据被截断。")
        const escaped = buffer[next]
        if (escaped === 0x00 || (escaped >= 0xd0 && escaped <= 0xd7)) {
          offset = next + 1
          continue
        }
        if (escaped === 0xd9) {
          offset = next + 1
          sawEnd = true
          break
        }
        offset = next - 1
        break
      }
      if (sawEnd) break
      continue
    }
    offset += length
  }

  if (!width || !height || !sawScan || !sawEnd) invalid("JPEG 缺少有效尺寸、扫描数据或结束标记。")
  if (offset !== buffer.length) invalid("JPEG 结束标记后存在多余数据。")
  return { mimeType: "image/jpeg", extension: "jpg", width, height, frameCount: 1 }
}

function parseGif(buffer: Buffer, maxFrames: number): ValidatedImage {
  if (buffer.length < 13) invalid("GIF 数据被截断。")
  const width = buffer.readUInt16LE(6)
  const height = buffer.readUInt16LE(8)
  let offset = 13
  const packed = buffer[10]
  if (packed & 0x80) offset = skipColorTable(buffer, offset, packed)
  let frameCount = 0
  let sawTrailer = false

  while (offset < buffer.length) {
    const blockType = buffer[offset++]
    if (blockType === 0x3b) {
      sawTrailer = true
      break
    }
    if (blockType === 0x2c) {
      if (offset + 9 > buffer.length) invalid("GIF 图像描述符被截断。")
      const imagePacked = buffer[offset + 8]
      offset += 9
      if (imagePacked & 0x80) offset = skipColorTable(buffer, offset, imagePacked)
      if (offset >= buffer.length) invalid("GIF 缺少 LZW 参数。")
      offset++
      offset = skipGifSubBlocks(buffer, offset)
      frameCount++
      if (frameCount > maxFrames) invalid(`动画帧数不能超过 ${maxFrames}。`)
      continue
    }
    if (blockType === 0x21) {
      if (offset >= buffer.length) invalid("GIF 扩展区块被截断。")
      offset++
      offset = skipGifSubBlocks(buffer, offset)
      continue
    }
    invalid("GIF 包含未知或损坏的区块。")
  }

  if (!sawTrailer || frameCount < 1) invalid("GIF 缺少图像帧或结束标记。")
  if (offset !== buffer.length) invalid("GIF 结束标记后存在多余数据。")
  return { mimeType: "image/gif", extension: "gif", width, height, frameCount }
}

function parseWebp(buffer: Buffer, maxFrames: number): ValidatedImage {
  const riffSize = buffer.readUInt32LE(4)
  if (riffSize !== buffer.length - 8) invalid("WebP RIFF 长度与文件不一致。")
  let offset = 12
  let width = 0
  let height = 0
  let frameCount = 0
  let hasImageData = false

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) invalid("WebP 区块头被截断。")
    const type = buffer.subarray(offset, offset + 4).toString("ascii")
    const length = buffer.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + (length & 1)
    if (dataEnd < dataStart || chunkEnd > buffer.length) invalid("WebP 区块长度无效或数据被截断。")

    if (type === "VP8X") {
      if (length !== 10) invalid("WebP VP8X 区块长度无效。")
      width = readUInt24LE(buffer, dataStart + 4) + 1
      height = readUInt24LE(buffer, dataStart + 7) + 1
    }
    else if (type === "VP8 ") {
      if (length < 10 || !matchesBytes(buffer, dataStart + 3, [0x9d, 0x01, 0x2a])) {
        invalid("WebP VP8 帧头无效。")
      }
      width ||= buffer.readUInt16LE(dataStart + 6) & 0x3fff
      height ||= buffer.readUInt16LE(dataStart + 8) & 0x3fff
      hasImageData = true
    }
    else if (type === "VP8L") {
      if (length < 5 || buffer[dataStart] !== 0x2f) invalid("WebP VP8L 帧头无效。")
      const bits = buffer.readUInt32LE(dataStart + 1)
      width ||= (bits & 0x3fff) + 1
      height ||= ((bits >>> 14) & 0x3fff) + 1
      hasImageData = true
    }
    else if (type === "ANMF") {
      if (length < 16) invalid("WebP 动画帧区块无效。")
      frameCount++
      hasImageData = true
      if (frameCount > maxFrames) invalid(`动画帧数不能超过 ${maxFrames}。`)
    }
    offset = chunkEnd
  }

  if (offset !== buffer.length || !width || !height || !hasImageData) {
    invalid("WebP 缺少有效尺寸或图像数据。")
  }
  return {
    mimeType: "image/webp",
    extension: "webp",
    width,
    height,
    frameCount: Math.max(1, frameCount),
  }
}

function matchesBytes(buffer: Buffer, offset: number, expected: readonly number[]): boolean {
  if (offset < 0 || offset + expected.length > buffer.length) return false
  return expected.every((value, index) => buffer[offset + index] === value)
}

function skipColorTable(buffer: Buffer, offset: number, packed: number): number {
  const length = 3 * (1 << ((packed & 0x07) + 1))
  if (offset + length > buffer.length) invalid("GIF 颜色表被截断。")
  return offset + length
}

function skipGifSubBlocks(buffer: Buffer, start: number): number {
  let offset = start
  while (offset < buffer.length) {
    const length = buffer[offset++]
    if (length === 0) return offset
    if (offset + length > buffer.length) invalid("GIF 数据子块被截断。")
    offset += length
  }
  invalid("GIF 数据子块缺少结束标记。")
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function assertDimensions(width: number, height: number, maxPixels: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    invalid("图片尺寸必须是非零正整数。")
  }
  if (width > Math.floor(maxPixels / height)) {
    invalid(`图片像素总量不能超过 ${maxPixels}。`)
  }
}

function invalid(message: string): never {
  throw new RasterImageValidationError(message)
}
