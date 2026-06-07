import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStripeConnection, runAndPersistStripeReadOnlySync } from '@/lib/audit/stripe-connector'
import { createPricingRule, requestPricingRuleCustomerApproval } from '@/lib/audit/pricing-rules'
import {
  getPricingRuleStore,
  getReconciliationScheduleStore,
  getStripeConnectionStore,
  getStripeResourceSnapshotStore,
  getStripeSyncRunStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { createReconciliationSchedule } from '@/lib/audit/reconciliation-schedules'
import { createWarehouseCsvConnection } from '@/lib/audit/warehouse-connector'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import Settings from './page'

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
  AUDIT_PRICING_RULE_PATH: process.env.AUDIT_PRICING_RULE_PATH,
  AUDIT_RECONCILIATION_SCHEDULE_PATH: process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH,
  AUDIT_STRIPE_CONNECTION_PATH: process.env.AUDIT_STRIPE_CONNECTION_PATH,
  AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH: process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH,
  AUDIT_STRIPE_SYNC_RUN_PATH: process.env.AUDIT_STRIPE_SYNC_RUN_PATH,
  AUDIT_WAREHOUSE_CONNECTION_PATH: process.env.AUDIT_WAREHOUSE_CONNECTION_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace settings page', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T11:00:00.000Z'))

    tempDir = await mkdtemp(join(tmpdir(), 'uri-settings-page-'))
    process.env.AUDIT_PRICING_RULE_PATH = join(tempDir, 'pricing-rules.json')
    process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH = join(tempDir, 'reconciliation-schedules.json')
    process.env.AUDIT_STRIPE_CONNECTION_PATH = join(tempDir, 'stripe-connections.json')
    process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH = join(tempDir, 'stripe-resource-snapshots.json')
    process.env.AUDIT_STRIPE_SYNC_RUN_PATH = join(tempDir, 'stripe-sync-runs.json')
    process.env.AUDIT_WAREHOUSE_CONNECTION_PATH = join(tempDir, 'warehouse-connections.json')
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
    vi.useRealTimers()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('prefills active workspace defaults and Stripe connector status', async () => {
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
    const connection = createStripeConnection(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_northstar_finance',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    await getStripeConnectionStore().save(
      connection,
    )
    await runAndPersistStripeReadOnlySync({
      connection,
      secretKey: 'sk_live_sensitive_secret',
      requestedBy: 'internal_admin',
      resources: ['invoices', 'customers'],
      fetchImpl: async (url) => {
        if (url === 'https://api.stripe.com/v1/invoices?limit=100') {
          return stripeResponse({ data: [{ id: 'in_001' }], has_more: false })
        }

        if (url === 'https://api.stripe.com/v1/customers?limit=100') {
          return stripeResponse({ data: [{ id: 'cus_001' }], has_more: false })
        }

        throw new Error(`Unexpected request: ${url}`)
      },
      syncRunStore: getStripeSyncRunStore(),
      snapshotStore: getStripeResourceSnapshotStore(),
      now: new Date('2026-06-03T10:20:00.000Z'),
    })

    const page = await Settings()
    const text = collectText(page)

    expect(text).toContain('Audit workspace defaults for Northstar AI.')
    expect(text).toContain('Stripe connector')
    expect(text).toContain('Read-only API connection')
    expect(text).toContain('Northstar Stripe live')
    expect(text).toContain('Connected')
    expect(text).toContain('Connector health')
    expect(text).toContain('Healthy')
    expect(text).toContain('Last sync complete with 2 Stripe objects.')
    expect(text).toContain('Last sync')
    expect(text).toContain('complete')
    expect(text).toContain('2 Stripe objects')
    expect(text).toContain('Run read-only sync')
    expect(inputValue(page, 'customer_name')).toBe('Northstar AI')
    expect(inputValue(page, 'audit_period')).toBe('June 2026')
    expect(inputValue(page, 'accountLabel')).toBe('Northstar Stripe live')
    expect(inputValue(page, 'secretKey')).toBeUndefined()
    expect(inputValue(page, 'syncSecretKey')).toBeUndefined()
    expect(text).not.toContain('Acme AI')
    expect(text).not.toContain('sk_live_sensitive_secret')
  })

  it('shows the warehouse scheduled CSV export connector controls without exposing the export URL', async () => {
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
    await getWarehouseCsvConnectionStore().save(
      createWarehouseCsvConnection(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          sourceLabel: 'Northstar warehouse usage',
          exportUrl: 'https://warehouse.example.com/exports/usage.csv?token=sensitive',
          schedule: 'daily',
          connectedBy: 'user_engineering',
          usageCsvMapping: {
            accountId: 'tenant',
            customerName: 'company',
            meter: 'metric',
            quantity: 'units_used',
            unit: 'uom',
            periodStart: 'from_date',
            periodEnd: 'to_date',
          },
        },
        new Date('2026-06-03T12:00:00.000Z'),
      ),
    )

    const page = await Settings()
    const text = collectText(page)

    expect(text).toContain('Warehouse export connector')
    expect(text).toContain('Northstar warehouse usage')
    expect(text).toContain('daily')
    expect(text).toContain('Run warehouse sync')
    expect(inputValue(page, 'sourceLabel')).toBe('Northstar warehouse usage')
    expect(inputValue(page, 'warehouseExportUrl')).toBeUndefined()
    expect(text).not.toContain('token=sensitive')
  })

  it('shows the monthly pre-close reconciliation schedule controls and current next run', async () => {
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
    await getReconciliationScheduleStore().save(
      createReconciliationSchedule(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          name: 'June close pre-check',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          runAt: '2026-07-03T08:00:00.000Z',
          timezone: 'Europe/Dublin',
          lateUsageGracePeriodDays: 3,
          ruleTemplateIds: ['usage_without_invoice', 'invoice_without_usage'],
          createdBy: 'user_northstar_finance',
        },
        new Date('2026-06-03T12:00:00.000Z'),
      ),
    )

    const page = await Settings()
    const text = collectText(page)

    expect(text).toContain('Pre-close reconciliation')
    expect(text).toContain('June close pre-check')
    expect(text).toContain('monthly')
    expect(text).toContain('Next run')
    expect(text).toContain('3 Jul 2026')
    expect(text).toContain('Late-usage close window: 3 days')
    expect(inputValue(page, 'scheduleName')).toBe('June close pre-check')
    expect(inputValue(page, 'periodStart')).toBe('2026-06-01')
    expect(inputValue(page, 'periodEnd')).toBe('2026-06-30')
    expect(inputValue(page, 'runAt')).toBe('2026-07-03T08:00')
    expect(inputValue(page, 'timezone')).toBe('Europe/Dublin')
    expect(inputValue(page, 'lateUsageGracePeriodDays')).toBe('3')
  })

  it('shows pricing rule controls and configured workspace rules', async () => {
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
    await getPricingRuleStore().saveMany([
      createPricingRule(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          name: 'Standard token rate',
          type: 'rate',
          meter: 'llm_tokens',
          unit: '1k_tokens',
          billingPeriod: 'monthly',
          rate: 2.5,
          currency: 'EUR',
          effectiveFrom: '2026-06-01',
          createdBy: 'user_northstar_finance',
        },
        new Date('2026-06-03T09:00:00.000Z'),
      ),
      createPricingRule(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          name: 'Monthly included tokens',
          type: 'allowance',
          meter: 'llm_tokens',
          unit: 'tokens',
          billingPeriod: 'monthly',
          allowance: 100000,
          effectiveFrom: '2026-06-01',
          createdBy: 'user_northstar_finance',
        },
        new Date('2026-06-03T09:05:00.000Z'),
      ),
      createPricingRule(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          name: 'Token overage rate',
          type: 'overage_rate',
          meter: 'llm_tokens',
          unit: '1k_tokens',
          billingPeriod: 'monthly',
          threshold: 100000,
          rate: 1.25,
          currency: 'EUR',
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-12-31',
          createdBy: 'user_northstar_finance',
        },
        new Date('2026-06-03T09:10:00.000Z'),
      ),
      createPricingRule(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          name: 'Launch discount',
          type: 'discount',
          discountPercent: 15,
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-09-30',
          createdBy: 'user_northstar_finance',
        },
        new Date('2026-06-03T09:15:00.000Z'),
      ),
    ])

    const page = await Settings()
    const text = collectText(page)

    expect(text).toContain('Pricing rules')
    expect(text).toContain('Configure customer-approved rates, allowances, overages, discounts, and effective dates.')
    expect(text).toContain('Standard token rate')
    expect(text).toContain('2.5 eur per 1k_tokens')
    expect(text).toContain('Monthly included tokens')
    expect(text).toContain('100,000 tokens')
    expect(text).toContain('Token overage rate')
    expect(text).toContain('threshold 100,000')
    expect(text).toContain('Launch discount')
    expect(text).toContain('15% until 2026-09-30')
    expect(text).not.toContain('Other workspace pricing')
    expect(controlNames(page)).toEqual(
      expect.arrayContaining([
        'pricingRuleName',
        'pricingRuleType',
        'pricingRuleMeter',
        'pricingRuleUnit',
        'pricingRuleBillingPeriod',
        'pricingRuleRate',
        'pricingRuleAllowance',
        'pricingRuleThreshold',
        'pricingRuleDiscountPercent',
        'pricingRuleCurrency',
        'pricingRuleEffectiveFrom',
        'pricingRuleEffectiveTo',
      ]),
    )
  })

  it('shows customer approval controls for pending material pricing rule changes', async () => {
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
    const pending = requestPricingRuleCustomerApproval(
      createPricingRule(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          name: 'Token overage rate',
          type: 'overage_rate',
          meter: 'llm_tokens',
          unit: '1k_tokens',
          billingPeriod: 'monthly',
          threshold: 100000,
          rate: 1.5,
          currency: 'EUR',
          effectiveFrom: '2026-07-01',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-03T09:10:00.000Z'),
      ),
      {
        requestedBy: 'internal_admin',
        reason: 'Material pricing rule change by internal admin',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getPricingRuleStore().saveMany([pending])

    const page = await Settings()
    const text = collectText(page)

    expect(text).toContain('Token overage rate')
    expect(text).toContain('Pending customer approval')
    expect(text).toContain('Customer approval requested by internal_admin')
    expect(text).toContain('Approve pricing rule')
    expect(text).toContain('Reject pricing rule')
    expect(controlNames(page)).toEqual(expect.arrayContaining(['approvalDecision', 'approvalNote']))
  })

  it('shows Stripe connector sync failures in the health summary', async () => {
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
    const connection = createStripeConnection(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_northstar_finance',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    await getStripeConnectionStore().save(connection)
    await runAndPersistStripeReadOnlySync({
      connection,
      secretKey: 'sk_live_sensitive_secret',
      requestedBy: 'internal_admin',
      resources: ['invoices', 'customers'],
      fetchImpl: async (url) => {
        if (url === 'https://api.stripe.com/v1/invoices?limit=100') {
          return stripeErrorResponse(401)
        }

        return stripeResponse({ data: [{ id: 'cus_001' }], has_more: false })
      },
      syncRunStore: getStripeSyncRunStore(),
      snapshotStore: getStripeResourceSnapshotStore(),
      now: new Date('2026-06-03T10:20:00.000Z'),
    })

    const page = await Settings()
    const text = collectText(page)

    expect(text).toContain('Connector health')
    expect(text).toContain('Needs attention')
    expect(text).toContain('Latest Stripe sync completed with errors.')
    expect(text).toContain('invoices: Stripe invoices sync failed with HTTP 401')
  })
})

function stripeResponse(payload: { data: Array<{ id: string }>; has_more: boolean }) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload
    },
  }
}

function stripeErrorResponse(status: number) {
  return {
    ok: false,
    status,
    async json() {
      return {}
    },
  }
}

function inputValue(node: ReactNode, name: string): unknown {
  const input = findElement(node, (element) => (element.props as { name?: string }).name === name)

  return input ? (input.props as { defaultValue?: unknown }).defaultValue : undefined
}

function controlNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(controlNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }

  return [...(props.name ? [props.name] : []), ...controlNames(props.children)]
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate)

      if (match) return match
    }

    return null
  }

  if (!isValidElement(node)) {
    return null
  }

  if (predicate(node)) {
    return node
  }

  return findElement((node.props as { children?: ReactNode }).children, predicate)
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
