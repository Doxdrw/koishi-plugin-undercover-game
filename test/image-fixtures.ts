const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function png(suffix = 1, width = 1, height = 1): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_HEADER,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([suffix])),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

export function jpeg(width = 1, height = 1): Buffer {
  const sof = Buffer.alloc(8)
  sof.writeUInt16BE(8, 0)
  sof[2] = 8
  sof.writeUInt16BE(height, 3)
  sof.writeUInt16BE(width, 5)
  sof[7] = 0
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0]),
    sof,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x01, 0xff, 0xd9]),
  ])
}

export function gif(width = 1, height = 1, frames = 1): Buffer {
  const header = Buffer.alloc(13)
  header.write("GIF89a", 0, "ascii")
  header.writeUInt16LE(width, 6)
  header.writeUInt16LE(height, 8)
  const image = Buffer.from([
    0x2c,
    0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00,
    0x00,
    0x02,
    0x01, 0x00,
    0x00,
  ])
  return Buffer.concat([header, ...Array.from({ length: frames }, () => image), Buffer.from([0x3b])])
}

export function webp(width = 1, height = 1): Buffer {
  const bits = ((height - 1) << 14) | (width - 1)
  const payload = Buffer.alloc(5)
  payload[0] = 0x2f
  payload.writeUInt32LE(bits >>> 0, 1)
  const chunk = Buffer.concat([
    Buffer.from("VP8L", "ascii"),
    uint32le(payload.length),
    payload,
    Buffer.alloc(payload.length & 1),
  ])
  return Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    uint32le(4 + chunk.length),
    Buffer.from("WEBP", "ascii"),
    chunk,
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)])
}

function uint32le(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value)
  return buffer
}
