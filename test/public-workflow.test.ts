import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { it } from 'node:test'
import { loadReleaseConfig, publicFiles } from '../scripts/public-release.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path: string) => readFileSync(join(root, path), 'utf8')

it('exports a dependency lock matching the public package', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))
  assert.equal(lock.lockfileVersion, 3)
  assert.equal(lock.name, pkg.name)
  assert.equal(lock.version, pkg.version)
  for (const field of ['devDependencies', 'peerDependencies', 'engines']) {
    assert.deepEqual(lock.packages[''][field], pkg[field], field)
  }
  assert.ok(publicFiles(root, loadReleaseConfig(root)).includes('package-lock.json'))
  assert.doesNotMatch(read('package-lock.json'), /"resolved":\s*"(?:file:|[A-Z]:|https?:\/\/(?:localhost|127\.0\.0\.1))/)
})

it('keeps CI locked and npm publishing separate from push, PR and GitHub Release', () => {
  const ci = read('.github/workflows/ci.yml')
  const publish = read('.github/workflows/publish.yml')
  assert.match(ci, /node: \[20, 22, 24\]/)
  assert.match(ci, /if: matrix\.node == 24\s*\n\s*run: npm install --global npm@12\.2\.0/)
  assert.match(ci, /if: matrix\.node != 20\s*\n\s*run: npm run package:audit/)
  assert.match(publish, /npm install --global npm@12\.2\.0/)
  assert.match(ci, /run: npm ci/)
  assert.doesNotMatch(ci, /npm publish|id-token: write/)
  assert.match(publish, /^on:\s*\n  workflow_dispatch:/m)
  assert.doesNotMatch(publish, /^  (?:push|pull_request|release):/m)
  assert.match(publish, /environment: npm/)
  assert.match(publish, /ref: refs\/tags\/\$\{\{ inputs\.tag \}\}/)
  assert.match(publish, /fetch-depth: 0/)
  assert.match(publish, /tag !== 'v' \+ pkg\.version/)
  assert.match(publish, /merge-base', '--is-ancestor', 'HEAD', 'origin\/main'/)
  assert.match(publish, /id-token: write/)
  assert.match(publish, /run: npm ci/)
  assert.doesNotMatch(publish, /NODE_AUTH_TOKEN|secrets\.NPM_/)
  for (const command of ['npm run typecheck', 'npm test', 'npm run build', 'npm run public:check', 'npm run package:audit']) {
    assert.ok(publish.includes(command), command)
  }
})

it('uploads npm candidates to staging and leaves publication to maintainer approval', () => {
  const publish = read('.github/workflows/publish.yml')
  assert.match(publish, /npm 11\.15\.0/)
  assert.match(publish, /run: npm stage publish --access public --tag latest --registry=https:\/\/registry\.npmjs\.org/)
  assert.doesNotMatch(publish, /^\s*(?:run:\s*)?npm publish(?:\s|$)/m)
})
