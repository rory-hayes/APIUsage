import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type Session } from '../auth/access'
import {
  addMonitoringPeriodToWorkspace,
  createAuditWorkspace,
  createAuditWorkspaceFromFormData,
  defaultAuditWorkspace,
  JsonAuditWorkspaceStore,
  listSessionWorkspaces,
  requireCurrentWorkspace,
  resolveCurrentWorkspace,
  type AuditWorkspace,
} from './workspaces'

describe('audit workspaces', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspaces-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates a normalized invite-only audit workspace record', () => {
    const workspace = createAuditWorkspace(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'May close audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )

    expect(workspace).toEqual({
      id: 'workspace_northstar_ai_may_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'May close audit',
      auditPeriod: 'May 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      currency: 'eur',
      requiredUploadCategories: [
        'contracts_order_forms',
        'pricing_docs',
        'stripe_invoices_export',
        'stripe_customers_export',
        'stripe_subscriptions_export',
        'usage_csv',
        'account_mapping_csv',
      ],
      monitoringPeriods: [
        {
          id: 'period_may_2026',
          label: 'May 2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          status: 'active',
        },
      ],
      status: 'intake',
      createdBy: 'internal_admin',
      createdAt: '2026-06-02T09:00:00.000Z',
    })
  })

  it('tracks multiple monthly audit and monitoring periods within one workspace', () => {
    const workspace = createAuditWorkspace(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'Revenue monitoring',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )

    const updated = addMonitoringPeriodToWorkspace(workspace, {
      label: 'June 2026',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      status: 'planned',
    })

    expect(updated.monitoringPeriods).toEqual([
      {
        id: 'period_may_2026',
        label: 'May 2026',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        status: 'active',
      },
      {
        id: 'period_june_2026',
        label: 'June 2026',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        status: 'planned',
      },
    ])
    expect(workspace.monitoringPeriods).toHaveLength(1)
  })

  it('creates an audit workspace from admin form data', () => {
    const formData = new FormData()
    formData.set('organizationId', 'org_aurora')
    formData.set('organizationName', 'Aurora API')
    formData.set('name', 'June revenue audit')
    formData.set('auditPeriod', 'June 2026')
    formData.set('billingSystem', 'Stripe')
    formData.set('usageSource', 'Warehouse export')
    formData.set('currency', 'USD')
    formData.append('requiredUploadCategories', 'contracts_order_forms')
    formData.append('requiredUploadCategories', 'usage_csv')
    formData.append('requiredUploadCategories', 'provider_cost_csv')

    const workspace = createAuditWorkspaceFromFormData(formData, 'internal_admin', new Date('2026-06-02T10:00:00.000Z'))

    expect(workspace).toMatchObject({
      id: 'workspace_aurora_api_june_2026',
      organizationId: 'org_aurora',
      organizationName: 'Aurora API',
      name: 'June revenue audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse export',
      currency: 'usd',
      requiredUploadCategories: ['contracts_order_forms', 'usage_csv', 'provider_cost_csv'],
      status: 'intake',
      createdBy: 'internal_admin',
    })
  })

  it('defines the seeded local Acme audit workspace', () => {
    expect(defaultAuditWorkspace).toMatchObject({
      id: 'workspace_acme_may_2026',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      name: 'May 2026 audit',
      auditPeriod: 'May 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      currency: 'eur',
      requiredUploadCategories: [
        'contracts_order_forms',
        'pricing_docs',
        'stripe_invoices_export',
        'stripe_customers_export',
        'stripe_subscriptions_export',
        'usage_csv',
        'account_mapping_csv',
      ],
      monitoringPeriods: [
        {
          id: 'period_may_2026',
          label: 'May 2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          status: 'active',
        },
      ],
      status: 'evidence_review',
    })
  })

  it('seeds the local Acme workspace and persists newly created workspaces newest first', async () => {
    const seed: AuditWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'evidence_review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const store = new JsonAuditWorkspaceStore(join(tempDir, 'workspaces.json'), [seed])
    const created = createAuditWorkspace(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Product CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )

    await expect(store.list()).resolves.toEqual([seed])

    await store.save(created)

    await expect(store.list()).resolves.toEqual([created, seed])
    await expect(store.listByOrganization('org_northstar')).resolves.toEqual([created])
    await expect(store.getById(created.id)).resolves.toEqual(created)
  })

  it('resolves the current workspace from the signed-in customer session instead of defaulting to Acme', () => {
    const northstar = createAuditWorkspace(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Product CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    const session = sessionRecord({
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: [northstar.id],
    })

    expect(resolveCurrentWorkspace(session, [defaultAuditWorkspace, northstar])).toEqual(northstar)
    expect(listSessionWorkspaces(session, [defaultAuditWorkspace, northstar])).toEqual([northstar])
  })

  it('allows internal admins to see all workspaces while preferring their pinned workspace', () => {
    const northstar = createAuditWorkspace(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Product CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    const session = sessionRecord({
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: [defaultAuditWorkspace.id],
    })

    expect(listSessionWorkspaces(session, [northstar, defaultAuditWorkspace])).toEqual([northstar, defaultAuditWorkspace])
    expect(resolveCurrentWorkspace(session, [northstar, defaultAuditWorkspace])).toEqual(defaultAuditWorkspace)
  })

  it('honors the selected workspace order in the session even when another accessible workspace is newer', () => {
    const olderAcmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_april_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'April audit',
        auditPeriod: 'April 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-04-30T09:00:00.000Z'),
    )
    const newerNorthstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Product CSV',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    const session = sessionRecord({
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: [olderAcmeWorkspace.id, newerNorthstarWorkspace.id],
    })

    expect(resolveCurrentWorkspace(session, [newerNorthstarWorkspace, olderAcmeWorkspace])).toEqual(olderAcmeWorkspace)
  })

  it('requires an accessible current workspace for customer-scoped actions', () => {
    const session = sessionRecord({
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
    })

    expect(() => requireCurrentWorkspace(session, [defaultAuditWorkspace])).toThrow('Workspace access denied')
    expect(requireCurrentWorkspace(session, [
      defaultAuditWorkspace,
      createAuditWorkspace({
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Product CSV',
        createdBy: 'internal_admin',
      }),
    ])).toMatchObject({
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
    })
  })
})

function sessionRecord(overrides: Partial<Session> = {}): Session {
  return {
    userId: 'user_customer_admin',
    email: 'customer@example.com',
    name: 'Customer Admin',
    organizationId: 'org_customer',
    organizationName: 'Customer Ltd',
    role: 'customer_admin',
    workspaceIds: ['workspace_customer_june_2026'],
    expiresAt: '2026-06-02T12:00:00.000Z',
    ...overrides,
  }
}
