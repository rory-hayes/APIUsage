import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createIntakeResponse } from '@/lib/audit/intake'
import { createReportBuilderConfig } from '@/lib/audit/report-builder'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { getFindingStore, getIntakeStore, getReportBuilderConfigStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspaceEvidencePackPage from './page'

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
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_REPORT_BUILDER_PATH: process.env.AUDIT_REPORT_BUILDER_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace evidence pack page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-evidence-pack-page-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_REPORT_BUILDER_PATH = join(tempDir, 'report-builder.json')
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

  it('renders evidence pack for the requested accessible workspace only', async () => {
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
    await getIntakeStore().save(
      createIntakeResponse({
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        updatedBy: 'user_northstar_finance',
        answers: {
          billing_model: 'Northstar enterprise subscription with API overages',
        },
      }),
    )
    await getIntakeStore().save(
      createIntakeResponse({
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        updatedBy: 'user_acme_finance',
        answers: {
          billing_model: 'Acme legacy plan',
        },
      }),
    )
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Northstar overage rate mismatch',
        category: 'wrong_overage_rate',
        recommendedAction: 'Correct the overage rate before finalizing invoices.',
        status: 'approved_internal',
      }),
      finding({
        id: 'finding_northstar_draft',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Hidden Northstar draft',
        status: 'draft',
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        title: 'Acme published issue',
        status: 'approved_internal',
      }),
    ])

    const page = await WorkspaceEvidencePackPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Evidence pack')
    expect(text).toContain('June 2026')
    expect(text).toContain('1 customer-visible findings')
    expect(text).toContain('Root causes')
    expect(text).toContain('Contract')
    expect(text).toContain('Action plan')
    expect(text).toContain('Finance owner')
    expect(text).toContain('Northstar overage rate mismatch')
    expect(text).toContain('Correct the overage rate before finalizing invoices.')
    expect(text).toContain('Billing model')
    expect(text).toContain('Northstar enterprise subscription with API overages')
    expect(text).not.toContain('Hidden Northstar draft')
    expect(text).not.toContain('Acme published issue')
    expect(text).not.toContain('Acme legacy plan')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=markdown')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=csv')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=pdf')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=readout')
  })

  it('renders the saved report-builder finding and note selection', async () => {
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
    await getWorkspaceStore().save(northstar)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_selected_with_note',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Selected finding with note',
        status: 'open',
        customerNote: 'Selected note should appear.',
      }),
      finding({
        id: 'finding_selected_without_note',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Selected finding without note',
        status: 'accepted',
        customerNote: 'Unselected note should stay out.',
      }),
      finding({
        id: 'finding_visible_unselected',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Visible unselected finding',
        status: 'monitoring',
        customerNote: 'Unselected finding note should stay out.',
      }),
    ])
    await getReportBuilderConfigStore().save(
      createReportBuilderConfig({
        workspaceId: northstar.id,
        selectedFindingIds: ['finding_selected_with_note', 'finding_selected_without_note'],
        noteFindingIds: ['finding_selected_with_note'],
        updatedBy: 'internal_admin',
      }),
    )

    const page = await WorkspaceEvidencePackPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)

    expect(text).toContain('2 customer-visible findings')
    expect(text).toContain('Root causes')
    expect(text).toContain('Billing config')
    expect(text).toContain('Action plan')
    expect(text).toContain('Billing operations owner')
    expect(text).toContain('Selected finding with note')
    expect(text).toContain('Selected note should appear.')
    expect(text).toContain('Selected finding without note')
    expect(text).not.toContain('Unselected note should stay out.')
    expect(text).not.toContain('Visible unselected finding')
    expect(text).not.toContain('Unselected finding note should stay out.')
  })

  it('hides evidence pack workspaces outside the current session', async () => {
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

    await expect(WorkspaceEvidencePackPage({ params: Promise.resolve({ workspaceId: 'workspace_outside_session' }) })).rejects.toThrow(
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
