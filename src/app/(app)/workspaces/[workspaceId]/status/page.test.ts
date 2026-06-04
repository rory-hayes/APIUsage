import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getFindingStore, getUploadStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createUploadRecord, reviewUploadRecord } from '@/lib/audit/uploads'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspaceStatusPage from './page'

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
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace status page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-status-page-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
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
      expiresAt: '2026-06-03T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders status for the requested accessible workspace only', async () => {
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
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord({
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          category: 'contracts_order_forms',
          filename: 'northstar-order-form.pdf',
          byteSize: 512,
          contentType: 'application/pdf',
          storageKey: 'workspaces/workspace_northstar_june_2026/contracts/northstar-order-form.pdf',
          uploadedBy: 'user_northstar_finance',
        }),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )
    await getUploadStore().save(
      createUploadRecord({
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        category: 'contracts_order_forms',
        filename: 'acme-order-form.pdf',
        byteSize: 512,
        contentType: 'application/pdf',
        storageKey: 'workspaces/workspace_acme_may_2026/contracts/acme-order-form.pdf',
        uploadedBy: 'user_acme_finance',
      }),
    )
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'approved_internal',
        title: 'Published Northstar overage issue',
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        status: 'approved_internal',
        title: 'Published Acme issue',
      }),
    ])

    const page = await WorkspaceStatusPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)

    expect(text).toContain('Status')
    expect(text).toContain('Northstar AI - June 2026')
    expect(text).toContain('1 of 7 required upload categories accepted')
    expect(text).toContain('northstar-order-form.pdf')
    expect(text).toContain('1 approved finding')
    expect(text).not.toContain('Acme AI')
    expect(text).not.toContain('acme-order-form.pdf')
    expect(text).not.toContain('Published Acme issue')
  })

  it('calculates upload readiness from the requested workspace dynamic checklist', async () => {
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
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          category: 'provider_cost_csv',
          filename: 'northstar-provider-cost.csv',
          byteSize: 1024,
          contentType: 'text/csv',
          storageKey: 'workspaces/workspace_northstar_june_2026/provider_cost_csv/northstar-provider-cost.csv',
          uploadedBy: 'user_northstar_finance',
        }),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )

    const page = await WorkspaceStatusPage({ params: Promise.resolve({ workspaceId: workspace.id }) })
    const text = collectText(page)

    expect(text).toContain('1 of 3 required upload categories accepted')
    expect(text).toContain('Provider cost CSV')
    expect(text).toContain('northstar-provider-cost.csv')
    expect(text).not.toContain('Stripe invoices export')
    expect(text).not.toContain('Stripe customers export')
    expect(text).not.toContain('Stripe subscriptions export')
  })

  it('hides status workspaces outside the current session', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace({
        id: 'workspace_outside_session',
        organizationId: 'org_other',
        organizationName: 'Other Co',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      }),
    )

    await expect(WorkspaceStatusPage({ params: Promise.resolve({ workspaceId: 'workspace_outside_session' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'draft',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: {
      customerName: 'Northstar Customer',
    },
    ...overrides,
  })
}

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
