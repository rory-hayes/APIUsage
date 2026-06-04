import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Finding, findingSchema } from '@/lib/audit/schemas'
import { type Session } from '@/lib/auth/access'

import Home, { buildTrendTicks } from './page'

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
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('dashboard page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-dashboard-page-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
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

  it('shows dashboard data for the active workspace only', async () => {
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
        id: 'finding_acme_leak',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        title: 'Acme usage leak',
        customerName: 'Acme AI',
      }),
      finding({
        id: 'finding_northstar_leak',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Northstar overage leak',
        customerName: 'Northstar Customer',
      }),
    ])

    const page = await Home()
    const text = collectText(page)

    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026 control cockpit')
    expect(text).toContain('Northstar Customer')
    expect(text).toContain('Northstar overage leak')
    expect(text).not.toContain('Acme AI')
    expect(text).not.toContain('TechNova GmbH')
  })

  it('does not show static demo leakage metrics when the active workspace has no findings', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
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
      ),
    )

    const page = await Home()
    const text = collectText(page)

    expect(text).toContain('No leakage categories have been generated for this workspace yet.')
    expect(text).toContain('No weekly findings activity has been generated for this workspace yet.')
    expect(text).not.toContain('EUR 682.4K')
    expect(text).not.toContain('17 customers exceeded contract limits')
    expect(text).not.toContain('EUR 48.7k recovered today so far')
  })

  it('does not show a static API usage revenue trend before findings exist', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
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
      ),
    )

    const page = await Home()
    const text = collectText(page)

    expect(text).toContain('No API usage revenue trend has been generated for this workspace yet.')
    expect(text).not.toContain('Jun 8 EUR 56.7K')
  })

  it('does not show static close readiness percentages before mapping data exists', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
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
      ),
    )

    const page = await Home()
    const text = collectText(page)

    expect(text).toContain('No account mapping data has been normalized for this workspace yet.')
    expect(text).not.toContain('Matched accounts92%')
    expect(text).not.toContain('Missing account IDs5%')
    expect(text).not.toContain('Stale imports2.2%')
  })

  it('builds unique trend tick keys even when compact values repeat', () => {
    const ticks = buildTrendTicks(0)

    expect(ticks.map((tick) => tick.value)).toEqual([1, 1, 0, 0])
    expect(new Set(ticks.map((tick) => tick.key)).size).toBe(ticks.length)
  })
})

function finding(input: { id: string; organizationId: string; workspaceId: string; title: string; customerName: string }): Finding {
  return findingSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: input.title,
    expectedAmount: 123_450,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'needs_review',
    evidenceRefs: [{ type: 'usage_record', sourceId: `${input.id}_usage` }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: {
      customerName: input.customerName,
      ranAt: '2026-06-08T09:00:00.000Z',
    },
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
