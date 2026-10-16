import { MODULE_NAMES } from '@kiln/client-config'
import type { CollectionConfig } from 'payload'

import { isOwner, nobody } from '../access/owner'
import { downloadLicence, revokeLicence } from '../endpoints/licences'
import { LICENCE_TERMS, LICENCE_TERM_IDS } from '../lib/licence-terms'

/**
 * Issued licences (BR-30 to BR-32). Never edited: renewing issues a new licence that supersedes
 * the old one, and revoking stamps `revokedAt`. Only the builder's endpoints write here; POS
 * check-ins record when each licence was last seen.
 */
export const Licences: CollectionConfig = {
  slug: 'licences',
  admin: {
    useAsTitle: 'licenceId',
    defaultColumns: ['licenceId', 'client', 'term', 'expiresAt', 'revokedAt', 'lastCheckInAt'],
    hidden: true,
  },
  defaultSort: '-issuedAt',
  access: {
    read: isOwner,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  endpoints: [revokeLicence, downloadLicence],
  fields: [
    { name: 'client', type: 'relationship', relationTo: 'clients', required: true, index: true },
    { name: 'licenceId', type: 'text', required: true, unique: true, index: true },
    {
      name: 'term',
      type: 'select',
      required: true,
      options: LICENCE_TERM_IDS.map((id) => ({ value: id, label: LICENCE_TERMS[id].label })),
    },
    { name: 'allowedHosts', type: 'text', hasMany: true, required: true },
    {
      name: 'modules',
      type: 'select',
      hasMany: true,
      options: MODULE_NAMES.map((name) => ({ value: name, label: name })),
    },
    { name: 'maxRegisters', type: 'number', required: true, min: 1 },
    { name: 'issuedAt', type: 'date', required: true },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'issuedBy', type: 'relationship', relationTo: 'users' },
    {
      // The signed licence.json content; what builds ship and check-ins return.
      name: 'file',
      type: 'json',
      required: true,
    },
    { name: 'supersededBy', type: 'relationship', relationTo: 'licences', index: true },
    { name: 'revokedAt', type: 'date' },
    { name: 'revokedReason', type: 'text' },
    { name: 'revokedBy', type: 'relationship', relationTo: 'users' },
    { name: 'lastCheckInAt', type: 'date' },
    { name: 'lastCheckInHost', type: 'text' },
  ],
}
