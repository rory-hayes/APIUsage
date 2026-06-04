import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceFindingsPage from './page'

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
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace findings page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-findings-page-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      name: 'Rory',
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders workspace-specific draft findings with review and merge controls', async () => {
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
        id: 'finding_northstar_draft_overage',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Northstar unbilled overage',
        status: 'draft',
        severity: 'high',
      }),
      finding({
        id: 'finding_northstar_needs_input',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Northstar needs usage confirmation',
        status: 'needs_customer_input',
        severity: 'medium',
      }),
      finding({
        id: 'finding_northstar_approved',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Approved finding should not need review',
        status: 'approved_internal',
        severity: 'high',
      }),
      finding({
        id: 'finding_acme_draft',
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        title: 'Acme draft should not render',
        status: 'draft',
        severity: 'critical',
      }),
    ])

    const page = await AdminWorkspaceFindingsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Finding review')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('2 reviewable findings')
    expect(text).toContain('1 customer-visible finding')
    expect(text).toContain('Northstar unbilled overage')
    expect(text).toContain('Northstar needs usage confirmation')
    expect(text).toContain('usage above allowance no overage')
    expect(text).toContain('Approve')
    expect(text).toContain('Reject')
    expect(text).toContain('Suppress future matches')
    expect(text).toContain('Request more data')
    expect(text).toContain('Merge')
    expect(text).toContain('Approved finding should not need review')
    expect(text).toContain('Open issue tracking')
    expect(text).not.toContain('Acme draft should not render')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
    expect(controlNames).toEqual(
      expect.arrayContaining([
        'workspaceId',
        'findingId',
        'title',
        'severity',
        'expectedAmount',
        'actualAmount',
        'recommendedAction',
        'internalNote',
        'customerNote',
        'suppressFutureMatches',
        'sourceFindingId',
        'targetFindingId',
      ]),
    )
  })

  it('renders customer issue tracking controls for open, investigating, accepted, fixed, ignored, and closed findings', async () => {
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
        id: 'finding_open_issue',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Open adjustment issue',
        status: 'open',
        severity: 'high',
        assignment: {
          owner: 'product',
          assignedBy: 'user_northstar_finance',
          assignedAt: '2026-06-05T10:30:00.000Z',
        },
      }),
      finding({
        id: 'finding_accepted_issue',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Accepted adjustment issue',
        status: 'accepted',
        severity: 'medium',
      }),
      finding({
        id: 'finding_investigating_issue',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Investigating adjustment issue',
        status: 'investigating',
        severity: 'medium',
      }),
      finding({
        id: 'finding_fixed_issue',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Fixed adjustment issue',
        status: 'fixed',
        severity: 'medium',
      }),
      finding({
        id: 'finding_ignored_issue',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Ignored adjustment issue',
        status: 'ignored',
        severity: 'low',
      }),
      finding({
        id: 'finding_closed_issue',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        title: 'Closed adjustment issue',
        status: 'closed',
        severity: 'medium',
      }),
    ])

    const page = await AdminWorkspaceFindingsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Open issue tracking')
    expect(text).toContain('1 open')
    expect(text).toContain('1 investigating')
    expect(text).toContain('1 accepted')
    expect(text).toContain('1 fixed')
    expect(text).toContain('1 ignored')
    expect(text).toContain('1 closed')
    expect(text).toContain('Open adjustment issue')
    expect(text).toContain('Product owner')
    expect(text).toContain('Investigating adjustment issue')
    expect(text).toContain('Accepted adjustment issue')
    expect(text).toContain('Fixed adjustment issue')
    expect(text).toContain('Ignored adjustment issue')
    expect(text).toContain('Closed adjustment issue')
    expect(text).toContain('Update status')
    expect(controlNames).toEqual(expect.arrayContaining(['workspaceId', 'findingId', 'status', 'issueStatusNote']))
  })

  it('hides finding workspaces that do not exist', async () => {
    await expect(AdminWorkspaceFindingsPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})

function finding(input: {
  id: string
  organizationId: string
  workspaceId: string
  title: string
  status: Finding['status']
  severity: Finding['severity']
  assignment?: {
    owner: 'finance' | 'engineering' | 'revops' | 'product'
    assignedBy: string
    assignedAt: string
    note?: string
  }
}): Finding {
  return findingSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    customerId: 'contract_northstar',
    category: 'usage_above_allowance_no_overage',
    severity: input.severity,
    title: input.title,
    expectedAmount: 420000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: input.status,
    evidenceRefs: [{ type: 'usage_record', sourceId: `${input.id}_usage` }],
    recommendedAction: 'Create an adjustment invoice before month-end close.',
    internalNote: input.status === 'needs_customer_input' ? 'Waiting on source data confirmation.' : undefined,
    assignment: input.assignment,
    metadata: {
      customerName: 'Northstar AI',
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

function collectControlNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectControlNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }

  return [...(props.name ? [props.name] : []), ...collectControlNames(props.children)]
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
