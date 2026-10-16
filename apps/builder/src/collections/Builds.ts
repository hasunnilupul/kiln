import type { CollectionConfig } from 'payload'

import { isOwner, nobody } from '../access/owner'
import { buildCallback, buildJob } from '../endpoints/builds'

export const BUILD_STATUSES = ['queued', 'building', 'succeeded', 'failed'] as const
export type BuildStatus = (typeof BUILD_STATUSES)[number]

/**
 * Client build jobs (BR-20 to BR-22, BR-24). Created by the builder when an owner clicks Build,
 * then moved through `queued → building → succeeded | failed` only by the workflow's signed
 * callbacks. A finished build is never changed again.
 */
export const Builds: CollectionConfig = {
  slug: 'builds',
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['label', 'client', 'status', 'templateVersion', 'configNumber', 'createdAt'],
    hidden: true,
  },
  defaultSort: '-createdAt',
  access: {
    read: isOwner,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  endpoints: [buildJob, buildCallback],
  fields: [
    { name: 'client', type: 'relationship', relationTo: 'clients', required: true, index: true },
    { name: 'label', type: 'text' },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      options: BUILD_STATUSES.map((status) => ({ value: status, label: status })),
    },
    { name: 'configVersion', type: 'relationship', relationTo: 'client-configs', required: true },
    { name: 'configNumber', type: 'number', required: true },
    { name: 'templateVersion', type: 'text', required: true },
    // The shipped licence, by its unique `lic_…` id.
    { name: 'licenceId', type: 'text', required: true },
    { name: 'requestedBy', type: 'relationship', relationTo: 'users' },
    { name: 'rebuildOf', type: 'relationship', relationTo: 'builds' },
    { name: 'runUrl', type: 'text', admin: { description: 'GitHub Actions run, with the logs.' } },
    { name: 'startedAt', type: 'date' },
    { name: 'finishedAt', type: 'date' },
    { name: 'error', type: 'text' },
    // Recorded on success (BR-22).
    { name: 'zipKey', type: 'text' },
    { name: 'zipName', type: 'text' },
    { name: 'size', type: 'number' },
    { name: 'sha256', type: 'text' },
    { name: 'commit', type: 'text' },
  ],
}
