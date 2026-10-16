import { describe, expect, it } from 'vitest'

import { getAt, pathKey, setAt } from '@/lib/draft-path'

describe('getAt', () => {
  it('reads nested objects and arrays, and is undefined past a missing step', () => {
    const draft = { outlets: [{ code: 'MAIN', registers: [{ code: 'R1' }] }] }
    expect(getAt(draft, ['outlets', 0, 'registers', 0, 'code'])).toBe('R1')
    expect(getAt(draft, ['outlets', 3, 'code'])).toBeUndefined()
    expect(getAt(null, ['a'])).toBeUndefined()
  })
})

describe('setAt', () => {
  it('copies along the path and shares the rest', () => {
    const draft = { client: { name: 'A' }, outlets: [{ code: 'MAIN' }, { code: 'B' }] }
    const next = setAt(draft, ['outlets', 1, 'code'], 'NORTH')
    expect(next.outlets[1]!.code).toBe('NORTH')
    expect(draft.outlets[1]!.code).toBe('B')
    expect(next.client).toBe(draft.client)
    expect(next.outlets[0]).toBe(draft.outlets[0])
  })

  it('creates missing objects and arrays, and removes keys set to undefined', () => {
    expect(setAt({}, ['a', 0, 'b'], 1)).toEqual({ a: [{ b: 1 }] })
    expect(setAt({ a: 1, b: 2 }, ['a'], undefined)).toEqual({ b: 2 })
  })

  it('formats paths like validation issues', () => {
    expect(pathKey(['outlets', 0, 'code'])).toBe('outlets.0.code')
  })
})
