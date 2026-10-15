import { PasswordChangeBanner as PasswordChangeBanner_e35b7a75ed0f89b6c87b1858dcb2729c } from '../../../components/PasswordChangeNotice'
import { RedirectToAccount as RedirectToAccount_e35b7a75ed0f89b6c87b1858dcb2729c } from '../../../components/PasswordChangeNotice'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { S3ClientUploadHandler as S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24 } from '@payloadcms/storage-s3/client'
import { VercelBlobClientUploadHandler as VercelBlobClientUploadHandler_16c82c5e25f430251a3e3ba57219ff4e } from '@payloadcms/storage-vercel-blob/client'

/** @type import('payload').ImportMap */
export const importMap = {
  '/components/PasswordChangeNotice#PasswordChangeBanner':
    PasswordChangeBanner_e35b7a75ed0f89b6c87b1858dcb2729c,
  '/components/PasswordChangeNotice#RedirectToAccount':
    RedirectToAccount_e35b7a75ed0f89b6c87b1858dcb2729c,
  '@payloadcms/next/rsc#CollectionCards': CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  '@payloadcms/storage-s3/client#S3ClientUploadHandler':
    S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24,
  '@payloadcms/storage-vercel-blob/client#VercelBlobClientUploadHandler':
    VercelBlobClientUploadHandler_16c82c5e25f430251a3e3ba57219ff4e,
}
