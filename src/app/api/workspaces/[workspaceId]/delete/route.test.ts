import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_WORKSPACE_ID,
  getAuditLogStore,
  getUploadStorage,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { createUploadRecord, JsonUploadStore } from '@/lib/audit/uploads'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { createSessionToken, findInvitedUserByEmail, SESSION_COOKIE_NAME } from '@/lib/auth/access'

import { POST } from './route'

const ORIGINAL_ENV = {
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_DATA_DICTIONARY_PATH: process.env.AUDIT_DATA_DICTIONARY_PATH,
  AUDIT_FINDING_COMMENT_PATH: process.env.AUDIT_FINDING_COMMENT_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_FINDING_SUPPRESSION_PATH: process.env.AUDIT_FINDING_SUPPRESSION_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_PRICING_RULE_PATH: process.env.AUDIT_PRICING_RULE_PATH,
  AUDIT_RECONCILIATION_SCHEDULE_PATH: process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH,
  AUDIT_REMINDER_EMAIL_PATH: process.env.AUDIT_REMINDER_EMAIL_PATH,
  AUDIT_REPORT_BUILDER_PATH: process.env.AUDIT_REPORT_BUILDER_PATH,
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_STRIPE_CONNECTION_PATH: process.env.AUDIT_STRIPE_CONNECTION_PATH,
  AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH: process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH,
  AUDIT_STRIPE_SYNC_RUN_PATH: process.env.AUDIT_STRIPE_SYNC_RUN_PATH,
  AUDIT_UPLOAD_COMMENT_PATH: process.env.AUDIT_UPLOAD_COMMENT_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_UPLOAD_STORAGE_ROOT: process.env.AUDIT_UPLOAD_STORAGE_ROOT,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace deletion route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-delete-route-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_DATA_DICTIONARY_PATH = join(tempDir, 'data-dictionary.json')
    process.env.AUDIT_FINDING_COMMENT_PATH = join(tempDir, 'finding-comments.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_FINDING_SUPPRESSION_PATH = join(tempDir, 'finding-suppressions.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
    process.env.AUDIT_PRICING_RULE_PATH = join(tempDir, 'pricing-rules.json')
    process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH = join(tempDir, 'reconciliation-schedules.json')
    process.env.AUDIT_REMINDER_EMAIL_PATH = join(tempDir, 'reminder-emails.json')
    process.env.AUDIT_REPORT_BUILDER_PATH = join(tempDir, 'report-builder.json')
    process.env.AUDIT_SESSION_SECRET = 'delete-route-session-secret'
    process.env.AUDIT_STRIPE_CONNECTION_PATH = join(tempDir, 'stripe-connections.json')
    process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH = join(tempDir, 'stripe-resource-snapshots.json')
    process.env.AUDIT_STRIPE_SYNC_RUN_PATH = join(tempDir, 'stripe-sync-runs.json')
    process.env.AUDIT_UPLOAD_COMMENT_PATH = join(tempDir, 'upload-comments.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_UPLOAD_STORAGE_ROOT = join(tempDir, 'files')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('requires an internal admin session', async () => {
    const withoutSession = await POST(deleteRequest(), { params: Promise.resolve({ workspaceId: DEFAULT_WORKSPACE_ID }) })
    const customerSession = await POST(deleteRequest(sessionCookie('customer@acme.ai')), {
      params: Promise.resolve({ workspaceId: DEFAULT_WORKSPACE_ID }),
    })

    expect(withoutSession.status).toBe(401)
    await expect(withoutSession.json()).resolves.toEqual({ error: 'Login required' })
    expect(customerSession.status).toBe(403)
    await expect(customerSession.json()).resolves.toEqual({ error: 'Internal admin required' })
  })

  it('deletes default workspace data and redirects back to security settings', async () => {
    const storage = getUploadStorage()
    const saved = await storage.save({
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'usage_csv',
      filename: 'usage.csv',
      bytes: Buffer.from('account_id,total\nacct_1,42\n'),
    })
    const upload = createUploadRecord({
      organizationId: DEFAULT_ORGANIZATION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'usage_csv',
      filename: 'usage.csv',
      uploadedBy: 'user_customer',
      ...saved,
    })
    await new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).save(upload)

    const response = await POST(deleteRequest(sessionCookie('internal@usageintegrity.local')), {
      params: Promise.resolve({ workspaceId: DEFAULT_WORKSPACE_ID }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/settings/security?deleted=1')
    await expect(new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
    await expect(storage.readBytes(upload.storageKey)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toMatchObject([
      {
        action: 'workspace_data_deleted',
        actorId: 'internal_admin',
        targetId: DEFAULT_WORKSPACE_ID,
      },
    ])
  })

  it('deletes a non-default workspace without touching default workspace data', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)

    const storage = getUploadStorage()
    const acmeUpload = await saveUpload({
      organizationId: DEFAULT_ORGANIZATION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      filename: 'acme-usage.csv',
      bytes: Buffer.from('account_id,total\nacct_acme,42\n'),
    })
    const northstarUpload = await saveUpload({
      organizationId: northstarWorkspace.organizationId,
      workspaceId: northstarWorkspace.id,
      filename: 'northstar-usage.csv',
      bytes: Buffer.from('account_id,total\nacct_northstar,84\n'),
    })

    const response = await POST(deleteRequest(sessionCookie('internal@usageintegrity.local'), northstarWorkspace.id), {
      params: Promise.resolve({ workspaceId: northstarWorkspace.id }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/settings/security?deleted=1')
    await expect(new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).listByWorkspace(northstarWorkspace.id)).resolves.toEqual([])
    await expect(storage.readBytes(northstarUpload.storageKey)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([acmeUpload])
    await expect(storage.readBytes(acmeUpload.storageKey)).resolves.toEqual(Buffer.from('account_id,total\nacct_acme,42\n'))
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        action: 'workspace_data_deleted',
        actorId: 'internal_admin',
        organizationId: northstarWorkspace.organizationId,
        targetId: northstarWorkspace.id,
        workspaceId: northstarWorkspace.id,
      },
    ])
  })
})

function deleteRequest(cookie?: string, workspaceId = DEFAULT_WORKSPACE_ID) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/delete`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    method: 'POST',
  })
}

async function saveUpload(input: { organizationId: string; workspaceId: string; filename: string; bytes: Buffer }) {
  const saved = await getUploadStorage().save({
    workspaceId: input.workspaceId,
    category: 'usage_csv',
    filename: input.filename,
    bytes: input.bytes,
  })
  const upload = createUploadRecord({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    category: 'usage_csv',
    filename: input.filename,
    uploadedBy: 'user_customer',
    ...saved,
  })
  await new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH!).save(upload)

  return upload
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
