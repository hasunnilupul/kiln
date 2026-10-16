import { describe, expect, it } from 'vitest'

import { changedFields } from '@/hooks/audit'

describe('changedFields (BR-04)', () => {
  it('lists changed top-level fields with before and after', () => {
    expect(changedFields({ name: 'A', email: 'a@x' }, { name: 'B', email: 'a@x' })).toEqual({
      name: { from: 'A', to: 'B' },
    })
  })

  it('treats a missing side as null, for creates and deletes', () => {
    expect(changedFields(undefined, { name: 'A' })).toEqual({ name: { from: null, to: 'A' } })
    expect(changedFields({ name: 'A' }, undefined)).toEqual({ name: { from: 'A', to: null } })
  })

  it('never records secrets or timestamps', () => {
    expect(
      changedFields(
        { hash: 'x', totpSecret: 'old', totpLastStep: 1, updatedAt: '1' },
        { hash: 'y', totpSecret: 'new', totpLastStep: 2, updatedAt: '2', password: 'p' },
      ),
    ).toEqual({})
  })
})
