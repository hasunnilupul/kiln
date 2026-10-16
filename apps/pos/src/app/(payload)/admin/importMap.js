import { LicenceBanner as LicenceBanner_448c5b500b4834ce021a4eb7b7b6b187 } from '../../../components/LicenceNotice'
import { PasswordChangeBanner as PasswordChangeBanner_e35b7a75ed0f89b6c87b1858dcb2729c } from '../../../components/PasswordChangeNotice'
import { ReportsLink as ReportsLink_f8984b4d1363c07e85fd5219d3d54c6d } from '../../../components/ReportsLink'
import { RedirectToAccount as RedirectToAccount_e35b7a75ed0f89b6c87b1858dcb2729c } from '../../../components/PasswordChangeNotice'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { S3ClientUploadHandler as S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24 } from '@payloadcms/storage-s3/client'
import { VercelBlobClientUploadHandler as VercelBlobClientUploadHandler_16c82c5e25f430251a3e3ba57219ff4e } from '@payloadcms/storage-vercel-blob/client'

/** @type import('payload').ImportMap */
export const importMap = {
  '/components/LicenceNotice#LicenceBanner': LicenceBanner_448c5b500b4834ce021a4eb7b7b6b187,
  '/components/PasswordChangeNotice#PasswordChangeBanner':
    PasswordChangeBanner_e35b7a75ed0f89b6c87b1858dcb2729c,
  '/components/ReportsLink#ReportsLink': ReportsLink_f8984b4d1363c07e85fd5219d3d54c6d,
  '/components/PasswordChangeNotice#RedirectToAccount':
    RedirectToAccount_e35b7a75ed0f89b6c87b1858dcb2729c,
  '@payloadcms/next/rsc#CollectionCards': CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  '@payloadcms/storage-s3/client#S3ClientUploadHandler':
    S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24,
  '@payloadcms/storage-vercel-blob/client#VercelBlobClientUploadHandler':
    VercelBlobClientUploadHandler_16c82c5e25f430251a3e3ba57219ff4e,
}
