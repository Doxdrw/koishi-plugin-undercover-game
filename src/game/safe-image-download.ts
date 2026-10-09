import type { LookupAddress } from "node:dns"
import { lookup as dnsLookup } from "node:dns/promises"
import { request as httpRequest, ClientRequest, IncomingMessage, RequestOptions } from "node:http"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP } from "node:net"

export interface SafeImageDownloadOptions {
  maxBytes: number
  timeoutMs: number
  maxRedirects?: number
  dependencies?: SafeImageDownloadDependencies
}

export interface SafeImageDownloadDependencies {
  lookup?: (hostname: string) => Promise<readonly LookupAddress[]>
  request?: PinnedRequestFactory
}

export interface PinnedTarget {
  address: string
  family: 4 | 6
}

export type PinnedRequestFactory = (
  url: URL,
  target: PinnedTarget,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest

export class SafeImageDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SafeImageDownloadError"
  }
}

const BLOCKED_ADDRESSES = createBlockedAddressList()

export async function downloadImageSource(
  source: URL,
  options: SafeImageDownloadOptions,
): Promise<Buffer> {
  assertPositiveInteger(options.maxBytes, "maxBytes")
  assertPositiveInteger(options.timeoutMs, "timeoutMs")
  if (source.protocol === "data:") return decodeDataUrl(source, options.maxBytes)
  if (source.protocol !== "http:" && source.protocol !== "https:") {
    throw new SafeImageDownloadError("仅接受聊天平台上传或 HTTP(S) 图片，不读取任意本地文件。")
  }
  const deadline = Date.now() + options.timeoutMs
  return downloadRemoteUrl(source, options, deadline, options.maxRedirects ?? 5)
}

export function isPublicRemoteAddress(address: string): boolean {
  const normalized = stripIpv6Zone(address)
  const family = isIP(normalized)
  if (!family) return false
  return !BLOCKED_ADDRESSES.check(normalized, family === 4 ? "ipv4" : "ipv6")
}

function decodeDataUrl(source: URL, maxBytes: number): Buffer {
  const match = /^data:([\w/.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/s.exec(source.href)
  if (!match) throw new SafeImageDownloadError("仅接受格式正确的 base64 编码内嵌图片。")
  const encoded = match[2]
  if (encoded.length % 4 === 1) throw new SafeImageDownloadError("内嵌图片编码无效。")
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0
  const decodedUpperBound = Math.floor(encoded.length * 3 / 4) - padding
  if (decodedUpperBound > maxBytes) throw tooLarge(maxBytes)
  const buffer = Buffer.from(encoded, "base64")
  if (buffer.length > maxBytes) throw tooLarge(maxBytes)
  return buffer
}

async function downloadRemoteUrl(
  source: URL,
  options: SafeImageDownloadOptions,
  deadline: number,
  redirectsRemaining: number,
): Promise<Buffer> {
  assertSafeRemoteUrl(source)
  const remainingForLookup = deadline - Date.now()
  if (remainingForLookup <= 0) throw new SafeImageDownloadError("图片下载超时。")

  const hostname = normalizeHostname(source.hostname)
  const lookup = options.dependencies?.lookup ?? defaultLookup
  const addresses = await withDeadline(
    lookup(hostname),
    remainingForLookup,
    "图片地址解析超时。",
  )
  if (!addresses.length) throw new SafeImageDownloadError("图片地址没有可用的 DNS 记录。")

  const targets = addresses.map(({ address, family }) => ({
    address: stripIpv6Zone(address),
    family: Number(family) as 4 | 6,
  }))
  if (targets.some(target => !isPublicRemoteAddress(target.address))) {
    throw new SafeImageDownloadError("图片地址解析到了内网、环回或保留地址，已拒绝访问。")
  }
  const target = targets[0]
  const remainingForRequest = deadline - Date.now()
  if (remainingForRequest <= 0) throw new SafeImageDownloadError("图片下载超时。")

  const createRequest = options.dependencies?.request ?? defaultPinnedRequest
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false
    let timeout: NodeJS.Timeout | undefined
    const finish = (error?: unknown, buffer?: Buffer) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (error) reject(normalizeDownloadError(error))
      else resolve(buffer!)
    }

    let request: ClientRequest
    try {
      request = createRequest(source, target, response => {
        void handleResponse(
          response,
          source,
          options,
          deadline,
          redirectsRemaining,
        ).then(buffer => finish(undefined, buffer), finish)
      })
    }
    catch (error) {
      finish(error)
      return
    }

    timeout = setTimeout(() => {
      const error = new SafeImageDownloadError("图片下载超时。")
      request.destroy(error)
      finish(error)
    }, remainingForRequest)
    timeout.unref?.()
    request.once("error", finish)
    request.end()
  })
}

