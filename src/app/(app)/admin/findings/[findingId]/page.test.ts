import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getFindingStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminFindingDetailPage from './page'

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

const ORIGINAL_ENV = {
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin finding detail page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-finding-detail-page-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      name: 'Rory',
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('shows draft finding evidence, source rows, confidence, and internal notes for the active workspace only', async () => {
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
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_draft_overage',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Northstar draft overage needs review',
        status: 'draft',
      }),
      finding({
        id: 'finding_acme_draft_overage',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        title: 'Acme draft overage should not render',
        status: 'draft',
      }),
    ])
    await getParsedRecordStore().saveMany([
      usageParsedRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
      }),
      usageParsedRecord({
        id: 'parsed_acme_usage',
        normalizedId: 'usage_acme',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        customerName: 'Acme AI',
      }),
    ])

    const page = await AdminFindingDetailPage({ params: Promise.resolve({ findingId: 'finding_northstar_draft_overage' }) })
    const text = collectText(page)

    expect(text).toContain('Finding review detail')
    expect(text).toContain('Northstar draft overage needs review')
    expect(text).toContain('draft')
    expect(text).toContain('91%')
    expect(text).toContain('Northstar AI · api_calls · 12,500 calls')
    expect(text).toContain('src_usage')
    expect(text).toContain('row 2')
    expect(text).toContain('Internal parser note with source row context.')
    expect(text).toContain('Customer-facing note draft.')
    expect(text).not.toContain('Acme draft overage should not render')
    expect(text).not.toContain('Acme AI · api_calls')
  })
})

function finding(input: { id: string; organizationId: string; workspaceId: string; title: string; status: Finding['status'] }): Finding {
  return findingSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    customerId: 'cus_northstar',
    category: 'usage_above_allowance_no_overage',
    severity: 'high',
    title: input.title,
    expectedAmount: 250_000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: input.status,
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_northstar' }],
    recommendedAction: 'Create adjustment invoice for missed overage usage.',
    internalNote: 'Internal parser note with source row context.',
    customerNote: 'Customer-facing note draft.',
    metadata: {
      customerName: 'Northstar AI',
      ranAt: '2026-06-08T09:00:00.000Z',
    },
  })
}

function usageParsedRecord(input: {
  id?: string
  normalizedId?: string
  organizationId: string
  workspaceId: string
  customerName?: string
}): ParsedRecord {
  return {
    id: input.id ?? 'parsed_usage_northstar',
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    jobId: 'parse_usage',
    uploadId: 'upl_usage',
    sourceFileId: 'src_usage',
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id: input.normalizedId ?? 'usage_northstar',
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      accountId: 'acct_northstar',
      customerName: input.customerName ?? 'Northstar AI',
      meter: 'api_calls',
      quantity: 12500,
      unit: 'calls',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_usage', rowNumber: 2 }],
      metadata: {},
    },
  }
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
