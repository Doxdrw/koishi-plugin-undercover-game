function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(detail) {
  throw new Error('Invalid npm pack result: ' + detail)
}

// npm 10/11 return an array; npm 12 returns a map keyed by package name.
export function parseNpmPackResult(stdout, expected) {
  let output
  try {
    output = JSON.parse(stdout)
  } catch {
    invalid('expected JSON metadata.')
  }
  let result
  if (Array.isArray(output) && output.length === 1) {
    result = output[0]
  } else if (isRecord(output) && Object.keys(output).length === 1
    && Object.hasOwn(output, expected.name)) {
    result = output[expected.name]
  } else {
    invalid('expected exactly one package record.')
  }
  if (!isRecord(result) || result.name !== expected.name || result.version !== expected.version) {
    invalid('package name or version does not match package.json.')
  }
  if (typeof result.filename !== 'string' || !/^[^/\\:\0]+\.tgz$/.test(result.filename)) {
    invalid('expected a local .tgz filename.')
  }
  if (!Array.isArray(result.files) || result.files.length === 0
    || !Number.isSafeInteger(result.entryCount) || result.entryCount !== result.files.length
    || !Number.isSafeInteger(result.size) || result.size < 0) {
    invalid('missing or inconsistent file count or archive size.')
  }
  for (const file of result.files) {
    if (!isRecord(file) || typeof file.path !== 'string'
      || /^(?:[/\\]|[A-Za-z]:)/.test(file.path)
      || file.path.includes('\0')
      || file.path.split(/[/\\]/).some(part => !part || part === '.' || part === '..')) {
      invalid('expected package-relative file paths.')
    }
  }
  return result
}
