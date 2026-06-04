import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getAuditLogStore, getFindingStore, getIntakeStore, getReportBuilderConfigStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { createIntakeResponse } from '@/lib/audit/intake'
import { createReportBuilderConfig } from '@/lib/audit/report-builder'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createSessionToken, SESSION_COOKIE_NAME, type InvitedUser } from '@/lib/auth/access'

import { GET } from './route'

const ORIGINAL_ENV = {
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_REPORT_BUILDER_PATH: process.env.AUDIT_REPORT_BUILDER_PATH,
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('evidence pack download route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-evidence-pack-route-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_REPORT_BUILDER_PATH = join(tempDir, 'report-builder.json')
    process.env.AUDIT_SESSION_SECRET = 'evidence-pack-route-session-secret'
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('returns a customer-visible Markdown evidence pack and audits the export', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'approved_internal',
        title: 'Northstar overage leak',
        metadata: { customerName: 'Northstar Customer' },
      }),
      finding({
        id: 'finding_northstar_draft',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'draft',
        title: 'Hidden draft issue',
        metadata: { customerName: 'Northstar Customer' },
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        status: 'approved_internal',
        title: 'Acme issue',
        metadata: { customerName: 'Acme AI' },
      }),
    ])
    await getIntakeStore().save(
      createIntakeResponse({
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        updatedBy: 'user_northstar_finance',
        answers: {
          billing_model: 'Platform fee plus API overages',
        },
      }),
    )

    const response = await GET(downloadRequest(northstar.id, 'markdown', sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="northstar-ai-june-2026-evidence-pack.md"')
    expect(body).toContain('# Northstar AI Evidence Pack')
    expect(body).toContain('Northstar overage leak')
    expect(body).toContain('Platform fee plus API overages')
    expect(body).not.toContain('Hidden draft issue')
    expect(body).not.toContain('Acme issue')

    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'evidence_pack_downloaded',
        actorId: northstarCustomer.id,
        organizationId: northstar.organizationId,
        targetId: northstar.id,
        targetType: 'evidence_pack',
        workspaceId: northstar.id,
        metadata: {
          format: 'markdown',
          findingCount: 1,
        },
      },
    ])
  })

  it('returns CSV evidence pack exports for an accessible workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'published',
        title: 'Usage, invoice, and "overage" mismatch',
        metadata: { customerName: 'Northstar Customer' },
      }),
    ])

    const response = await GET(downloadRequest(northstar.id, 'csv', sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="northstar-ai-june-2026-evidence-pack.csv"')
    expect(body.split('\n')[0]).toBe(
      'id,title,category,root_cause,customer,severity,status,expected_amount,actual_amount,variance_amount,currency,confidence,recommended_owner,next_action,evidence_refs,customer_note',
    )
    expect(body).toContain('"Usage, invoice, and ""overage"" mismatch",usage_exists_no_invoice,Billing config')
    expect(body).toContain('Billing operations owner,Review billing configuration before the close.')
  })

  it('honors saved report builder finding and note selections in downloaded packs', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_selected_with_note',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'open',
        title: 'Selected report finding',
        customerNote: 'Selected customer note.',
        metadata: { customerName: 'Northstar Customer' },
      }),
      finding({
        id: 'finding_selected_without_note',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'accepted',
        title: 'Selected finding without note',
        customerNote: 'This note was unchecked.',
        metadata: { customerName: 'Northstar Customer' },
      }),
      finding({
        id: 'finding_visible_unselected',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'monitoring',
        title: 'Unselected customer-visible finding',
        customerNote: 'Unselected note.',
        metadata: { customerName: 'Northstar Customer' },
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

    const response = await GET(downloadRequest(northstar.id, 'markdown', sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('Selected report finding')
    expect(body).toContain('Selected customer note.')
    expect(body).toContain('Selected finding without note')
    expect(body).not.toContain('This note was unchecked.')
    expect(body).not.toContain('Unselected customer-visible finding')
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'evidence_pack_downloaded',
        metadata: {
          format: 'markdown',
          findingCount: 2,
        },
      },
    ])
  })

  it('returns PDF evidence pack exports for an accessible workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'published',
        title: 'Northstar overage leak',
        metadata: { customerName: 'Northstar Customer' },
      }),
    ])

    const response = await GET(downloadRequest(northstar.id, 'pdf', sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = new TextDecoder('latin1').decode(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="northstar-ai-june-2026-evidence-pack.pdf"')
    expect(body).toContain('%PDF-1.4')
    expect(body).toContain('Northstar AI Evidence Pack')
    expect(body).toContain('Northstar overage leak')
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'evidence_pack_downloaded',
        actorId: northstarCustomer.id,
        organizationId: northstar.organizationId,
        targetId: northstar.id,
        targetType: 'evidence_pack',
        workspaceId: northstar.id,
        metadata: {
          format: 'pdf',
          findingCount: 1,
        },
      },
    ])
  })

  it('returns a concise readout PDF summary for an accessible workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_readout',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'published',
        title: 'Northstar readout issue',
        customerNote: 'Customer-ready readout note.',
        metadata: { customerName: 'Northstar Customer' },
      }),
      finding({
        id: 'finding_hidden_draft',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'draft',
        title: 'Hidden draft issue',
        metadata: { customerName: 'Northstar Customer' },
      }),
    ])

    const response = await GET(downloadRequest(northstar.id, 'readout', sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = new TextDecoder('latin1').decode(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="northstar-ai-june-2026-readout-summary.pdf"')
    expect(body).toContain('%PDF-1.4')
    expect(body).toContain('Northstar AI Readout Summary')
    expect(body).toContain('Northstar readout issue')
    expect(body).toContain('Customer-ready readout note.')
    expect(body).not.toContain('Hidden draft issue')
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'evidence_pack_downloaded',
        actorId: northstarCustomer.id,
        organizationId: northstar.organizationId,
        targetId: northstar.id,
        targetType: 'evidence_pack',
        workspaceId: northstar.id,
        metadata: {
          format: 'readout',
          findingCount: 1,
        },
      },
    ])
  })

  it('blocks customer users from downloading another workspace evidence pack', async () => {
    const northstar = await saveNorthstarWorkspace()

    const response = await GET(downloadRequest(northstar.id, 'markdown', sessionCookie(acmeCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace access denied' })
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([])
  })

  it('rejects unknown export formats', async () => {
    const northstar = await saveNorthstarWorkspace()

    const response = await GET(downloadRequest(northstar.id, 'json', sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported evidence pack format' })
  })
})

const northstarCustomer: InvitedUser = {
  id: 'user_northstar_finance',
  email: 'finance@northstar.ai',
  name: 'Northstar Finance',
  organizationId: 'org_northstar',
  organizationName: 'Northstar AI',
  role: 'customer_admin',
  workspaceIds: ['workspace_northstar_june_2026'],
}

const acmeCustomer: InvitedUser = {
  id: 'user_customer_admin',
  email: 'customer@acme.ai',
  name: 'Acme Finance Admin',
  organizationId: 'org_acme',
  organizationName: 'Acme AI',
  role: 'customer_admin',
  workspaceIds: ['workspace_acme_may_2026'],
}

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
    varianceAmount: 500000,
    currency: 'eur',
    confidence: 0.91,
    status: 'approved_internal',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before the close.',
    customerNote: 'We found usage that may not have been included on your invoice.',
    internalNote: 'Internal parser note.',
    metadata: {
      customerName: 'Customer',
    },
    ...overrides,
  })
}

function downloadRequest(workspaceId: string, format: string, cookie: string) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/evidence-pack?format=${encodeURIComponent(format)}`, {
    headers: { Cookie: cookie },
  })
}

function sessionCookie(user: InvitedUser) {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(user, process.env.AUDIT_SESSION_SECRET!)}`
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
