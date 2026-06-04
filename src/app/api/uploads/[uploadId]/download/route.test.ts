import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_INTERNAL_USER_ID,
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_WORKSPACE_ID,
  getAuditLogStore,
  getDownloadTokenSecret,
} from '@/lib/audit/upload-runtime'
import { createUploadDownloadToken, createUploadRecord, JsonUploadStore, LocalUploadStorage } from '@/lib/audit/uploads'
import { createSessionToken, findInvitedUserByEmail, SESSION_COOKIE_NAME } from '@/lib/auth/access'

import { GET } from './route'

const ORIGINAL_ENV = {
  AUDIT_DOWNLOAD_TOKEN_SECRET: process.env.AUDIT_DOWNLOAD_TOKEN_SECRET,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_UPLOAD_STORAGE_ROOT: process.env.AUDIT_UPLOAD_STORAGE_ROOT,
}

describe('upload download route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-download-route-'))
    process.env.AUDIT_DOWNLOAD_TOKEN_SECRET = 'route-test-download-secret'
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_SESSION_SECRET = 'route-test-session-secret'
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_UPLOAD_STORAGE_ROOT = join(tempDir, 'files')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('returns uploaded bytes for a matching signed token and audits the download', async () => {
    const storage = new LocalUploadStorage(process.env.AUDIT_UPLOAD_STORAGE_ROOT!)
    const saved = await storage.save({
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      bytes: Buffer.from('%PDF-1.7 pricing terms'),
      contentType: 'application/pdf',
    })
    const upload = createUploadRecord({
      organizationId: DEFAULT_ORGANIZATION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      byteSize: saved.byteSize,
      contentType: saved.contentType,
      storageKey: saved.storageKey,
      checksum: saved.checksum,
      uploadedBy: 'user_customer',
    })
    await new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).save(upload)

    const response = await GET(downloadRequest(upload.id, signedToken(upload.id), sessionCookie('internal@usageintegrity.local')), {
      params: Promise.resolve({ uploadId: upload.id }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="pricing.pdf"')
    expect(Buffer.from(await response.arrayBuffer()).toString('utf8')).toBe('%PDF-1.7 pricing terms')

    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toMatchObject([
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        actorId: DEFAULT_INTERNAL_USER_ID,
        action: 'file_downloaded',
        targetType: 'upload',
        targetId: upload.id,
        metadata: {
          filename: 'pricing.pdf',
          category: 'pricing_docs',
          byteSize: saved.byteSize,
        },
      },
    ])
  })

  it('returns uploaded bytes for a signed token scoped to a non-default workspace', async () => {
    const workspaceId = 'workspace_northstar_june_2026'
    const organizationId = 'org_northstar'
    const storage = new LocalUploadStorage(process.env.AUDIT_UPLOAD_STORAGE_ROOT!)
    const saved = await storage.save({
      workspaceId,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      bytes: Buffer.from('account_id,meter,quantity\nacct_1,tokens,2500\n'),
      contentType: 'text/csv',
    })
    const upload = createUploadRecord({
      organizationId,
      workspaceId,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      byteSize: saved.byteSize,
      contentType: saved.contentType,
      storageKey: saved.storageKey,
      checksum: saved.checksum,
      uploadedBy: 'user_customer',
    })
    await new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).save(upload)

    const response = await GET(downloadRequest(upload.id, signedToken(upload.id, workspaceId), sessionCookie('internal@usageintegrity.local')), {
      params: Promise.resolve({ uploadId: upload.id }),
    })

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).toString('utf8')).toBe('account_id,meter,quantity\nacct_1,tokens,2500\n')

    await expect(getAuditLogStore().listByWorkspace(workspaceId)).resolves.toMatchObject([
      {
        organizationId,
        workspaceId,
        actorId: DEFAULT_INTERNAL_USER_ID,
        action: 'file_downloaded',
        targetType: 'upload',
        targetId: upload.id,
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
  })

  it('returns a controlled 404 when upload metadata points at a missing stored file', async () => {
    const upload = createUploadRecord({
      organizationId: DEFAULT_ORGANIZATION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'pricing_docs',
      filename: 'missing-pricing.pdf',
      byteSize: 10,
      contentType: 'application/pdf',
      storageKey: 'workspaces/workspace_acme_may_2026/pricing_docs/missing-pricing.pdf',
      uploadedBy: 'user_customer',
    })
    await new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).save(upload)

    const response = await GET(downloadRequest(upload.id, signedToken(upload.id), sessionCookie('internal@usageintegrity.local')), {
      params: Promise.resolve({ uploadId: upload.id }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Uploaded file bytes not found' })
    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
  })

  it('requires an internal admin session before honoring a signed download token', async () => {
    const storage = new LocalUploadStorage(process.env.AUDIT_UPLOAD_STORAGE_ROOT!)
    const saved = await storage.save({
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      bytes: Buffer.from('%PDF-1.7 pricing terms'),
      contentType: 'application/pdf',
    })
    const upload = createUploadRecord({
      organizationId: DEFAULT_ORGANIZATION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      byteSize: saved.byteSize,
      contentType: saved.contentType,
      storageKey: saved.storageKey,
      checksum: saved.checksum,
      uploadedBy: 'user_customer',
    })
    await new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).save(upload)

    const withoutSession = await GET(downloadRequest(upload.id, signedToken(upload.id)), {
      params: Promise.resolve({ uploadId: upload.id }),
    })
    const customerSession = await GET(downloadRequest(upload.id, signedToken(upload.id), sessionCookie('customer@acme.ai')), {
      params: Promise.resolve({ uploadId: upload.id }),
    })

    expect(withoutSession.status).toBe(401)
    await expect(withoutSession.json()).resolves.toEqual({ error: 'Login required' })
    expect(customerSession.status).toBe(403)
    await expect(customerSession.json()).resolves.toEqual({ error: 'Internal admin required' })
    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
  })
})

function signedToken(uploadId: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  return createUploadDownloadToken(
    {
      uploadId,
      workspaceId,
      expiresInSeconds: 300,
    },
    getDownloadTokenSecret(),
  )
}

function downloadRequest(uploadId: string, token: string, cookie?: string) {
  return new Request(`http://localhost/api/uploads/${encodeURIComponent(uploadId)}/download?token=${encodeURIComponent(token)}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  })
}

function sessionCookie(email: string) {
  const user = findInvitedUserByEmail(email)

  if (!user) {
    throw new Error(`Missing invited user fixture: ${email}`)
  }

  return `${SESSION_COOKIE_NAME}=${createSessionToken(user, process.env.AUDIT_SESSION_SECRET!)}`
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
