/** A path into a JSON draft, e.g. `['outlets', 0, 'registers', 1, 'code']`. */
export type DraftPath = readonly (string | number)[]

type Json = Record<string, unknown> | unknown[]

/** The value at `path`, or undefined when any step is missing. */
export function getAt(root: unknown, path: DraftPath): unknown {
  let current: unknown = root
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

/**
 * A copy of `root` with `value` at `path`, sharing untouched branches. Missing steps become
 * objects (or arrays for numeric keys). `undefined` removes an object key.
 */
export function setAt<T>(root: T, path: DraftPath, value: unknown): T {
  if (path.length === 0) return value as T
  const [key, ...rest] = path
  const container: Json =
    typeof root === 'object' && root !== null
      ? Array.isArray(root)
        ? [...root]
        : { ...(root as Record<string, unknown>) }
      : typeof key === 'number'
        ? []
        : {}
  const next = setAt((container as Record<string | number, unknown>)[key!], rest, value)
  if (next === undefined && !Array.isArray(container)) {
    delete (container as Record<string, unknown>)[key as string]
  } else {
    ;(container as Record<string | number, unknown>)[key!] = next
  }
  return container as T
}

/** `path` as the dotted string used to match validation issues, e.g. `outlets.0.code`. */
export function pathKey(path: DraftPath): string {
  return path.join('.')
}
