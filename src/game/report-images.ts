import { h, type Session } from 'koishi'

interface Clip { x: number; y: number; width: number; height: number }
export interface ReportBrowserPage {
  setViewport(value: { width: number; height: number; deviceScaleFactor: number }): Promise<void>
  setJavaScriptEnabled(enabled: boolean): Promise<void>
  setRequestInterception(enabled: boolean): Promise<void>
  on(event: 'request', listener: (request: { abort(): Promise<void> }) => void): unknown
  setContent(html: string, options: { timeout: number; waitUntil: 'load' }): Promise<void>
  $(selector: string): Promise<{ boundingBox(): Promise<Clip | null> } | null>
  screenshot(options: { type: 'png'; clip: Clip }): Promise<Uint8Array>
  close(): Promise<void>
}
export interface ReportBrowser { page(): Promise<ReportBrowserPage> }
export interface ReportTable { caption?: string; headers: string[]; rows: string[][] }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

/** Text and attachments come from the already-authorized, already-paginated view. */
export function reportParts(content: h.Fragment) {
  const attachments: h[] = []
  const visit = (elements: h[]): string => elements.map(element => {
    if (element.type === 'text') return String(element.attrs.content ?? '')
    if (['img', 'image', 'audio', 'video', 'file', 'face'].includes(element.type)) {
      attachments.push(element)
      return element.type === 'face' ? '[表情' + String(element.attrs.name ?? element.attrs.id ?? '') + ']'
        : ({ img: '[图片]', image: '[图片]', audio: '[语音]', video: '[视频]', file: '[文件]' })[element.type]!
    }
    return visit(element.children)
  }).join('')
  const text = visit(typeof content === 'string' ? h.parse(content) : h.normalize(content))
  return { text, attachments }
}

/** Keep paragraph/line boundaries and bound estimated glyph rows before Chromium. */
export function reportImagePages(text: string, rowsPerPage = 40): string[] {
  if (text.length > 30_000) throw new Error('report content exceeds image budget')
  const lines = text.replace(/\r/g, '').split('\n'), pages: string[] = []
  let page: string[] = [], rows = 0
  const flush = () => { if (page.length) pages.push(page.join('\n')); page = []; rows = 0 }
  for (const line of lines) {
    const characters = Array.from(line), estimated = Math.max(1, Math.ceil(characters.length / 32))
    if (estimated > rowsPerPage) {
      flush()
      for (let index = 0; index < characters.length; index += rowsPerPage * 32) pages.push(characters.slice(index, index + rowsPerPage * 32).join(''))
      continue
    }
    if (rows + estimated > rowsPerPage) flush()
    page.push(line); rows += estimated
  }
  flush()
  if (pages.length > 6) throw new Error('report image count exceeds budget')
  return pages.length ? pages : ['暂无内容']
}

export function reportHtml(title: string, body: string, page: number, pages: number) {
  const lines = body.split('\n').map(line => {
    return '<div class="line">' + (line ? escapeHtml(line) : '&nbsp;') + '</div>'
  }).join('')
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
    + '<style>*{box-sizing:border-box}body{margin:0;background:#fff;font-family:system-ui,"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#182334}'
    + '#report{width:960px;padding:32px 40px;border-top:8px solid #335b82}h1{font-size:30px;margin:0 0 24px;color:#254f75}'
    + '.line{font-size:24px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}'
    + 'footer{margin-top:24px;border-top:1px solid #dce4ed;padding-top:14px;font-size:18px;color:#65758a}</style></head><body><main id="report">'
    + '<h1>' + escapeHtml(title) + '</h1>' + lines + '<footer>谁是卧底' + (pages > 1 ? ` · 第${page}/${pages}张` : '') + '</footer></main></body></html>'
}

