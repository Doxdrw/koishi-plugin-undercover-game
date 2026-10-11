import assert from 'node:assert/strict'
import { it } from 'node:test'
import { parseNpmPackResult } from '../scripts/npm-pack-result.mjs'

const expected = { name: 'koishi-plugin-example', version: '1.2.3' }
const metadata = {
  ...expected,
  filename: 'koishi-plugin-example-1.2.3.tgz',
  files: [{ path: 'package.json' }, { path: 'lib\\index.js' }],
  entryCount: 2,
  size: 1234,
}

it('reads npm 10/11 arrays and npm 12 package-name maps without dropping file metadata', () => {
  for (const output of [[metadata], { [expected.name]: metadata }]) {
    assert.deepEqual(parseNpmPackResult(JSON.stringify(output), expected), metadata)
  }
})

it('refuses empty, invalid and npm error output without echoing its body', () => {
  for (const output of ['', '{', 'null', '[]', '{}', '{"error":{"summary":"private-output"}}']) {
    assert.throws(() => parseNpmPackResult(output, expected), error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /npm pack/)
      assert.doesNotMatch(error.message, /private-output/)
      return true
    })
  }
})

it('refuses multiple package records instead of auditing only the first', () => {
  const other = { ...metadata, name: 'other-package' }
  for (const output of [[metadata, other], { [expected.name]: metadata, other }]) {
    assert.throws(() => parseNpmPackResult(JSON.stringify(output), expected), /npm pack/)
  }
})

it('checks the package name and version in both output formats', () => {
  for (const changed of [{ ...metadata, name: 'other' }, { ...metadata, version: '9.9.9' }]) {
    for (const output of [[changed], { [expected.name]: changed }]) {
      assert.throws(() => parseNpmPackResult(JSON.stringify(output), expected), /npm pack/)
    }
  }
  assert.throws(() => parseNpmPackResult(JSON.stringify({ other: metadata }), expected), /npm pack/)
})

it('requires complete, internally consistent file and size metadata', () => {
  for (const changed of [
    { ...metadata, files: null },
    { ...metadata, files: [] },
    { ...metadata, files: [{ path: '' }], entryCount: 1 },
    { ...metadata, files: [{}], entryCount: 1 },
    { ...metadata, entryCount: 3 },
    { ...metadata, entryCount: 1.5 },
    { ...metadata, size: -1 },
    { ...metadata, size: null },
  ]) {
    assert.throws(() => parseNpmPackResult(JSON.stringify([changed]), expected), /npm pack/)
  }
})

it('keeps archive cleanup and file audit paths within the package directory', () => {
  for (const filename of ['../other.tgz', '..\\other.tgz', '/other.tgz', 'C:other.tgz', 'other.zip', '']) {
    assert.throws(() => parseNpmPackResult(JSON.stringify([{ ...metadata, filename }]), expected), /npm pack/)
  }
  for (const path of ['../secret', 'lib/../../secret', '/secret', 'C:\\secret', 'lib//index.js', 'lib/./index.js']) {
    const changed = { ...metadata, files: [{ path }], entryCount: 1 }
    assert.throws(() => parseNpmPackResult(JSON.stringify([changed]), expected), /npm pack/)
  }
})
