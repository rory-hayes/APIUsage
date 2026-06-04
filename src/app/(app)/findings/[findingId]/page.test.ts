import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFindingComment } from '@/lib/audit/finding-comments'
import { getFindingCommentStore, getFindingStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import FindingDetailPage from './page'

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
  AUDIT_FINDING_COMMENT_PATH: process.env.AUDIT_FINDING_COMMENT_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('customer finding detail page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-finding-detail-page-'))
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
      workspaceIds: ['workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('shows expected, actual, and variance amounts with sanitized evidence', async () => {
    const workspace = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'approved_internal',
        title: 'Northstar overage shortfall',
        expectedAmount: 305520,
        actualAmount: 250000,
        internalNote: 'Internal note should not be visible.',
        assignment: {
          owner: 'revops',
          assignedBy: 'user_northstar_finance',
          assignedAt: '2026-06-05T10:30:00.000Z',
          note: 'RevOps should validate customer-facing follow-up.',
        },
      }),
    ])
    await getParsedRecordStore().saveMany([usageRecord({ organizationId: workspace.organizationId, workspaceId: workspace.id })])
    await getFindingCommentStore().save(
      createFindingComment(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          findingId: 'finding_northstar_visible',
          body: 'We can confirm this adjustment should be included in June close.',
          authorId: 'user_northstar_finance',
          authorName: 'Northstar Finance',
          authorRole: 'customer_admin',
        },
        new Date('2026-06-05T11:00:00.000Z'),
      ),
    )
    await getFindingCommentStore().save(
      createFindingComment(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          findingId: 'finding_northstar_visible',
          body: 'Revenue Ops will add this to the readout notes.',
          authorId: 'internal_admin',
          authorName: 'Rory',
          authorRole: 'internal_admin',
        },
        new Date('2026-06-05T12:00:00.000Z'),
      ),
    )

    const page = await FindingDetailPage({ params: Promise.resolve({ findingId: 'finding_northstar_visible' }) })
    const text = collectText(page)
    const controlNames = collectControlNames(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Northstar overage shortfall')
    expect(text).toContain('Expected amount')
    expect(text).toContain('€3,055.20')
    expect(text).toContain('Actual amount')
    expect(text).toContain('€2,500.00')
    expect(text).toContain('Variance')
    expect(text).toContain('€555.20')
    expect(text).toContain('Northstar Customer · api_calls · 25,000 calls')
    expect(text).toContain('Recommended action')
    expect(text).toContain('Assigned owner')
    expect(text).toContain('RevOps')
    expect(text).toContain('Assign owner')
    expect(text).toContain('Finance')
    expect(text).toContain('Engineering')
    expect(text).toContain('Product owner')
    expect(text).toContain('Export ticket CSV')
    expect(text).toContain('Workflow status')
    expect(text).toContain('Investigating')
    expect(text).toContain('Accepted')
    expect(text).toContain('Fixed')
    expect(text).toContain('Ignored')
    expect(text).toContain('Closed')
    expect(text).toContain('Discussion')
    expect(text).toContain('Northstar Finance')
    expect(text).toContain('Customer admin')
    expect(text).toContain('We can confirm this adjustment should be included in June close.')
    expect(text).toContain('Rory')
    expect(text).toContain('Internal admin')
    expect(text).toContain('Revenue Ops will add this to the readout notes.')
    expect(text).toContain('Add comment')
    expect(controlNames).toEqual(
      expect.arrayContaining(['workspaceId', 'findingId', 'assignmentOwner', 'assignmentNote', 'workflowStatus', 'workflowStatusNote', 'body']),
    )
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/findings/finding_northstar_visible/ticket-csv')
    expect(text).not.toContain('Internal note should not be visible.')
  })
})

async function saveNorthstarWorkspace() {
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

  return workspace
}

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

function collectControlNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectControlNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }
  const ownName = typeof props.name === 'string' ? [props.name] : []

  return [...ownName, ...collectControlNames(props.children)]
}

function collectHrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectHrefs)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; href?: string }
  const ownHref = typeof props.href === 'string' ? [props.href] : []

  return [...ownHref, ...collectHrefs(props.children)]
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
