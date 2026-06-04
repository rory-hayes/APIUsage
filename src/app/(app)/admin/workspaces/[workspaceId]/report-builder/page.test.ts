import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getFindingStore, getIntakeStore, getReportBuilderConfigStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createIntakeResponse } from '@/lib/audit/intake'
import { createReportBuilderConfig } from '@/lib/audit/report-builder'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import ReportBuilderPage from './page'

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
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_REPORT_BUILDER_PATH: process.env.AUDIT_REPORT_BUILDER_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin report builder page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-report-builder-page-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_REPORT_BUILDER_PATH = join(tempDir, 'report-builder.json')
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

  it('renders a workspace report builder with audited exports and customer-visible preview only', async () => {
    const workspace = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_visible_overage',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Approved overage finding',
        status: 'approved_internal',
        customerNote: 'Customer-safe overage explanation.',
        internalNote: 'Internal-only parser uncertainty.',
      }),
      finding({
        id: 'finding_draft_internal',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Draft finding should stay internal',
        status: 'draft',
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        title: 'Acme finding should not render',
        status: 'approved_internal',
      }),
    ])
    await getIntakeStore().save(
      createIntakeResponse(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          answers: {
            billing_model: 'Enterprise base fee plus API-call overages.',
            close_process: 'Finance reviews invoice previews before finalization.',
          },
          updatedBy: 'user_northstar_finance',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
    )

    const page = await ReportBuilderPage({ params: Promise.resolve({ workspaceId: workspace.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Report builder')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('1 report-ready finding')
    expect(text).toContain('1 finding held for review')
    expect(text).toContain('Root causes')
    expect(text).toContain('Billing config')
    expect(text).toContain('Action plan')
    expect(text).toContain('Billing operations owner')
    expect(text).toContain('Approved overage finding')
    expect(text).toContain('Customer-safe overage explanation.')
    expect(text).toContain('Enterprise base fee plus API-call overages.')
    expect(text).toContain('Markdown preview')
    expect(text).toContain('Report selection')
    expect(text).toContain('Include finding')
    expect(text).toContain('Include note')
    expect(text).toContain('Save report selection')
    expect(text).not.toContain('Draft finding should stay internal')
    expect(text).not.toContain('Acme finding should not render')
    expect(text).not.toContain('Internal-only parser uncertainty')
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/admin/workspaces/workspace_northstar_june_2026',
        '/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=markdown',
        '/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=csv',
        '/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=pdf',
        '/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=readout',
      ]),
    )
  })

  it('uses saved report selections to choose final findings and customer notes', async () => {
    const workspace = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_selected_with_note',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Selected finding with note',
        status: 'open',
        customerNote: 'Selected note should appear.',
      }),
      finding({
        id: 'finding_selected_without_note',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Selected finding without note',
        status: 'accepted',
        customerNote: 'Unselected note should not appear.',
      }),
      finding({
        id: 'finding_visible_but_unselected',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        title: 'Visible but unselected finding',
        status: 'monitoring',
        customerNote: 'Unselected finding note should not appear.',
      }),
    ])
    await getReportBuilderConfigStore().save(
      createReportBuilderConfig({
        workspaceId: workspace.id,
        selectedFindingIds: ['finding_selected_with_note', 'finding_selected_without_note'],
        noteFindingIds: ['finding_selected_with_note'],
        updatedBy: 'internal_admin',
      }),
    )

    const page = await ReportBuilderPage({ params: Promise.resolve({ workspaceId: workspace.id }) })
    const text = collectText(page)
    const markdownPreview = collectPreText(page)

    expect(text).toContain('2 report-ready findings')
    expect(text).toContain('Root causes')
    expect(text).toContain('Billing config')
    expect(text).toContain('Action plan')
    expect(text).toContain('Billing operations owner')
    expect(text).toContain('Selected finding with note')
    expect(text).toContain('Selected note should appear.')
    expect(text).toContain('Selected finding without note')
    expect(text).toContain('Visible but unselected finding')
    expect(markdownPreview).not.toContain('Unselected note should not appear.')
    expect(markdownPreview).not.toContain('Visible but unselected finding')
    expect(markdownPreview).not.toContain('Unselected finding note should not appear.')
  })

  it('hides report builder workspaces that do not exist', async () => {
    await expect(ReportBuilderPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
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

function finding(input: {
  id: string
  organizationId: string
  workspaceId: string
  title: string
  status: Finding['status']
  customerNote?: string
  internalNote?: string
}): Finding {
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
    varianceAmount: 250_000,
    currency: 'eur',
    confidence: 0.91,
    status: input.status,
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_northstar' }],
    recommendedAction: 'Create adjustment invoice for missed overage usage.',
    internalNote: input.internalNote,
    customerNote: input.customerNote,
    metadata: {
      customerName: input.organizationId === 'org_acme' ? 'Acme AI' : 'Northstar AI',
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

function collectPreText(node: ReactNode): string {
  if (Array.isArray(node)) {
    return node.map(collectPreText).join('')
  }

  if (!isValidElement(node)) {
    return ''
  }

  if (node.type === 'pre') {
    return collectText((node.props as { children?: ReactNode }).children)
  }

  return collectPreText((node.props as { children?: ReactNode }).children)
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
