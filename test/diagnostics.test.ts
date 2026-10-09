import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, stat, utimes, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiagnosticLog, sanitizeDiagnosticBody } from '../src/game/diagnostics'
import { UndercoverGameHarness } from './game-harness'

async function entries(base: string) {
  const path = join(base, 'data/undercover-game/logs')
  const files = await readdir(path)
  return (await Promise.all(files.filter(f => f.endsWith('.jsonl')).map(f => readFile(join(path, f), 'utf8')))).join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}
it('redacts tokens media URL credentials/query and local paths, with bounded Unicode output', () => {
  const raw = 'XPACCOUNT-abcdef UCHIST-123 data:image/png;base64,abc <img src="https://example.com/i?token=secret"/> https://user:pass@example.com/x?a=secret file:///private/x [CQ:image,file=base64://secret]'
  const clean = sanitizeDiagnosticBody(raw)
  assert.doesNotMatch(clean, /abcdef|base64|secret|user:pass|private\/x/)
  assert.match(clean, /example\.com/)
  assert.doesNotMatch(clean, /example\.com\/x/)
  assert.ok(Buffer.byteLength(sanitizeDiagnosticBody('🙂'.repeat(10000), 100)) < 130)
})
it('redacts encoded media, credentials, all confirmation tokens and bare filesystem paths', () => {
  const encoded = Buffer.from('synthetic-media-'.repeat(30)).toString('base64')
  const raw = `正常发言\n${encoded}\nAuthorization: Bearer synthetic-credential\n`
    + 'api_key="synthetic-key" password=synthetic-password\n'
    + 'C:\\fixture\\private.json \\\\server\\private-share\\item /tmp/fixture/private.txt\n'
    + '<audio src="synthetic-audio"/><file url="synthetic-file"/><video src="synthetic-video"/>'
    + '<face id="178" name="笑脸" file="synthetic-face-file"/>'
    + ' https://user:pass@example.com/synthetic-url-secret?a=synthetic-query#synthetic-fragment'
    + ' XPACCOUNT-a XPDEL-b XPSYSDEL-c XPSYSTEM-d UCHIST-e'
  const clean = sanitizeDiagnosticBody(raw)
  assert.match(clean, /正常发言/)
  assert.match(clean, /face.*178/)
  assert.match(clean, /笑脸/)
  assert.doesNotMatch(clean, /synthetic-|private|fixture|server|user:pass|XPACCOUNT-|XPDEL-|XPSYSDEL-|XPSYSTEM-|UCHIST-/)
  assert.ok(!clean.includes(encoded))
})
it('ignores inactive write-size conflicts and disables invalid enabled diagnostics without throwing', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-config-'))
  try {
    const off = new DiagnosticLog(base, { enabled: false, fileBytes: 16384, entryBytes: 32768 })
    await off.close()
    assert.deepEqual(await readdir(base), [])
    const warnings: string[] = []
    const invalid = new DiagnosticLog(base, { enabled: true, fileBytes: 16384, entryBytes: 32768 }, text => warnings.push(text))
    assert.equal(invalid.enabled, false)
    invalid.record({ scope: 'group', body: 'not-written' }); await invalid.close()
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /已停用.*游戏/)
    assert.deepEqual(await readdir(base), [])
  } finally { await rm(base, { recursive: true, force: true }) }
})
it('cleans expired owned logs at startup while collection is disabled', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-expiry-'))
  try {
    const directory = join(base, 'data/undercover-game/logs')
    await mkdir(directory, { recursive: true })
    const expired = 'uc-debug-20000101-00000000-0000-0000-0000-000000000001.jsonl'
    const fresh = 'uc-debug-20261006-00000000-0000-0000-0000-000000000002.jsonl'
    await writeFile(join(directory, expired), 'expired'); await utimes(join(directory, expired), 0, 0)
    await writeFile(join(directory, fresh), 'fresh')
    await writeFile(join(directory, 'unrelated.jsonl'), 'unrelated'); await utimes(join(directory, 'unrelated.jsonl'), 0, 0)
    const log = new DiagnosticLog(base, { enabled: false })
    await log.flush(); await log.close()
    assert.deepEqual((await readdir(directory)).sort(), [fresh, 'unrelated.jsonl'].sort())
  } finally { await rm(base, { recursive: true, force: true }) }
})
it('expires idle logs periodically and stops cleanup after disposal', async t => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-idle-'))
  t.mock.timers.enable({ apis: ['setInterval'] })
  let log: DiagnosticLog | undefined
  try {
    const directory = join(base, 'data/undercover-game/logs')
    await mkdir(directory, { recursive: true })
    log = new DiagnosticLog(base, { enabled: false }); await log.flush()
    const file = join(directory, 'uc-debug-20000101-00000000-0000-0000-0000-000000000003.jsonl')
    await writeFile(file, 'expired'); await utimes(file, 0, 0)
    t.mock.timers.tick(3600000); await log.flush()
    assert.deepEqual(await readdir(directory), [])
    await log.close()
    await writeFile(file, 'must-remain'); await utimes(file, 0, 0)
    t.mock.timers.tick(3600000); await log.flush()
    assert.equal(await readFile(file, 'utf8'), 'must-remain')
  } finally { await log?.close(); t.mock.timers.reset(); await rm(base, { recursive: true, force: true }) }
})
it('never follows a linked log directory into external data', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-link-'))
  try {
    const parent = join(base, 'data/undercover-game'), outside = join(base, 'outside')
    await mkdir(parent, { recursive: true }); await mkdir(outside)
    const file = join(outside, 'uc-debug-20000101-00000000-0000-0000-0000-000000000004.jsonl')
    await writeFile(file, 'external'); await utimes(file, 0, 0)
    await symlink(outside, join(parent, 'logs'), 'junction')
    const warnings: string[] = [], log = new DiagnosticLog(base, {}, text => warnings.push(text))
    await log.flush(); await log.close()
    assert.equal(await readFile(file, 'utf8'), 'external')
    assert.equal(warnings.length, 1)
  } finally { await rm(base, { recursive: true, force: true }) }
})
it('keeps the game usable when enabled diagnostic size settings conflict', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-invalid-game-'))
  let game: UndercoverGameHarness | undefined
  try {
    game = await UndercoverGameHarness.create({ debug: { enabled: true, fileBytes: 16384, entryBytes: 32768 } }, { baseDir: base })
    await game.addUser('host', '主持人', 4)
    await game.sendGroup('host', '卧底')
    assert.ok(game.transcript.some(entry => entry.direction === 'out' && entry.content.includes('凑人')))
  } finally { await game?.stop(); await rm(base, { recursive: true, force: true }) }
})
it('keeps disabled logs off disk, private bodies off by default and honors guild scope', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-'))
  try {
    const off = new DiagnosticLog(base)
    off.record({ scope: 'group', body: 'not-written' }); await off.close()
    assert.deepEqual(await readdir(base), [])
    const log = new DiagnosticLog(base, { enabled: true, guilds: ['g'] })
    log.record({ scope: 'group', guildId: 'other', body: 'wrong-guild' })
    log.record({ scope: 'private', guildId: 'g', body: 'private-secret' })
    log.record({ scope: 'group', guildId: 'g', body: 'public-body' })
    await log.close()
    const rows = await entries(base)
    assert.equal(rows.length, 2)
    assert.doesNotMatch(JSON.stringify(rows), /private-secret|wrong-guild/)
    assert.ok(rows.some(r => r.body === 'public-body'))
  } finally { await rm(base, { recursive: true, force: true }) }
})
it('rotates bounded files/capacity, removes expired owned logs only and reports queue drops', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-'))
  try {
    const log = new DiagnosticLog(base, { enabled: true, fileBytes: 1024, totalBytes: 2048, entryBytes: 512, queueLimit: 2 })
    for (let i = 0; i < 100; i++) log.record({ scope: 'group', guildId: 'g', body: 'x'.repeat(350), number: i })
    await log.flush()
    log.record({ scope: 'group', guildId: 'g', body: 'after drops' }); await log.flush()
    assert.ok((await entries(base)).some(r => r.droppedBefore > 0))
    const path = join(base, 'data/undercover-game/logs')
    await writeFile(join(path, 'unrelated.jsonl'), 'unrelated')
    for (const file of (await readdir(path)).filter(f => f.startsWith('uc-debug-'))) await utimes(join(path, file), 0, 0)
    for (let i = 0; i < 20; i++) { log.record({ scope: 'group', guildId: 'g', body: 'y'.repeat(400) }); await log.flush() }
    await log.close()
    const files = (await readdir(path)).filter(f => f.startsWith('uc-debug-'))
    const sizes = await Promise.all(files.map(f => stat(join(path, f))))
    assert.ok(sizes.every(s => s.size <= 1024)); assert.ok(sizes.reduce((n,s) => n+s.size, 0) <= 2048)
    assert.equal(await readFile(join(path, 'unrelated.jsonl'), 'utf8'), 'unrelated')
  } finally { await rm(base, { recursive: true, force: true }) }
})
it('logs real handled game input/returns/direct/timer output, not unrelated downstream chat', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-game-'))
  let game: UndercoverGameHarness | undefined
  try {
    game = await UndercoverGameHarness.create({ debug: { enabled: true }, gatherTimeout: 1 }, { baseDir: base })
    await game.addUser('host', '主持人', 4); await game.addUser('alice', 'Alice')
    game.app.middleware(session => session.content === '无关闲聊' ? '其他插件回复' : undefined)
    await game.sendGroup('alice', '无关闲聊')
    await game.sendGroup('host', '卧底')
    await game.sendGroup('alice', '1')
    // App disposal starts asynchronous log close without awaiting it. Wait for
    // the exact timer delivery to be persisted before unloading the fixture;
    // a fixed sleep races the async writer on a busy dual-runtime gate.
    let rows: any[] = []
    for (let i = 0; i < 500; i++) {
      rows = await entries(base)
      if (rows.some(r => r.direction === 'out' && r.body.includes('凑人超时') && r.result === 'api-success')) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    await game.stop(); game = undefined
    const all = JSON.stringify(rows)
    assert.doesNotMatch(all, /无关闲聊|其他插件回复/)
    assert.ok(rows.some(r => r.direction === 'in' && r.body === '卧底'))
    assert.ok(rows.some(r => r.direction === 'in' && r.body === '1'))
    assert.ok(rows.some(r => r.direction === 'out' && r.body.includes('凑人超时')))
    assert.ok(rows.some(r => r.direction === 'out' && r.result === 'api-success'))
  } finally { await game?.stop(); await rm(base, { recursive: true, force: true }) }
})
it('disk failure warns without rejecting game/log callers', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-error-'))
  try {
    await writeFile(join(base, 'data'), 'file blocks directory')
    const warnings: string[] = [], log = new DiagnosticLog(base, { enabled: true }, text => warnings.push(text))
    log.record({ scope: 'group', body: 'record' }); await log.close()
    assert.equal(warnings.length, 1)
  } finally { await rm(base, { recursive: true, force: true }) }
})

