import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createUploadRecord, createUploadTaskComment, reviewUploadRecord } from '@/lib/audit/uploads'
import { getUploadStore, getUploadTaskCommentStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceUploadsPage from './page'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

vi.mock('@/lib/auth/server', () => ({
  requireInternalAdmin: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`)
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_DOWNLOAD_TOKEN_SECRET: process.env.AUDIT_DOWNLOAD_TOKEN_SECRET,
  AUDIT_UPLOAD_COMMENT_PATH: process.env.AUDIT_UPLOAD_COMMENT_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace uploads page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-uploads-page-'))
    process.env.AUDIT_DOWNLOAD_TOKEN_SECRET = 'test-download-secret'
    process.env.AUDIT_UPLOAD_COMMENT_PATH = join(tempDir, 'upload-comments.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      name: 'Rory',
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders workspace-specific uploads, checklist state, download links, and parser review controls', async () => {
    const northstar = createAuditWorkspace(
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
    const acme = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstar)
    await getWorkspaceStore().save(acme)
    const northstarUsage = createUploadRecord(
      {
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        category: 'usage_csv',
        filename: 'northstar-usage.csv',
        byteSize: 4096,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage.csv',
        checksum: 'f'.repeat(64),
        uploadedBy: 'user_northstar_finance',
      },
      new Date('2026-06-02T10:00:00.000Z'),
    )
    const northstarUsageV1 = reviewUploadRecord(
      createUploadRecord(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          category: 'usage_csv',
          filename: 'northstar-usage-v1.csv',
          byteSize: 3072,
          contentType: 'text/csv',
          storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage-v1.csv',
          checksum: 'e'.repeat(64),
          uploadedBy: 'user_northstar_finance',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
      { status: 'accepted', reviewedBy: 'internal_admin' },
      new Date('2026-06-02T09:30:00.000Z'),
    )
    const northstarPricing = reviewUploadRecord(
      createUploadRecord(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          category: 'pricing_docs',
          filename: 'northstar-pricing.pdf',
          byteSize: 8192,
          contentType: 'application/pdf',
          storageKey: 'workspaces/workspace_northstar_june_2026/pricing_docs/northstar-pricing.pdf',
          checksum: 'a'.repeat(64),
          uploadedBy: 'user_northstar_finance',
        },
        new Date('2026-06-02T09:30:00.000Z'),
      ),
      { status: 'accepted', reviewedBy: 'internal_admin', reviewNote: 'Current pricing received.' },
      new Date('2026-06-02T11:00:00.000Z'),
    )
    await getUploadStore().save(northstarUsageV1)
    await getUploadStore().save(northstarUsage)
    await getUploadStore().save(northstarPricing)
    await getUploadStore().save(
      createUploadRecord({
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        category: 'usage_csv',
        filename: 'acme-usage.csv',
        byteSize: 1024,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_may_2026/usage_csv/acme-usage.csv',
        uploadedBy: 'user_acme_finance',
      }),
    )
    await getUploadTaskCommentStore().save(
      createUploadTaskComment(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          category: 'usage_csv',
          body: 'Finance is waiting on Engineering for the corrected usage export.',
          authorId: 'user_northstar_finance',
          authorName: 'Northstar Finance',
          authorRole: 'customer_admin',
        },
        new Date('2026-06-02T12:00:00.000Z'),
      ),
    )

    const page = await AdminWorkspaceUploadsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Upload review')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('3 files')
    expect(text).toContain('northstar-usage.csv')
    expect(text).toContain('Version history')
    expect(text).toContain('v2 latest')
    expect(text).toContain('northstar-usage-v1.csv')
    expect(text).toContain('Changed from v1')
    expect(text).toContain('needs review')
    expect(text).toContain('northstar-pricing.pdf')
    expect(text).toContain('Current pricing received.')
    expect(text).toContain('Stripe invoices export')
    expect(text).toContain('Run parser')
    expect(text).toContain('Extract terms')
    expect(text).toContain('Needs clarification')
    expect(text).toContain('Comments')
    expect(text).toContain('Finance is waiting on Engineering for the corrected usage export.')
    expect(text).toContain('Add comment')
    expect(text).not.toContain('acme-usage.csv')
    expect(hrefs.some((href) => href.startsWith(`/api/uploads/${encodeURIComponent(northstarUsage.id)}/download?token=`))).toBe(true)
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
    expect(controlNames).toEqual(
      expect.arrayContaining([
        'workspaceId',
        'uploadId',
        'usageAccountIdColumn',
        'usageCustomerNameColumn',
        'usageMeterColumn',
        'usageQuantityColumn',
        'usageUnitColumn',
        'usagePeriodStartColumn',
        'usagePeriodEndColumn',
        'reviewNote',
        'status',
        'category',
        'body',
      ]),
    )
  })

  it('hides upload workspaces that do not exist', async () => {
    await expect(AdminWorkspaceUploadsPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join('')
  }

  if (!isValidElement(node)) {
    return ''
  }

  return collectText((node.props as { children?: ReactNode }).children)
}

function collectHrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectHrefs)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; href?: string }

  return [...(props.href ? [props.href] : []), ...collectHrefs(props.children)]
}

function collectControlNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectControlNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }

  return [...(props.name ? [props.name] : []), ...collectControlNames(props.children)]
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
