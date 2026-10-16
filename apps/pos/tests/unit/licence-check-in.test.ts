import type { LicencePayload, LicenceStatus } from '@kiln/licence'
import {
  generateLicenceKeyPair,
  signLicence,
  signLicenceStatus,
  type LicenceKeyPair,
} from '@kiln/licence/sign'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CHECK_IN_GRACE_MS,
  callLicenceServer,
  decideCheckIn,
  type CheckInOutcome,
} from '@/lib/licence-check-in'

/** BR-32: daily online check-in with the builder, and the grace period when it is unreachable. */

const licence: LicencePayload = {
  version: 1,
  licenceId: 'lic_test',
  clientId: 'cl_01',
  allowedHosts: ['pos.acmemart.example'],
  modules: ['inventory'],
  maxRegisters: 2,
  issuedAt: '2027-01-01T00:00:00.000Z',
  expiresAt: '2028-01-01T00:00:00.000Z',
}
const now = new Date('2027-03-01T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000

let keys: LicenceKeyPair
let other: LicenceKeyPair

beforeAll(() => {
  keys = generateLicenceKeyPair()
  other = generateLicenceKeyPair()
})

const status = (overrides: Partial<LicenceStatus> = {}, key = () => keys.privateKeyPem) =>
  signLicenceStatus(
    {
      type: 'licence-status',
      version: 1,
      licenceId: 'lic_test',
      status: 'active',
      checkedAt: now.toISOString(),
      ...overrides,
    },
    key(),
  )

const decide = (outcome: CheckInOutcome, storedStatusText: string | null = null, at = now) =>
  decideCheckIn({ licence, outcome, storedStatusText, publicKeyPem: keys.publicKeyPem, now: at })

const unreachable: CheckInOutcome = { kind: 'unreachable', message: 'licence server not reachable' }

describe('decideCheckIn with an answer', () => {
  it('confirms an active licence and keeps the signed answer', () => {
    const answer = status()
    expect(decide({ kind: 'answered', status: answer })).toEqual({
      kind: 'confirmed',
      statusText: JSON.stringify(answer),
    })
  })

  it('stops on revocation and keeps the signed answer', () => {
    expect(decide({ kind: 'answered', status: status({ status: 'revoked' }) })).toMatchObject({
      kind: 'revoked',
    })
  })

  it('installs the newer licence when superseded', () => {
    const newer = signLicence({ ...licence, licenceId: 'lic_new' }, keys.privateKeyPem)
    expect(
      decide({ kind: 'answered', status: status({ status: 'superseded', licence: newer }) }),
    ).toEqual({ kind: 'renewed', licence: newer })
  })

  it('treats a forged, stale or mismatched answer like no answer', () => {
    const lastConfirmed = JSON.stringify(
      status({ checkedAt: new Date(now.getTime() - 2 * DAY).toISOString() }),
    )
    for (const forged of [
      status({}, () => other.privateKeyPem),
      status({ checkedAt: new Date(now.getTime() - DAY).toISOString() }),
      status({ licenceId: 'lic_other' }),
    ]) {
      const verdict = decide({ kind: 'answered', status: forged }, lastConfirmed)
      expect(verdict).toMatchObject({ kind: 'grace' })
      if (verdict.kind === 'grace') expect(verdict.message).toMatch(/answer was rejected/)
    }
  })
})

describe('decideCheckIn without an answer (grace period)', () => {
  it('counts the grace period from the last stored confirmation', () => {
    const stored = JSON.stringify(status({ checkedAt: '2027-02-27T00:00:00.000Z' }))
    expect(decide(unreachable, stored)).toEqual({
      kind: 'grace',
      lastConfirmedAt: '2027-02-27T00:00:00.000Z',
      lockAt: new Date(Date.parse('2027-02-27T00:00:00.000Z') + CHECK_IN_GRACE_MS).toISOString(),
      message: 'licence server not reachable',
    })
    expect(decide(unreachable, stored, new Date('2027-03-07T00:00:01Z'))).toMatchObject({
      kind: 'overdue',
      lastConfirmedAt: '2027-02-27T00:00:00.000Z',
    })
  })

  it('counts from the issue date when never confirmed', () => {
    expect(decide(unreachable, null, new Date('2027-01-05T00:00:00Z'))).toMatchObject({
      kind: 'grace',
      lastConfirmedAt: licence.issuedAt,
    })
    expect(decide(unreachable)).toMatchObject({ kind: 'overdue' })
  })

  it('ignores stored answers that are not signed by the builder or not for this licence', () => {
    for (const stored of [
      'not json',
      JSON.stringify(status({ checkedAt: '2027-02-27T00:00:00.000Z' }, () => other.privateKeyPem)),
      JSON.stringify(status({ licenceId: 'lic_other', checkedAt: '2027-02-27T00:00:00.000Z' })),
    ]) {
      expect(decide(unreachable, stored)).toMatchObject({ kind: 'overdue' })
    }
  })

  it('stays locked after a stored revocation, however old', () => {
    const stored = JSON.stringify(
      status({ status: 'revoked', checkedAt: '2027-01-02T00:00:00.000Z' }),
    )
    expect(decide(unreachable, stored, new Date('2027-12-01T00:00:00Z'))).toEqual({
      kind: 'revoked',
      statusText: stored,
    })
  })
})

describe('callLicenceServer', () => {
  const fileText = JSON.stringify(
    signLicence(licence, keys?.privateKeyPem ?? generateLicenceKeyPair().privateKeyPem),
  )

  it('posts the licence and host and returns the signed answer', async () => {
    let request: { url: string; body: unknown } | undefined
    const fake = (async (url: URL, init: RequestInit) => {
      request = { url: url.toString(), body: JSON.parse(String(init.body)) }
      return Response.json({ status: { signed: true } })
    }) as unknown as typeof fetch
    expect(
      await callLicenceServer('https://builder.example/', fileText, 'pos.acmemart.example', fake),
    ).toEqual({
      kind: 'answered',
      status: { signed: true },
    })
    expect(request).toEqual({
      url: 'https://builder.example/api/licence-check',
      body: { licence: JSON.parse(fileText), host: 'pos.acmemart.example' },
    })
  })

  it('reports HTTP errors and network failures as unreachable', async () => {
    const notFound = (async () =>
      Response.json(
        { error: { message: 'This licence was not issued here' } },
        { status: 404 },
      )) as unknown as typeof fetch
    expect(await callLicenceServer('https://builder.example', fileText, 'h', notFound)).toEqual({
      kind: 'unreachable',
      message: 'licence server answered 404: This licence was not issued here',
    })
    const down = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await callLicenceServer('https://builder.example', fileText, 'h', down)).toEqual({
      kind: 'unreachable',
      message: 'licence server not reachable: ECONNREFUSED',
    })
  })
})
