import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_WORKSPACE_ID, getUploadStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createUploadRecord, reviewUploadRecord } from '@/lib/audit/uploads'
import { createAuditWorkspace, createAuditWorkspacePeriod } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import UploadsPage from './page'

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

const ORIGINAL_ENV = {
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('uploads page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-uploads-page-'))
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'user_customer_admin',
      email: 'customer@acme.ai',
      name: 'Acme Finance Admin',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      role: 'customer_admin',
      workspaceIds: [DEFAULT_WORKSPACE_ID],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('does not show seeded demo uploads when no uploads were received', async () => {
    const page = await UploadsPage()
    const text = collectText(page)

    expect(text).toContain('Required source files for Acme AI - May 2026.')
    expect(text).toContain('Not received')
    expect(text).not.toContain('usage-events-may.csv')
    expect(text).not.toContain('acme-order-forms.zip')
  })

  it('shows a fresh active-period checklist with reusable uploads rolled forward', async () => {
    const workspace = createAuditWorkspace(
      {
        id: DEFAULT_WORKSPACE_ID,
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'Revenue monitoring',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        monitoringPeriods: [
          createAuditWorkspacePeriod({
            label: 'May 2026',
            periodStart: '2026-05-01',
            periodEnd: '2026-05-31',
            status: 'closed',
          }),
          createAuditWorkspacePeriod({
            label: 'June 2026',
            periodStart: '2026-06-01',
            periodEnd: '2026-06-30',
            status: 'active',
          }),
        ],
        status: 'uploads',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          category: 'contracts_order_forms',
          filename: 'acme-order-form-may.pdf',
          byteSize: 1024,
          contentType: 'application/pdf',
          storageKey: 'workspaces/workspace_acme_may_2026/contracts/acme-order-form-may.pdf',
          uploadedBy: 'user_finance',
          metadata: {
            monitoringPeriodId: 'period_may_2026',
            periodStart: '2026-05-01',
            periodEnd: '2026-05-31',
            periodLabel: 'May 2026',
          },
        }),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          category: 'usage_csv',
          filename: 'usage-may.csv',
          byteSize: 2048,
          contentType: 'text/csv',
          storageKey: 'workspaces/workspace_acme_may_2026/usage/usage-may.csv',
          uploadedBy: 'user_engineering',
          metadata: {
            monitoringPeriodId: 'period_may_2026',
            periodStart: '2026-05-01',
            periodEnd: '2026-05-31',
            periodLabel: 'May 2026',
          },
        }),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )

    const page = await UploadsPage()
    const text = collectText(page)

    expect(text).toContain('Required source files for Acme AI - June 2026.')
    expect(text).toContain('Checklist for June 2026')
    expect(text).toContain('acme-order-form-may.pdf')
    expect(text).toContain('Rolled forward from May 2026')
    expect(text).toContain('Product usage CSV')
    expect(text).toContain('Resets monthly')
    expect(text).not.toContain('usage-may.csv')
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

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
