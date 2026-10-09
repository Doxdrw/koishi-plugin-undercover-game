import assert from 'node:assert/strict'

// Ignore presentation only. This baseline was captured before the UI refactor.
export function semanticSchema(schema: any): any {
  if (schema.type === 'intersect') {
    const dict: Record<string, any> = {}
    for (const part of schema.list) {
      const shape = semanticSchema(part)
      assert.equal(shape.type, 'object')
      for (const [key, field] of Object.entries(shape.dict)) {
        assert.ok(!(key in dict), 'duplicate configuration key: ' + key)
        dict[key] = field
      }
    }
    return { type: 'object', dict: sorted(dict) }
  }
  const result: Record<string, any> = { type: schema.type }
  const meta = Object.fromEntries(Object.entries(schema.meta ?? {})
    .filter(([key, value]) => value !== undefined && !['description', 'collapse', 'role', 'badges'].includes(key))
    // Objects implicitly default to {}; a flattened intersection of objects is
    // equivalent. Explicit nonempty defaults and primitive/dict defaults stay.
    .filter(([key, value]) => !(schema.type === 'object' && key === 'default'
      && value && typeof value === 'object' && !Object.keys(value).length)))
  if (Object.keys(meta).length) result.meta = sorted(meta)
  if (schema.dict) result.dict = sorted(Object.fromEntries(
    Object.entries(schema.dict).map(([key, value]) => [key, semanticSchema(value)])))
  if (schema.list) result.list = schema.list.map(semanticSchema)
  if (schema.inner) result.inner = semanticSchema(schema.inner)
  if (schema.sKey) result.sKey = semanticSchema(schema.sKey)
  if ('value' in schema) result.value = schema.value
  return result
}

function sorted(value: Record<string, any>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
}

export function fields(schema: any): Record<string, any> {
  if (schema.type === 'object') return schema.dict
  return Object.assign({}, ...schema.list.map(fields))
}

export function assertGroups(schema: any, expected: string[]) {
  assert.equal(schema.type, 'intersect')
  assert.deepEqual(schema.list.map((group: any) => group.meta.description), expected)
  const names = schema.list.flatMap((group: any) => Object.keys(group.dict))
  assert.equal(new Set(names).size, names.length, 'each field belongs to one group')
  for (const title of expected) {
    assert.ok(title.length <= 20)
    assert.doesNotMatch(title, /[。；：]/)
  }
}
