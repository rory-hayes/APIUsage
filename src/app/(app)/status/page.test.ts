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

import StatusPage from './page'

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
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('status page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-status-page-'))
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
      workspaceIds: ['workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('shows customer upload progress and readout readiness without draft finding titles', async () => {
    const workspace = createAuditWorkspace(
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
    await getWorkspaceStore().save(workspace)
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord(
          {
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            category: 'contracts_order_forms',
            filename: 'northstar-order-form.pdf',
            byteSize: 512,
            contentType: 'application/pdf',
            storageKey: 'workspaces/workspace_northstar_june_2026/contracts/northstar-order-form.pdf',
            uploadedBy: 'user_northstar_finance',
          },
          new Date('2026-06-02T10:00:00.000Z'),
        ),
        {
          status: 'accepted',
          reviewedBy: 'internal_admin',
        },
      ),
    )
    await getFindingStore().saveMany([
      finding({
        id: 'finding_visible',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'approved_internal',
        title: 'Published overage issue',
      }),
      finding({
        id: 'finding_draft',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'draft',
        title: 'Draft issue should stay hidden',
      }),
    ])

    const page = await StatusPage()
    const text = collectText(page)

    expect(text).toContain('Upload checklist')
    expect(text).toContain('Data quality score')
    expect(text).toContain('Completeness')
    expect(text).toContain('Parse success')
    expect(text).toContain('Mapping coverage')
    expect(text).toContain('Confidence')
    expect(text).toContain('Contracts/order forms')
    expect(text).toContain('northstar-order-form.pdf')
    expect(text).toContain('1 of 7 required upload categories accepted')
    expect(text).toContain('Readout readiness')
    expect(text).toContain('1 approved finding')
    expect(text).toContain('1 finding in internal review')
    expect(text).not.toContain('Draft issue should stay hidden')
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
