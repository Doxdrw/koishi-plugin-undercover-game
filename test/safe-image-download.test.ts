import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import type { ClientRequest, IncomingMessage } from "node:http"
import { Readable } from "node:stream"
import { describe, it } from "node:test"
import {
  downloadImageSource,
  isPublicRemoteAddress,
  PinnedRequestFactory,
  PinnedTarget,
  SafeImageDownloadError,
} from "../src/game/safe-image-download"
import { png } from "./image-fixtures"

interface FakeResponse {
  status: number
  headers?: Record<string, string>
  chunks?: Buffer[]
}

describe("safe remote hero-card downloads", () => {
  it("blocks private, local, reserved, mapped and metadata addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.1.1",
      "192.168.1.1",
      "198.51.100.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) assert.equal(isPublicRemoteAddress(address), false, address)
    assert.equal(isPublicRemoteAddress("1.1.1.1"), true)
    assert.equal(isPublicRemoteAddress("2606:4700:4700::1111"), true)
  })

  it("pins one validated DNS result for the request", async () => {
    const targets: PinnedTarget[] = []
    const image = png(7)
    const buffer = await downloadImageSource(new URL("https://cards.example/hero.png"), {
      maxBytes: 1024,
      timeoutMs: 1_000,
      dependencies: {
        lookup: async () => [{ address: "1.1.1.1", family: 4 }],
        request: fakeRequestFactory([
          { status: 200, headers: { "content-length": String(image.length) }, chunks: [image] },
        ], targets),
      },
    })
    assert.deepEqual(buffer, image)
    assert.deepEqual(targets, [{ address: "1.1.1.1", family: 4 }])
  })

  it("rejects credentials, private DNS answers and mixed rebinding answers", async () => {
    await assert.rejects(
      downloadImageSource(new URL("https://user:secret@cards.example/a.png"), {
        maxBytes: 1024,
        timeoutMs: 1_000,
      }),
      /不能包含用户名或密码/,
    )
    for (const addresses of [
      [{ address: "127.0.0.1", family: 4 as const }],
      [
        { address: "1.1.1.1", family: 4 as const },
        { address: "10.0.0.1", family: 4 as const },
      ],
    ]) {
      await assert.rejects(
        downloadImageSource(new URL("https://cards.example/a.png"), {
          maxBytes: 1024,
          timeoutMs: 1_000,
          dependencies: { lookup: async () => addresses },
        }),
        /内网、环回或保留地址/,
      )
    }
  })

  it("revalidates every redirect and refuses redirects into private space", async () => {
    const lookup = async (hostname: string) => hostname === "cards.example"
      ? [{ address: "1.1.1.1", family: 4 as const }]
      : [{ address: "127.0.0.1", family: 4 as const }]
    await assert.rejects(
      downloadImageSource(new URL("https://cards.example/a.png"), {
        maxBytes: 1024,
        timeoutMs: 1_000,
        dependencies: {
          lookup,
          request: fakeRequestFactory([{
            status: 302,
            headers: { location: "http://127.0.0.1/internal.png" },
          }]),
        },
      }),
      /内网、环回或保留地址/,
    )
  })

  it("enforces Content-Length and streaming byte limits before storage", async () => {
    const common = {
      maxBytes: 10,
      timeoutMs: 1_000,
      dependencies: {
        lookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
      },
    }
    await assert.rejects(
      downloadImageSource(new URL("https://cards.example/large.png"), {
        ...common,
        dependencies: {
          ...common.dependencies,
          request: fakeRequestFactory([{ status: 200, headers: { "content-length": "11" } }]),
        },
      }),
      /图片大小不能超过/,
    )
    await assert.rejects(
      downloadImageSource(new URL("https://cards.example/chunked.png"), {
        ...common,
        dependencies: {
          ...common.dependencies,
          request: fakeRequestFactory([{
            status: 200,
            chunks: [Buffer.alloc(6), Buffer.alloc(6)],
          }]),
        },
      }),
      /图片大小不能超过/,
    )
  })

  it("preflights data URLs before base64 decoding", async () => {
    const oversized = Buffer.alloc(12).toString("base64")
    await assert.rejects(
      downloadImageSource(new URL(`data:image/png;base64,${oversized}`), {
        maxBytes: 8,
        timeoutMs: 1_000,
      }),
      /图片大小不能超过/,
    )
    await assert.rejects(
      downloadImageSource(new URL("data:image/png;base64,@@@@"), {
        maxBytes: 8,
        timeoutMs: 1_000,
      }),
      /base64/,
    )
  })
})

function fakeRequestFactory(
  responses: FakeResponse[],
  targets: PinnedTarget[] = [],
): PinnedRequestFactory {
  let index = 0
  return (_url, target, onResponse) => {
    targets.push(target)
    const events = new EventEmitter() as EventEmitter & {
      end(): void
      destroy(error?: Error): void
    }
    let destroyed = false
    events.end = () => {
      queueMicrotask(() => {
        if (destroyed) return
        const response = responses[index++]
        if (!response) {
          events.emit("error", new Error("missing fake response"))
          return
        }
        const stream = Readable.from(response.chunks ?? []) as IncomingMessage
        stream.statusCode = response.status
        stream.headers = response.headers ?? {}
        onResponse(stream)
      })
    }
    events.destroy = (error?: Error) => {
      destroyed = true
      if (error) queueMicrotask(() => events.emit("error", error))
    }
    return events as unknown as ClientRequest
  }
}

assert.ok(SafeImageDownloadError)
