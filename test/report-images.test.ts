import assert from 'node:assert/strict'
import { it } from 'node:test'
import { h } from 'koishi'
import { ReportImages, reportHtml, reportImagePages, reportParts, type ReportBrowserPage } from '../src/game/report-images'

function fixture(fail?: 'render' | 'send' | 'size') {
  const html: string[] = [], messages: string[] = [], settings: unknown[] = []
  let closed = false
  const page: ReportBrowserPage = {
    setJavaScriptEnabled: async value => { settings.push(['javascript', value]) },
    setRequestInterception: async value => { settings.push(['interception', value]) },
    setViewport: async value => { settings.push(['viewport', value]) }, on: () => {},
    setContent: async value => { html.push(value); if (fail === 'render') throw new Error('render failed') },
    $: async () => ({ boundingBox: async () => ({ x: 0, y: 0, width: 960, height: fail === 'size' ? 9000 : 1000 }) }),
    screenshot: async () => new Uint8Array([1, 2, 3]), close: async () => { closed = true },
  }
  const errors: unknown[] = [], images = new ReportImages(() => ({ page: async () => page }), { enabled: true, timeoutMs: 1000 }, error => errors.push(error))
  const session = { send: async (content: h.Fragment) => { if (fail === 'send') throw new Error('send failed'); messages.push(String(content)); return ['sent'] } }
  return { images, page, session: session as any, html, messages, settings, errors, closed: () => closed }
}

it('escapes all supplied text and applies a script/network denying document policy', () => {
  const html = reportHtml('<script>alert(1)</script>', 'Alice<img src="file:///private"/>\n1号｜好人｜选词', 1, 1)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&lt;img'))
  assert.doesNotMatch(html, /<script|<img|第1\/1/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /class="row"/)
})

it('splits long content without losing or reordering lines and refuses excessive pages', () => {
  const text = Array.from({ length: 85 }, (_, index) => `第${index + 1}行`).join('\n')
  const pages = reportImagePages(text)
  assert.equal(pages.length, 3)
  assert.equal(pages.join('\n'), text)
  assert.throws(() => reportImagePages('词'.repeat(100_000)), /budget/)
})

it('retains face and media as original attachments rather than browser HTML', async () => {
  const content = h('template', {}, h.text('公开发言'), h('face', { id: '14' }), h.image('https://example.com/public.png'))
  const parts = reportParts(content)
  assert.match(parts.text, /公开发言\[表情14\]\[图片\]/)
  assert.equal(parts.attachments.length, 2)
  const test = fixture()
  assert.equal(await test.images.send(test.session, '复盘', content), true)
  assert.equal(test.messages.length, 2)
  assert.match(test.messages[1], /face id="14"/)
  assert.match(test.messages[1], /example.com/)
  assert.doesNotMatch(test.html.join(), /example.com/)
  assert.deepEqual(test.settings.slice(0, 2), [['javascript', false], ['interception', true]])
  assert.equal(test.closed(), true)
})

for (const fail of ['render', 'send', 'size'] as const) it(`returns control to the complete text fallback after ${fail} failure`, async () => {
  const test = fixture(fail)
  assert.equal(await test.images.send(test.session, '复盘', h.text('完整原文')), false)
  assert.equal(test.errors.length, 1)
  assert.equal(test.closed(), true)
})

it('does not require a browser and does not queue overlapping renders', async () => {
  const disabled = new ReportImages(() => { throw new Error('disabled output must not access the service') }, { enabled: false, timeoutMs: 100 }, () => {})
  assert.equal(await disabled.send({ send: async () => ['id'] } as any, '复盘', h.text('文字')), false)
  const noBrowser = new ReportImages(() => undefined, { enabled: true, timeoutMs: 100 }, () => {})
  assert.equal(await noBrowser.send({ send: async () => ['id'] } as any, '复盘', h.text('文字')), false)
  let release!: () => void
  const test = fixture(), page = test.page, set = page.setContent.bind(page)
  page.setContent = async value => { await new Promise<void>(resolve => { release = resolve }); return set(value, { timeout: 1000, waitUntil: 'load' }) }
  const first = test.images.send(test.session, '复盘', h.text('第一份'))
  for (let i = 0; i < 10 && !release; i++) await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(await test.images.send(test.session, '复盘', h.text('第二份')), false)
  release(); assert.equal(await first, true)
})

it('times out and closes the page instead of leaving a stuck render', async () => {
  const page = fixture().page
  let closed = false
  page.setContent = async () => new Promise<void>(() => {})
  page.close = async () => { closed = true }
  const images = new ReportImages(() => ({ page: async () => page }), { enabled: true, timeoutMs: 20 }, () => {})
  assert.equal(await images.send({ send: async () => ['id'] } as any, '复盘', h.text('文字')), false)
  assert.equal(closed, true)
})
