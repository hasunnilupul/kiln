import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { diffClientConfigs, type ClientConfigInput } from './index.js'

/** BR-13: diff between config versions. */

function config(): ClientConfigInput {
  const file = join(import.meta.dirname, '..', 'examples', 'acme-mart.client.config.json')
  return JSON.parse(readFileSync(file, 'utf8')) as ClientConfigInput
}

describe('diffClientConfigs', () => {
  it('finds nothing between equal configs', () => {
    expect(diffClientConfigs(config(), config())).toEqual([])
  })

  it('reports changed, added and removed fields by path', () => {
    const before = config()
    const after = config()
    after.client.displayName = 'Acme Mart Express'
    after.client.phone = '+1 555 0100'
    delete after.branding.receiptFooter
    expect(diffClientConfigs(before, after)).toEqual([
      { path: 'client.displayName', kind: 'changed', from: 'Acme Mart', to: 'Acme Mart Express' },
      { path: 'client.phone', kind: 'added', to: '+1 555 0100' },
      { path: 'branding.receiptFooter', kind: 'removed', from: 'Thank you!' },
    ])
  })

  it('matches coded list items by code, not position', () => {
    const before = config()
    before.outlets.unshift({
      code: 'NORTH',
      name: 'North',
      registers: [{ code: 'N1', name: 'Till' }],
    })
    const after = config()
    after.outlets[0]!.registers.push({ code: 'R2', name: 'Till 2' })
    expect(diffClientConfigs(before, after)).toEqual([
      {
        path: 'outlets[NORTH]',
        kind: 'removed',
        from: { code: 'NORTH', name: 'North', registers: [{ code: 'N1', name: 'Till' }] },
      },
      { path: 'outlets[MAIN].registers[R2]', kind: 'added', to: { code: 'R2', name: 'Till 2' } },
    ])
  })

  it('falls back to positions for lists without unique codes', () => {
    expect(diffClientConfigs({ list: [1, 2] }, { list: [1, 3, 4] })).toEqual([
      { path: 'list[1]', kind: 'changed', from: 2, to: 3 },
      { path: 'list[2]', kind: 'added', to: 4 },
    ])
    expect(
      diffClientConfigs(
        { list: [{ code: 'A' }, { code: 'A' }] },
        { list: [{ code: 'A' }, { code: 'B' }] },
      ),
    ).toEqual([{ path: 'list[1].code', kind: 'changed', from: 'A', to: 'B' }])
  })

  it('treats a type change as one change', () => {
    expect(diffClientConfigs({ a: { b: 1 } }, { a: [1] })).toEqual([
      { path: 'a', kind: 'changed', from: { b: 1 }, to: [1] },
    ])
    expect(diffClientConfigs(undefined, { a: 1 })).toEqual([
      { path: '', kind: 'added', to: { a: 1 } },
    ])
  })
})
