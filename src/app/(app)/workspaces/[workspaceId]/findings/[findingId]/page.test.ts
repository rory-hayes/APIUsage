import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { getFindingStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspaceFindingDetailPage from './page'

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
  AUDIT_FINDING_COMMENT_PATH: process.env.AUDIT_FINDING_COMMENT_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace finding detail page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-finding-detail-page-'))
    process.env.AUDIT_FINDING_COMMENT_PATH = join(tempDir, 'finding-comments.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
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

  it('renders customer-safe detail for the requested accessible workspace only', async () => {
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
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'approved_internal',
        title: 'Northstar overage shortfall',
        expectedAmount: 305520,
        actualAmount: 250000,
        varianceAmount: 55520,
        internalNote: 'Internal note should not be visible.',
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        status: 'approved_internal',
        title: 'Acme published issue',
      }),
    ])
    await getParsedRecordStore().saveMany([usageRecord({ organizationId: northstar.organizationId, workspaceId: northstar.id })])

    const page = await WorkspaceFindingDetailPage({
      params: Promise.resolve({ findingId: 'finding_northstar_visible', workspaceId: northstar.id }),
    })
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Northstar overage shortfall')
    expect(text).toContain('Expected amount')
    expect(text).toContain('€3,055.20')
    expect(text).toContain('Actual amount')
    expect(text).toContain('€2,500.00')
    expect(text).toContain('Variance')
    expect(text).toContain('€555.20')
    expect(text).toContain('Northstar Customer · api_calls · 25,000 calls')
    expect(text).toContain('Export ticket CSV')
    expect(text).not.toContain('Internal note should not be visible.')
    expect(text).not.toContain('Acme published issue')
    expect(hrefs).toContain('/workspaces/workspace_northstar_june_2026/findings')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/findings/finding_northstar_visible/ticket-csv')
  })

  it('hides finding detail workspaces outside the current session', async () => {
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

    await expect(
      WorkspaceFindingDetailPage({
        params: Promise.resolve({ findingId: 'finding_outside', workspaceId: 'workspace_outside_session' }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
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
    varianceAmount: 500000,
    currency: 'eur',
    confidence: 0.91,
    status: 'approved_internal',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before close.',
    customerNote: 'We found usage that may not have been included on your invoice.',
    metadata: {
      customerName: 'Northstar Customer',
    },
    ...overrides,
  })
}

function usageRecord(overrides: { organizationId: string; workspaceId: string }): ParsedRecord {
  return {
    id: 'parsed_usage_001',
    organizationId: overrides.organizationId,
    workspaceId: overrides.workspaceId,
    jobId: 'parse_usage',
    uploadId: 'upl_usage',
    sourceFileId: 'src_usage',
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id: 'usage_001',
      organizationId: overrides.organizationId,
      workspaceId: overrides.workspaceId,
      customerName: 'Northstar Customer',
      meter: 'api_calls',
      quantity: 25000,
      unit: 'calls',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_usage', rowNumber: 2 }],
      metadata: {
        internalJoinKey: 'hidden',
      },
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

  if (typeof node.type === 'function' && ['Metric', 'EvidenceItem'].includes(node.type.name)) {
    const Component = node.type as unknown as (props: unknown) => ReactNode

    return collectText(Component(node.props))
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

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
