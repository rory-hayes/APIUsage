import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuditLogStore, getIntakeStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import { saveIntakeAction } from './actions'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`)
  }),
}))

const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
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
  redirect: navigation.redirect,
}))

vi.mock('next/cache', () => ({
  revalidatePath: cache.revalidatePath,
}))

const ORIGINAL_ENV = {
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('intake actions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-intake-actions-'))
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
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
    vi.clearAllMocks()
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('saves workspace intake and refreshes exported evidence-pack context', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    const formData = new FormData()
    formData.set('billing_model', 'Enterprise subscription plus metered API overages')
    formData.set('billing_systems', 'Stripe and HubSpot')
    formData.set('usage_units', 'API calls and model inference minutes')

    await expect(saveIntakeAction(formData)).rejects.toThrow('NEXT_REDIRECT:/intake?saved=1')

    await expect(getIntakeStore().getByWorkspace(workspace.id)).resolves.toMatchObject({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      status: 'in_progress',
      updatedBy: 'user_northstar_finance',
      answers: {
        billing_model: 'Enterprise subscription plus metered API overages',
        billing_systems: 'Stripe and HubSpot',
        usage_units: 'API calls and model inference minutes',
      },
    })
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toMatchObject([
      {
        action: 'intake_saved',
        actorId: 'user_northstar_finance',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        targetType: 'intake',
        metadata: expect.objectContaining({
          status: 'in_progress',
          answeredRequired: 3,
        }),
      },
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/intake')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/status')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/evidence-pack')
  })

  it('saves scoped intake for the requested accessible workspace', async () => {
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_acme_may_2026', 'workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(acmeWorkspace)
    await getWorkspaceStore().save(northstarWorkspace)
    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('billing_model', 'Northstar enterprise subscription plus API overages')
    formData.set('billing_systems', 'Stripe Billing')
    formData.set('usage_units', 'API calls')

    await expect(saveIntakeAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/intake?saved=1',
    )

    await expect(getIntakeStore().getByWorkspace(northstarWorkspace.id)).resolves.toMatchObject({
      organizationId: northstarWorkspace.organizationId,
      workspaceId: northstarWorkspace.id,
      answers: {
        billing_model: 'Northstar enterprise subscription plus API overages',
        billing_systems: 'Stripe Billing',
        usage_units: 'API calls',
      },
    })
    await expect(getIntakeStore().getByWorkspace(acmeWorkspace.id)).resolves.toBeNull()
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/intake')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/status')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/evidence-pack')
  })

  it('denies scoped intake saves outside the current session', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace({
        id: 'workspace_outside_session',
        organizationId: 'org_other',
        organizationName: 'Other Co',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      }),
    )
    const formData = new FormData()
    formData.set('workspaceId', 'workspace_outside_session')
    formData.set('billing_model', 'Outside session answer')

    await expect(saveIntakeAction(formData)).rejects.toThrow('Workspace access denied')

    await expect(getIntakeStore().getByWorkspace('workspace_outside_session')).resolves.toBeNull()
    expect(navigation.redirect).not.toHaveBeenCalled()
  })
})

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
