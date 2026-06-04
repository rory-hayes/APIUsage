import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createUploadRecord, createUploadTaskComment, reviewUploadRecord } from '@/lib/audit/uploads'
import { getUploadStore, getUploadTaskCommentStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspaceUploadsPage from './page'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => {
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
  AUDIT_UPLOAD_COMMENT_PATH: process.env.AUDIT_UPLOAD_COMMENT_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace uploads page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-uploads-page-'))
    process.env.AUDIT_UPLOAD_COMMENT_PATH = join(tempDir, 'upload-comments.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_acme_may_2026', 'workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders uploads for the requested accessible workspace only', async () => {
    const northstar = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'uploads',
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
        status: 'uploads',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstar)
    await getWorkspaceStore().save(acme)
    await getUploadStore().save(
      reviewUploadRecord(
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
          new Date('2026-06-02T09:30:00.000Z'),
        ),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord(
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
        ),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )
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
          body: 'Please re-upload usage with period_end populated.',
          authorId: 'internal_admin',
          authorName: 'Rory',
          authorRole: 'internal_admin',
        },
        new Date('2026-06-02T12:00:00.000Z'),
      ),
    )

    const page = await WorkspaceUploadsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const controls = collectControls(page)

    expect(text).toContain('Uploads')
    expect(text).toContain('Required source files for Northstar AI - June 2026.')
    expect(text).toContain('Product usage CSV')
    expect(text).toContain('accepted')
    expect(text).toContain('northstar-usage.csv')
    expect(text).toContain('Version history')
    expect(text).toContain('v2 latest')
    expect(text).toContain('northstar-usage-v1.csv')
    expect(text).toContain('Changed from v1')
    expect(text).toContain('Stripe invoices export')
    expect(text).toContain('Not received')
    expect(text).toContain('Comments')
    expect(text).toContain('Please re-upload usage with period_end populated.')
    expect(text).toContain('Add comment')
    expect(text).not.toContain('acme-usage.csv')
    expect(controls).toContainEqual({ name: 'workspaceId', value: northstar.id })
    expect(controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'category' }),
        expect.objectContaining({ name: 'file' }),
        { name: 'category', value: 'usage_csv' },
        expect.objectContaining({ name: 'body' }),
      ]),
    )
  })

  it('uses the requested workspace dynamic upload checklist', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'uploads',
        createdBy: 'internal_admin',
        requiredUploadCategories: ['contracts_order_forms', 'usage_csv', 'provider_cost_csv'],
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)

    const page = await WorkspaceUploadsPage({ params: Promise.resolve({ workspaceId: workspace.id }) })
    const text = collectText(page)
    const controls = collectControls(page)

    expect(text).toContain('Contracts/order forms')
    expect(text).toContain('Product usage CSV')
    expect(text).toContain('Provider cost CSV')
    expect(text).not.toContain('Stripe invoices export')
    expect(text).not.toContain('Stripe customers export')
    expect(text).not.toContain('Stripe subscriptions export')
    expect(controls).toContainEqual({ name: 'workspaceId', value: workspace.id })
  })

  it('hides upload workspaces outside the current session', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace({
        id: 'workspace_outside_session',
        organizationId: 'org_other',
        organizationName: 'Other Co',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'uploads',
        createdBy: 'internal_admin',
      }),
    )

    await expect(WorkspaceUploadsPage({ params: Promise.resolve({ workspaceId: 'workspace_outside_session' }) })).rejects.toThrow(
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

function collectControls(node: ReactNode): Array<{ name: string; value?: unknown }> {
  if (Array.isArray(node)) {
    return node.flatMap(collectControls)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string; value?: unknown }

  return [...(props.name ? [{ name: props.name, value: props.value }] : []), ...collectControls(props.children)]
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
