import { randomBytes } from 'node:crypto'

import type { CollectionConfig } from 'payload'

import { isOwner, nobody } from '../access/owner'
import { saveConfig } from '../endpoints/configs'
import { auditCollectionChange } from '../hooks/audit'

/** A stable id for configs and licences, e.g. `cl_7k2m9q4x8w1p`; never reused or changed. */
export function newClientId(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  return `cl_${Array.from(randomBytes(12), (byte) => alphabet[byte % alphabet.length]).join('')}`
}

/**
 * Client records (BR-10). Archived, never deleted: builds and licences keep pointing at them.
 * Their configuration lives in `client-configs`, edited with the setup wizard tab.
 */
export const Clients: CollectionConfig = {
  slug: 'clients',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'status', 'contactName', 'updatedAt'],
    components: {
      views: {
        edit: {
          setup: {
            Component: '/components/ClientSetup#ClientSetupView',
            path: '/setup',
            tab: { label: 'Setup wizard', href: '/setup', order: 100 },
          },
          configs: {
            Component: '/components/ConfigVersions#ConfigVersionsView',
            path: '/configs',
            tab: { label: 'Config versions', href: '/configs', order: 200 },
          },
        },
      },
    },
  },
  defaultSort: 'name',
  endpoints: [saveConfig],
  access: {
    read: isOwner,
    create: isOwner,
    update: isOwner,
    delete: nobody,
  },
  hooks: {
    afterChange: [auditCollectionChange],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: (value: unknown) =>
        (typeof value === 'string' &&
          value.length <= 48 &&
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) ||
        'Use lower-case words separated by "-", e.g. acme-mart',
      admin: { description: 'Used in build file names, e.g. acme-mart-pos-v1.0.0-c3.zip.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Archived clients keep their history but get no new configs or builds.',
      },
    },
    {
      name: 'clientId',
      type: 'text',
      unique: true,
      index: true,
      // Set on create and never changed, whatever the request sends.
      hooks: {
        beforeChange: [
          ({ operation, originalDoc }) =>
            operation === 'create' ? newClientId() : originalDoc?.clientId,
        ],
      },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Stable id written into the config and licence.',
      },
    },
    {
      type: 'row',
      fields: [
        { name: 'contactName', type: 'text' },
        { name: 'contactEmail', type: 'email' },
        { name: 'contactPhone', type: 'text' },
      ],
    },
    { name: 'notes', type: 'textarea' },
  ],
}
