import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createAuditWorkspace, createAuditWorkspacePeriod } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import FindingsPage from './page'

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
  requireSession: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('findings page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-findings-page-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
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

  it('uses the audited findings CSV export route', async () => {
    await saveNorthstarWorkspace()

    const page = await FindingsPage()
    const hrefs = collectHrefs(page)

    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/findings/csv')
    expect(hrefs.some((href) => href.startsWith('data:'))).toBe(false)
  })

  it('shows customer-visible findings with category and recommended action', async () => {
    const workspace = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_wrong_rate',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Northstar overage rate mismatch',
        category: 'wrong_overage_rate',
        recommendedAction: 'Correct the overage rate before finalizing invoices.',
        status: 'approved_internal',
        assignment: {
          owner: 'engineering',
          assignedBy: 'user_northstar_finance',
          assignedAt: '2026-06-05T10:30:00.000Z',
        },
      }),
      finding({
        id: 'finding_northstar_hidden_draft',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Hidden draft finding',
        status: 'draft',
      }),
    ])

    const page = await FindingsPage()
    const text = collectText(page)

    expect(text).toContain('Northstar overage rate mismatch')
    expect(text).toContain('Wrong overage rate')
    expect(text).toContain('Owner')
    expect(text).toContain('Engineering')
    expect(text).toContain('Correct the overage rate before finalizing invoices.')
    expect(text).toContain('€5,000.00')
    expect(text).not.toContain('Hidden draft finding')
  })

  it('shows current versus previous monitoring period comparison', async () => {
    const workspace = await saveNorthstarWorkspace({
      auditPeriod: 'June 2026',
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
    })
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_june_wrong_rate',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'June overage rate mismatch',
        category: 'wrong_overage_rate',
        status: 'approved_internal',
        expectedAmount: 700000,
        actualAmount: 200000,
        varianceAmount: 500000,
        metadata: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
      }),
      finding({
        id: 'finding_northstar_may_usage_leak',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'May uninvoiced usage',
        category: 'usage_exists_no_invoice',
        status: 'published',
        expectedAmount: 300000,
        actualAmount: 100000,
        varianceAmount: 200000,
        metadata: { periodStart: '2026-05-01', periodEnd: '2026-05-31' },
      }),
    ])

    const page = await FindingsPage()
    const text = collectText(page)

    expect(text).toContain('Period comparison')
    expect(text).toContain('June 2026 vs May 2026')
    expect(text).toContain('1 current finding')
    expect(text).toContain('1 previous finding')
    expect(text).toContain('+€3,000.00 variance')
    expect(text).toContain('Wrong overage rate')
    expect(text).toContain('+1')
    expect(text).toContain('Usage exists no invoice')
    expect(text).toContain('-1')
  })
})

async function saveNorthstarWorkspace(
  overrides: Partial<Parameters<typeof createAuditWorkspace>[0]> = {},
) {
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
      ...overrides,
    },
    new Date('2026-06-02T09:00:00.000Z'),
  )

  await getWorkspaceStore().save(workspace)

  return workspace
}

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_northstar_001',
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Northstar usage leak',
    expectedAmount: 500000,
    actualAmount: 0,
    varianceAmount: 500000,
    currency: 'eur',
    confidence: 0.91,
    status: 'approved_internal',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_northstar' }],
    recommendedAction: 'Review billing configuration before close.',
    customerNote: 'We found usage that may not have been included on your invoice.',
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