it('preserves capture-only session.execute without an unsolicited plugin response', async () => {
  const base = await mkdtemp(join(tmpdir(), 'uc-debug-nested-'))
  let game: UndercoverGameHarness | undefined
  try {
    game = await UndercoverGameHarness.create({ debug: { enabled: true } }, { baseDir: base })
    await game.addUser('alice', 'Alice')
    let captured = '', extraMessages = 0
    game.app.command('外部调用').action(async ({ session }) => {
      const before = game!.transcript.filter(e => e.direction === 'out').length
      const content = await session.execute('卧底帮助', true)
      captured = content.join('')
      extraMessages = game!.transcript.filter(e => e.direction === 'out').length - before
      return '仅外部回复'
    })
    await game.sendGroup('alice', '外部调用')
    assert.ok(captured.length > 20, 'capture-only invocation must return the help body')
    assert.equal(extraMessages, 0, 'capture-only must not send the captured body')
    await game.sendGroup('alice', '卧底')
    let downstream = ''
    game.app.middleware(async (session, next) => {
      const result = await next()
      if (session.content !== '凑人进度') return result
      downstream = String(result ?? '')
      return '外层包装：' + downstream
    }, true)
    await game.sendGroup('alice', '凑人进度')
    assert.match(downstream, /当前已加入/)
    assert.match(game.transcript.filter(e => e.direction === 'out').at(-1)!.content, /外层包装：/)
    await game.sendGroup('alice', '历史对局 wrong-number')
    await game.stop(); game = undefined
    let rows: any[] = []
    for (let i = 0; i < 200; i++) {
      rows = await entries(base)
      if (rows.some(r => r.body === '历史对局 wrong-number')) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(rows.some(r => r.direction === 'in' && r.body === '历史对局 wrong-number'))
    assert.ok(rows.some(r => r.direction === 'return' && r.result === 'returned-to-caller'))
  } finally {
    await game?.stop()
    // Pure logger flush tests cover async-close; allow started filesystem work to
    // finish here before removing this disposable test directory.
    await new Promise(resolve => setTimeout(resolve, 100))
    await rm(base, { recursive: true, force: true })
  }
})

it('captures original setup input before mutation and outbound failures while private text remains optional', async () => {
  for (const privateBodies of [false, true]) {
    const base = await mkdtemp(join(tmpdir(), 'uc-debug-private-'))
    let game: UndercoverGameHarness | undefined
    try {
      game = await UndercoverGameHarness.create({ debug: { enabled: true, privateBodies }, dealMessageInterval: 0 }, { baseDir: base })
      await game.addUser('host', '主持人', 4)
      for (let i = 1; i <= 6; i++) await game.addUser('u' + i, '玩家' + i)
      await game.sendGroup('host', '卧底')
      for (let i = 1; i <= 6; i++) await game.sendGroup('u' + i, '1')
      await game.sendGroup('host', '开始'); await game.sendGroup('host', '普通局')
      await game.sendPrivate('host', '《隐 秘好人词》'); await game.sendPrivate('host', '无')
      await game.sendPrivate('host', '隐秘卧底词'); await game.sendPrivate('host', '无')
      game.failNextPrivateMessages('u1', 1)
      await game.sendPrivate('host', '5')
      await game.sendGroup('host', '停止卧底')
      await game.stop(); game = undefined
      // Cordis app.stop() starts async disposers but does not await them. Wait for
      // this exact terminal output to reach the file, not an arbitrary fixed sleep.
      let rows: any[] = []
      for (let i = 0; i < 200; i++) {
        rows = await entries(base)
        if (rows.some(r => r.direction === 'out' && r.body.includes('卧底被主持人终止'))) break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      const encoded = JSON.stringify(rows)
      assert.ok(rows.some(r => r.direction === 'out' && r.result === 'api-failed'), JSON.stringify(rows).slice(0, 6000))
      assert.ok(rows.some(r => r.direction === 'out' && r.body.includes('卧底被主持人终止') && r.gameId), JSON.stringify(rows.slice(-8)))
      if (privateBodies) assert.ok(rows.some(r => r.direction === 'in' && r.body === '《隐 秘好人词》'))
      else assert.doesNotMatch(encoded, /隐秘卧底词|隐 秘好人词/)
    } finally { await game?.stop(); await rm(base, { recursive: true, force: true }) }
  }
})
