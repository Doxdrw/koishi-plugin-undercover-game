import { safeErrorSummary } from './errors'
import { createHash, randomUUID } from "node:crypto"
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { Context, h } from "koishi"
import { HEROES, heroDefaultCardPath } from "../heroes"
import {
  RasterImageValidationError,
  validateRasterImage,
  ValidatedImage,
} from "./image-validation"
import {
  downloadImageSource,
  SafeImageDownloadDependencies,
  SafeImageDownloadError,
} from "./safe-image-download"

export interface UndercoverHeroCard {
  heroId: number
  relativePath: string
  mimeType: string
  size: number
  sha256: string
  updatedAt: Date
  updatedByPlatform: string
  updatedByUserId: string
}

declare module "koishi" {
  interface Tables {
    undercover_hero_card: UndercoverHeroCard
  }
}

export interface HeroCardActor {
  platform: string
  userId: string
}

export interface HeroCardServiceOptions {
  maxBytes: number
  maxPixels?: number
  downloadTimeoutMs?: number
  networkDependencies?: SafeImageDownloadDependencies
}

export interface HeroCardStatus {
  heroId: number
  heroName: string
  source: "default" | "custom"
  path: string
  record?: UndercoverHeroCard
  invalidReason?: string
}

const MANAGED_DIRECTORY = "hero-cards"
const DEFAULT_MAX_PIXELS = 40_000_000

export function registerHeroCardModel(ctx: Context): void {
  ctx.model.extend("undercover_hero_card", {
    heroId: "integer",
    relativePath: "string",
    mimeType: "string",
    size: "integer",
    sha256: "string",
    updatedAt: "timestamp",
    updatedByPlatform: "string",
    updatedByUserId: "string",
  }, {
    primary: "heroId",
  })
}

export class HeroCardValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HeroCardValidationError"
  }
}

export class HeroCardService {
  readonly dataRoot: string
  readonly cardsRoot: string

  private readonly records = new Map<number, UndercoverHeroCard>()
  private readonly locks = new Map<number, Promise<void>>()
  private readonly warnedRecords = new Set<string>()
  private loadPromise?: Promise<void>

  constructor(
    private readonly ctx: Context,
    private readonly runtimeDir: string,
    private readonly options: HeroCardServiceOptions,
  ) {
    this.dataRoot = resolve(ctx.baseDir, "data", "undercover-game")
    this.cardsRoot = resolve(this.dataRoot, MANAGED_DIRECTORY)
  }

