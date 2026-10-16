/** One difference between two configs, at a readable path such as `outlets[MAIN].registers[R1].name`. */
export interface ConfigChange {
  path: string
  kind: 'added' | 'removed' | 'changed'
  from?: unknown
  to?: unknown
}

type Plain = Record<string, unknown>

function isPlainObject(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True when every item is an object with a unique string `code`, e.g. tax rates and outlets. */
function isKeyedByCode(items: unknown[]): items is (Plain & { code: string })[] {
  const codes = items.map((item) => (isPlainObject(item) ? item.code : undefined))
  return codes.every((code) => typeof code === 'string') && new Set(codes).size === codes.length
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

function walk(path: string, from: unknown, to: unknown, changes: ConfigChange[]): void {
  if (from === undefined && to === undefined) return
  if (from === undefined) {
    changes.push({ path, kind: 'added', to })
    return
  }
  if (to === undefined) {
    changes.push({ path, kind: 'removed', from })
    return
  }

  if (isPlainObject(from) && isPlainObject(to)) {
    const keys = new Set([...Object.keys(from), ...Object.keys(to)])
    for (const key of keys) walk(join(path, key), from[key], to[key], changes)
    return
  }

  if (Array.isArray(from) && Array.isArray(to)) {
    // Lists of coded items are compared by code, so removing the first outlet shows as one
    // removal rather than every later outlet "changing".
    if (isKeyedByCode(from) && isKeyedByCode(to)) {
      const before = new Map(from.map((item) => [item.code, item]))
      const after = new Map(to.map((item) => [item.code, item]))
      const codes = new Set([...before.keys(), ...after.keys()])
      for (const code of codes) walk(`${path}[${code}]`, before.get(code), after.get(code), changes)
      return
    }
    const length = Math.max(from.length, to.length)
    for (let i = 0; i < length; i += 1) walk(`${path}[${i}]`, from[i], to[i], changes)
    return
  }

  if (!Object.is(from, to)) changes.push({ path, kind: 'changed', from, to })
}

/**
 * Every difference between two client configs (BR-13), in document order. Accepts any JSON
 * values, so it also compares drafts that do not validate yet.
 */
export function diffClientConfigs(from: unknown, to: unknown): ConfigChange[] {
  const changes: ConfigChange[] = []
  walk('', from, to, changes)
  return changes
}