async function handleResponse(
  response: IncomingMessage,
  source: URL,
  options: SafeImageDownloadOptions,
  deadline: number,
  redirectsRemaining: number,
): Promise<Buffer> {
  const status = response.statusCode ?? 0
  if (status >= 300 && status < 400 && response.headers.location) {
    response.destroy()
    if (redirectsRemaining <= 0) throw new SafeImageDownloadError("图片下载重定向次数超过 5 次。")
    let target: URL
    try {
      target = new URL(response.headers.location, source)
    }
    catch {
      throw new SafeImageDownloadError("图片下载返回了无效的重定向地址。")
    }
    return downloadRemoteUrl(target, options, deadline, redirectsRemaining - 1)
  }
  if (status < 200 || status >= 300) {
    response.destroy()
    throw new SafeImageDownloadError(`图片下载失败（HTTP ${status || "未知"}）。`)
  }

  const contentLength = parseContentLength(response.headers["content-length"])
  if (contentLength !== undefined && contentLength > options.maxBytes) {
    response.destroy()
    throw tooLarge(options.maxBytes)
  }

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > options.maxBytes) {
        response.destroy()
        throw tooLarge(options.maxBytes)
      }
      chunks.push(new Uint8Array(buffer))
    }
  }
  catch (error) {
    if (error instanceof SafeImageDownloadError) throw error
    throw new SafeImageDownloadError('图片下载中断，请稍后重试。')
  }
  return Buffer.concat(chunks, total)
}

async function defaultLookup(hostname: string): Promise<readonly LookupAddress[]> {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
  }
  return dnsLookup(hostname, { all: true, verbatim: true })
}

function defaultPinnedRequest(
  url: URL,
  target: PinnedTarget,
  onResponse: (response: IncomingMessage) => void,
): ClientRequest {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest
  const options: RequestOptions = {
    headers: {
      accept: "image/png,image/jpeg,image/webp,image/gif,*/*;q=0.1",
      "accept-encoding": "identity",
      "user-agent": "koishi-plugin-undercover-game/hero-card-fetch",
    },
    lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
  }
  return request(url, options, onResponse)
}

function assertSafeRemoteUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeImageDownloadError("图片重定向到了不受支持的协议。")
  }
  if (url.username || url.password) {
    throw new SafeImageDownloadError("图片地址不能包含用户名或密码。")
  }
  if (!url.hostname || url.hostname.includes("%")) {
    throw new SafeImageDownloadError("图片地址的主机名无效。")
  }
}

function normalizeHostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1)
  return hostname
}

function stripIpv6Zone(address: string): string {
  const percent = address.indexOf("%")
  return percent >= 0 ? address.slice(0, percent) : address
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return
  if (!/^\d+$/.test(value)) throw new SafeImageDownloadError("图片响应的 Content-Length 无效。")
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new SafeImageDownloadError("图片响应的 Content-Length 过大。")
  return parsed
}

function createBlockedAddressList(): BlockList {
  const list = new BlockList()
  const ipv4: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ]
  const ipv6: Array<[string, number]> = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
  ]
  for (const [address, prefix] of ipv4) list.addSubnet(address, prefix, "ipv4")
  for (const [address, prefix] of ipv6) list.addSubnet(address, prefix, "ipv6")
  return list
}

function tooLarge(maxBytes: number): SafeImageDownloadError {
  return new SafeImageDownloadError(`图片大小不能超过 ${formatBytes(maxBytes)}。`)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MiB`
}

function normalizeDownloadError(error: unknown): SafeImageDownloadError {
  if (error instanceof SafeImageDownloadError) return error
  return new SafeImageDownloadError('图片下载失败，请稍后重试。')
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} 必须是正整数`)
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SafeImageDownloadError(message)), timeoutMs)
    timer.unref?.()
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(normalizeDownloadError(error))
      },
    )
  })
}