/** Cell boundaries are data, never inferred from punctuation or newlines. */
export function reportTableHtml(title: string, table: ReportTable, page: number, pages: number): string {
  const html = reportHtml(title, '', page, pages)
  const rows = (table.caption ? '<p class="line">' + escapeHtml(table.caption) + '</p>' : '')
    + '<table><thead><tr>' + table.headers.map(c => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr></thead><tbody>'
    + table.rows.map(row => '<tr>' + row.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
  return html.replace('</style>', 'table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #dce4ed;padding:9px;font-size:22px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top}th{background:#eaf0f6}th:first-child{width:22%}th:nth-child(2){width:12%}</style>')
    .replace('<div class="line">&nbsp;</div>', rows)
}

function splitTableRow(row: string[]): string[][] {
  // Repeat the seat/identity labels; split only data cells, and retain every
  // original character (including line breaks) in the two ordered pieces.
  if (!row.slice(2).some(cell => Array.from(cell).length > 1)) throw new Error('report table label exceeds layout budget')
  const cells = row.map(cell => Array.from(cell))
  const cuts = cells.map(cell => {
    if (cell.length <= 40 && cell.filter(char => char === '\n').length < 4) return cell.length
    const middle = Math.ceil(cell.length / 2)
    const newline = cell.lastIndexOf('\n', middle)
    return newline >= cell.length / 4 ? newline + 1 : middle
  })
  return [0, 1].map(part => cells.map((cell, column) => column < 2
    ? row[column] + (column === 0 && part === 1 && !row[column].endsWith('（续）') ? '（续）' : '')
    : cell.slice(part === 0 ? 0 : cuts[column], part === 0 ? cuts[column] : undefined).join('')))
}

export class ReportImages {
  private busy = false
  constructor(private readonly browser: () => ReportBrowser | undefined, private readonly options: { enabled: boolean; timeoutMs: number },
    private readonly onFailure: (error: unknown) => void) {}

  async send(session: Pick<Session, 'send'>, title: string, content: h.Fragment, table?: ReportTable): Promise<boolean> {
    if (!this.options.enabled || this.busy) return false
    this.busy = true
    let page: ReportBrowserPage | undefined, timer: ReturnType<typeof setTimeout> | undefined, expired = false
    try {
      const browser = this.browser()
      if (!browser) return false
      const parts = reportParts(content)
      if (parts.attachments.length > 16) return false
      if (parts.text.length > 30_000) throw new Error('report content exceeds image budget')
      const operation = (async () => {
        page = await browser.page()
        if (expired) { await page.close(); throw new Error('report image timeout') }
        await page.setJavaScriptEnabled(false)
        await page.setRequestInterception(true)
        page.on('request', request => { void request.abort().catch(() => undefined) })
        await page.setViewport({ width: 960, height: 100, deviceScaleFactor: 1 })
        let pages = table ? [] : reportImagePages(parts.text)
        let tablePages: string[][][] | undefined
        if (table) {
          const pending = [table.rows], fitted: string[][][] = []
          while (pending.length) {
            if (expired || pending.length + fitted.length > 6) throw new Error('report table page budget exceeded')
            const rows = pending.shift()!
            await page.setContent(reportTableHtml(title, { ...table, rows }, 1, 1), { timeout: this.options.timeoutMs, waitUntil: 'load' })
            const clip = await (await page.$('#report'))?.boundingBox()
            if (!clip) throw new Error('report table layout unavailable')
            if (clip.height <= 2200) fitted.push(rows)
            else {
              if (rows.length === 1) pending.unshift(...splitTableRow(rows[0]).map(row => [row]))
              else {
                const middle = Math.ceil(rows.length / 2)
                pending.unshift(rows.slice(0, middle), rows.slice(middle))
              }
            }
          }
          tablePages = fitted
          pages = fitted.map(() => '')
        }
        const images: Uint8Array[] = []
        for (const [index, text] of pages.entries()) {
          if (expired) throw new Error('report image timeout')
          await page.setContent(tablePages ? reportTableHtml(title, { ...table!, rows: tablePages[index] }, index + 1, pages.length) : reportHtml(title, text, index + 1, pages.length), { timeout: this.options.timeoutMs, waitUntil: 'load' })
          const element = await page.$('#report'), clip = await element?.boundingBox()
          if (!clip || clip.width > 1000 || clip.height > 2200 || clip.width * clip.height > 2_200_000) throw new Error('report image dimensions exceed budget')
          const bytes = await page.screenshot({ type: 'png', clip })
          if (bytes.length > 10 * 1024 * 1024) throw new Error('report image bytes exceed budget')
          images.push(bytes)
        }
        return images
      })()
      const images = await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error('report image timeout')) }, this.options.timeoutMs)
      })])
      clearTimeout(timer)
      for (const bytes of images) {
        const ids = await session.send(h.image(Buffer.from(bytes), 'image/png'))
        if (!ids?.length) throw new Error('report image was not delivered')
      }
      if (parts.attachments.length) {
        const ids = await session.send(h('template', {}, ...parts.attachments))
        if (!ids?.length) throw new Error('report attachments were not delivered')
      }
      return true
    } catch (error) { this.onFailure(error); return false }
    finally {
      clearTimeout(timer)
      if (page) void page.close().catch(this.onFailure)
      this.busy = false
    }
  }
}
