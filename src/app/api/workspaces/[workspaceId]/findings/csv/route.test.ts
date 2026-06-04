import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getAuditLogStore, getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createSessionToken, SESSION_COOKIE_NAME, type InvitedUser } from '@/lib/auth/access'

import { GET } from './route'

const ORIGINAL_ENV = {
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('findings CSV export route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-findings-csv-route-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_SESSION_SECRET = 'findings-csv-route-session-secret'
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('exports only customer-visible findings for customer users and audits the download', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'approved_internal',
        title: 'Northstar visible issue',
        metadata: { customerName: 'Northstar Customer' },
        internalNote: 'Internal-only route note.',
      }),
      finding({
        id: 'finding_northstar_draft',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'draft',
        title: 'Hidden draft issue',
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        status: 'approved_internal',
        title: 'Acme issue',
      }),
    ])

    const response = await GET(downloadRequest(northstar.id, sessionCookie(northstarCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="northstar-ai-june-2026-findings.csv"')
    expect(body).toContain('Northstar visible issue')
    expect(body).not.toContain('Hidden draft issue')
    expect(body).not.toContain('Acme issue')
    expect(body).not.toContain('Internal-only route note.')
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'findings_csv_downloaded',
        actorId: northstarCustomer.id,
        organizationId: northstar.organizationId,
        targetId: northstar.id,
        targetType: 'findings_export',
        workspaceId: northstar.id,
        metadata: {
          audience: 'customer',
          findingCount: 1,
        },
      },
    ])
  })

  it('exports all workspace findings for internal admins', async () => {
    const northstar = await saveNorthstarWorkspace()
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_visible',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'approved_internal',
        title: 'Northstar visible issue',
        internalNote: 'Reviewed by operator.',
      }),
      finding({
        id: 'finding_northstar_draft',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        status: 'draft',
        title: 'Northstar draft issue',
        internalNote: 'Needs source row check.',
      }),
      finding({
        id: 'finding_acme_visible',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        status: 'approved_internal',
        title: 'Acme issue',
      }),
    ])

    const response = await GET(downloadRequest(northstar.id, sessionCookie(internalAdmin)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('Northstar visible issue')
    expect(body).toContain('Reviewed by operator.')
    expect(body).toContain('Northstar draft issue')
    expect(body).toContain('Needs source row check.')
    expect(body).not.toContain('Acme issue')
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'findings_csv_downloaded',
        actorId: internalAdmin.id,
        metadata: {
          audience: 'internal',
          findingCount: 2,
        },
      },
    ])
  })

  it('blocks customer users from exporting another workspace findings CSV', async () => {
    const northstar = await saveNorthstarWorkspace()

    const response = await GET(downloadRequest(northstar.id, sessionCookie(acmeCustomer)), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace access denied' })
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([])
  })

  it('requires a valid login session', async () => {
    const northstar = await saveNorthstarWorkspace()

    const response = await GET(downloadRequest(northstar.id), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Login required' })
  })
})

const internalAdmin: InvitedUser = {
  id: 'internal_admin',
  email: 'internal@usageintegrity.local',
  name: 'Rory',
  organizationId: 'org_internal',
  organizationName: 'Usage Revenue Integrity OS',
  role: 'internal_admin',
  workspaceIds: ['workspace_acme_may_2026'],
}

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
    customerNote: 'Customer note.',
    internalNote: 'Internal parser note.',
    metadata: {
      customerName: 'Customer',
    },
    ...overrides,
  })
}

function downloadRequest(workspaceId: string, cookie?: string) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/findings/csv`, {
    headers: cookie ? { Cookie: cookie } : undefined,
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