  async load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadRecords().catch(error => {
        this.loadPromise = undefined
        throw error
      })
    }
    return this.loadPromise
  }

  async resolve(heroId: number): Promise<HeroCardStatus> {
    this.assertHeroId(heroId)
    await this.load()
    const record = this.records.get(heroId)
    if (record) {
      const validation = await this.validateStoredRecord(record)
      if (validation.path) {
        return {
          heroId,
          heroName: HEROES[heroId].name,
          source: "custom",
          path: validation.path,
          record,
        }
      }
      this.warnInvalidRecord(record, validation.reason ?? "未知错误")
      return {
        heroId,
        heroName: HEROES[heroId].name,
        source: "default",
        path: this.defaultPath(heroId),
        record,
        invalidReason: validation.reason,
      }
    }
    return {
      heroId,
      heroName: HEROES[heroId].name,
      source: "default",
      path: this.defaultPath(heroId),
    }
  }

  async image(heroId: number) {
    const status = await this.resolve(heroId)
    return h.image(pathToFileURL(status.path).href)
  }

  async list(): Promise<HeroCardStatus[]> {
    return Promise.all(HEROES.map((_hero, heroId) => this.resolve(heroId)))
  }

  async replaceFromSource(
    heroId: number,
    source: string,
    actor: HeroCardActor,
  ): Promise<HeroCardStatus> {
    this.assertHeroId(heroId)
    return this.withHeroLock(heroId, async () => {
      const parsed = this.parseUploadSource(source)
      const buffer = await this.downloadSource(parsed)
      return this.replaceBufferUnlocked(heroId, buffer, actor)
    })
  }

  async replaceBuffer(
    heroId: number,
    buffer: Buffer,
    actor: HeroCardActor,
  ): Promise<HeroCardStatus> {
    this.assertHeroId(heroId)
    return this.withHeroLock(heroId, () => this.replaceBufferUnlocked(heroId, buffer, actor))
  }

  async restoreDefault(heroId: number): Promise<boolean> {
    this.assertHeroId(heroId)
    return this.withHeroLock(heroId, async () => {
      await this.load()
      const oldRecord = this.records.get(heroId)
      if (!oldRecord) return false
      await this.ctx.database.remove("undercover_hero_card", { heroId })
      this.records.delete(heroId)
      this.warnedRecords.clear()
      await this.removeManagedFile(oldRecord.relativePath)
      return true
    })
  }

  private async loadRecords(): Promise<void> {
    const rows = await this.ctx.database.get("undercover_hero_card", {})
    this.records.clear()
    for (const row of rows) {
      if (!Number.isInteger(row.heroId) || row.heroId < 0 || row.heroId >= HEROES.length) {
        this.ctx.logger.warn("忽略未知武将 ID 的自定义卡面记录：%s", row.heroId)
        continue
      }
      this.records.set(row.heroId, row)
    }
  }

  private async replaceBufferUnlocked(
    heroId: number,
    buffer: Buffer,
    actor: HeroCardActor,
  ): Promise<HeroCardStatus> {
    await this.load()
    if (buffer.length === 0) throw new HeroCardValidationError("上传的图片为空。")
    if (buffer.length > this.options.maxBytes) {
      throw new HeroCardValidationError(`图片大小不能超过 ${this.formatBytes(this.options.maxBytes)}。`)
    }
    const detected = this.validateImage(buffer)

    const bytes = new Uint8Array(buffer)
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const filename = `${heroId}-${sha256}.${detected.extension}`
    const relativePath = `${MANAGED_DIRECTORY}/${filename}`
    const absolutePath = resolve(this.dataRoot, ...relativePath.split("/"))
    const temporaryPath = `${absolutePath}.tmp-${randomUUID()}`
    const oldRecord = this.records.get(heroId)
    let createdFile = false

    await mkdir(this.cardsRoot, { recursive: true })
    try {
      await access(absolutePath)
    }
    catch {
      await writeFile(temporaryPath, bytes, { flag: "wx" })
      try {
        await rename(temporaryPath, absolutePath)
        createdFile = true
      }
      catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
        try {
          await access(absolutePath)
        }
        catch {
          throw error
        }
      }
    }

    const record: UndercoverHeroCard = {
      heroId,
      relativePath,
      mimeType: detected.mimeType,
      size: buffer.length,
      sha256,
      updatedAt: new Date(),
      updatedByPlatform: actor.platform,
      updatedByUserId: actor.userId,
    }

    try {
      await this.ctx.database.upsert("undercover_hero_card", [record])
    }
    catch (error) {
      if (createdFile) await rm(absolutePath, { force: true }).catch(() => undefined)
      throw error
    }

    this.records.set(heroId, record)
    this.warnedRecords.clear()
    if (oldRecord?.relativePath && oldRecord.relativePath !== relativePath) {
      await this.removeManagedFile(oldRecord.relativePath)
    }
    return {
      heroId,
      heroName: HEROES[heroId].name,
      source: "custom",
      path: absolutePath,
      record,
    }
  }

  private async validateStoredRecord(record: UndercoverHeroCard): Promise<{ path?: string, reason?: string }> {
    const absolutePath = this.resolveManagedPath(record.relativePath)
    if (!absolutePath) return { reason: "数据库路径不在受管卡面目录内" }
    try {
      const [rootPath, filePath, fileStat, buffer] = await Promise.all([
        realpath(this.cardsRoot),
        realpath(absolutePath),
        stat(absolutePath),
        readFile(absolutePath),
      ])
      if (!isPathInside(rootPath, filePath)) return { reason: "卡面文件通过符号链接指向受管目录外" }
      if (!fileStat.isFile()) return { reason: "卡面路径不是文件" }
      if (fileStat.size !== record.size || buffer.length !== record.size) return { reason: "卡面文件大小与数据库记录不一致" }
      const detected = this.validateImage(buffer)
      if (detected.mimeType !== record.mimeType) return { reason: "卡面文件格式与数据库记录不一致" }
      const digest = createHash("sha256").update(new Uint8Array(buffer)).digest("hex")
      if (digest !== record.sha256) return { reason: "卡面文件校验值与数据库记录不一致" }
      return { path: absolutePath }
    }
    catch (error) {
      const message = safeErrorSummary(error)
      return { reason: `卡面文件无法读取：${message}` }
    }
  }

  private parseUploadSource(source: string): URL {
    if (!source) throw new HeroCardValidationError("没有找到可保存的图片。")
    let parsed: URL
    try {
      parsed = new URL(source)
    }
    catch {
      throw new HeroCardValidationError("图片地址无效。")
    }
    if (!["data:", "http:", "https:"].includes(parsed.protocol)) {
      throw new HeroCardValidationError("仅接受聊天平台上传或 HTTP(S) 图片，不读取任意本地文件。")
    }
    return parsed
  }

  private async downloadSource(source: URL): Promise<Buffer> {
    try {
      return await downloadImageSource(source, {
        maxBytes: this.options.maxBytes,
        timeoutMs: this.options.downloadTimeoutMs ?? 30_000,
        dependencies: this.options.networkDependencies,
      })
    }
    catch (error) {
      if (error instanceof SafeImageDownloadError) {
        throw new HeroCardValidationError(error.message)
      }
      throw error
    }
  }

  private resolveManagedPath(relativePath: string): string | undefined {
    if (!relativePath || isAbsolute(relativePath)) return
    const normalized = relativePath.replaceAll("\\", "/")
    if (!normalized.startsWith(`${MANAGED_DIRECTORY}/`)) return
    const absolutePath = resolve(this.dataRoot, ...normalized.split("/"))
    if (!isPathInside(this.dataRoot, absolutePath)) return
    return absolutePath
  }

  private async removeManagedFile(relativePath: string): Promise<void> {
    const absolutePath = this.resolveManagedPath(relativePath)
    if (!absolutePath) return
    await rm(absolutePath, { force: true }).catch(error => {
      this.ctx.logger.warn("旧武将卡面清理失败（不影响当前卡面生效）：%s", safeErrorSummary(error))
    })
  }

  private defaultPath(heroId: number): string {
    return heroDefaultCardPath(this.runtimeDir, HEROES[heroId].name)
  }

  private assertHeroId(heroId: number): void {
    if (!Number.isInteger(heroId) || heroId < 0 || heroId >= HEROES.length) {
      throw new RangeError(`未知武将 ID：${heroId}`)
    }
  }

  private async withHeroLock<T>(heroId: number, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(heroId) ?? Promise.resolve()
    let release!: () => void
    const marker = new Promise<void>(resolveMarker => { release = resolveMarker })
    const current = previous.then(() => marker)
    this.locks.set(heroId, current)
    await previous
    try {
      return await task()
    }
    finally {
      release()
      if (this.locks.get(heroId) === current) this.locks.delete(heroId)
    }
  }

  private warnInvalidRecord(record: UndercoverHeroCard, reason: string): void {
    const key = `${record.heroId}:${record.relativePath}:${record.sha256}:${reason}`
    if (this.warnedRecords.has(key)) return
    this.warnedRecords.add(key)
    this.ctx.logger.warn(
      "武将 %s 的自定义卡面不可用，已回退默认卡面：%s",
      HEROES[record.heroId].name,
      reason,
    )
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
    return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MiB`
  }

  private validateImage(buffer: Buffer): ValidatedImage {
    try {
      return validateRasterImage(buffer, {
        maxPixels: this.options.maxPixels ?? DEFAULT_MAX_PIXELS,
      })
    }
    catch (error) {
      if (error instanceof RasterImageValidationError) {
        throw new HeroCardValidationError(error.message)
      }
      throw error
    }
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
}

export function detectImage(buffer: Buffer, maxPixels = DEFAULT_MAX_PIXELS): ValidatedImage | undefined {
  try {
    return validateRasterImage(buffer, { maxPixels })
  }
  catch (error) {
    if (error instanceof RasterImageValidationError) return
    throw error
  }
}
