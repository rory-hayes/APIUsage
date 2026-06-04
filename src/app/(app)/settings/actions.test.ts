import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStripeConnection } from '@/lib/audit/stripe-connector'
import { createPricingRule } from '@/lib/audit/pricing-rules'
import {
  getAuditLogStore,
  getInviteStore,
  getParsedRecordStore,
  getParseJobStore,
  getPricingRuleStore,
  getReconciliationScheduleStore,
  getReminderEmailStore,
  getStripeConnectionStore,
  getStripeResourceSnapshotStore,
  getStripeSyncRunStore,
  getUploadStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'
import { createWorkspaceInvite } from '@/lib/auth/invites'

import {
  runStripeSyncAction,
  runWarehouseCsvSyncAction,
  reviewPricingRuleApprovalAction,
  saveReconciliationScheduleAction,
  savePricingRuleAction,
  saveStripeConnectionAction,
  saveWarehouseCsvConnectionAction,
} from './actions'

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
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PRICING_RULE_PATH: process.env.AUDIT_PRICING_RULE_PATH,
  AUDIT_RECONCILIATION_SCHEDULE_PATH: process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH,
  AUDIT_REMINDER_EMAIL_PATH: process.env.AUDIT_REMINDER_EMAIL_PATH,
  AUDIT_STRIPE_CONNECTION_PATH: process.env.AUDIT_STRIPE_CONNECTION_PATH,
  AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH: process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH,
  AUDIT_STRIPE_SYNC_RUN_PATH: process.env.AUDIT_STRIPE_SYNC_RUN_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_UPLOAD_STORAGE_ROOT: process.env.AUDIT_UPLOAD_STORAGE_ROOT,
  AUDIT_WAREHOUSE_CONNECTION_PATH: process.env.AUDIT_WAREHOUSE_CONNECTION_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('settings actions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-settings-actions-'))
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PRICING_RULE_PATH = join(tempDir, 'pricing-rules.json')
    process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH = join(tempDir, 'reconciliation-schedules.json')
    process.env.AUDIT_REMINDER_EMAIL_PATH = join(tempDir, 'reminder-emails.json')
    process.env.AUDIT_STRIPE_CONNECTION_PATH = join(tempDir, 'stripe-connections.json')
    process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH = join(tempDir, 'stripe-resource-snapshots.json')
    process.env.AUDIT_STRIPE_SYNC_RUN_PATH = join(tempDir, 'stripe-sync-runs.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_UPLOAD_STORAGE_ROOT = join(tempDir, 'files')
    process.env.AUDIT_WAREHOUSE_CONNECTION_PATH = join(tempDir, 'warehouse-connections.json')
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
    vi.unstubAllGlobals()
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('saves a read-only Stripe connector without persisting the submitted secret', async () => {
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
    const formData = new FormData()
    formData.set('accountLabel', 'Northstar Stripe live')
    formData.set('secretKey', 'sk_live_sensitive_secret')

    await expect(saveStripeConnectionAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?stripe=connected')

    await expect(getStripeConnectionStore().getByWorkspace(workspace.id)).resolves.toMatchObject({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      provider: 'stripe',
      mode: 'read_only',
      accountLabel: 'Northstar Stripe live',
      secretRef: 'stripe_secret_workspace_northstar_june_2026_a1761dc0bc1f',
      status: 'connected',
      connectedBy: 'user_northstar_finance',
    })
    await expect(getStripeConnectionStore().list()).resolves.not.toContainEqual(expect.objectContaining({ secretKey: 'sk_live_sensitive_secret' }))
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'stripe_connection_saved',
        actorId: 'user_northstar_finance',
        targetType: 'connector',
        metadata: expect.objectContaining({
          provider: 'stripe',
          mode: 'read_only',
          accountLabel: 'Northstar Stripe live',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('runs a read-only Stripe sync and stores resource snapshots for the active workspace', async () => {
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
    await getWorkspaceStore().save(workspace)
    await getStripeConnectionStore().save(connection)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        const resource = url.match(/\/v1\/([^?]+)/)?.[1]

        if (!resource) {
          throw new Error(`Unexpected Stripe URL: ${url}`)
        }

        return stripeResponse({ data: [stripeObject(resource)], has_more: false })
      }),
    )
    const formData = new FormData()
    formData.set('syncSecretKey', 'sk_live_sensitive_secret')

    await expect(runStripeSyncAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?stripe=synced')

    await expect(getStripeSyncRunStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        connectionId: connection.id,
        status: 'complete',
        requestedBy: 'user_northstar_finance',
        resources: [
          expect.objectContaining({ resource: 'invoices', objectCount: 1, status: 'complete' }),
          expect.objectContaining({ resource: 'customers', objectCount: 1, status: 'complete' }),
          expect.objectContaining({ resource: 'subscriptions', objectCount: 1, status: 'complete' }),
          expect.objectContaining({ resource: 'prices', objectCount: 1, status: 'complete' }),
          expect.objectContaining({ resource: 'products', objectCount: 1, status: 'complete' }),
          expect.objectContaining({ resource: 'coupons', objectCount: 1, status: 'complete' }),
          expect.objectContaining({ resource: 'credit_notes', objectCount: 1, status: 'complete' }),
        ],
      }),
    ])
    await expect(getStripeResourceSnapshotStore().listByWorkspace(workspace.id)).resolves.toHaveLength(7)
    await expect(getStripeResourceSnapshotStore().listByWorkspace(workspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'invoices',
          objectId: 'in_001',
          object: expect.objectContaining({ id: 'in_001', amount_due: 19950 }),
        }),
        expect.objectContaining({
          resource: 'credit_notes',
          objectId: 'cn_001',
          object: { id: 'cn_001' },
        }),
      ]),
    )
    await expect(getParseJobStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        uploadId: expect.stringMatching(/^stripe_sync_/),
        sourceFileId: expect.stringMatching(/^src_stripe_sync_/),
        filename: expect.stringContaining('Stripe API sync'),
        category: 'stripe_api_sync',
        parser: 'stripe_api_sync',
        status: 'complete',
        recordCount: 3,
        errorCount: 0,
      }),
    ])
    await expect(getParsedRecordStore().listByWorkspace(workspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: 'customer',
          data: expect.objectContaining({
            displayName: 'Northstar AI',
            primaryEmail: 'finance@northstar.ai',
            externalIds: { stripeCustomerId: 'cus_001' },
          }),
        }),
        expect.objectContaining({
          recordType: 'invoice_line',
          data: expect.objectContaining({
            invoiceId: 'in_001',
            externalCustomerId: 'cus_001',
            amount: 19950,
            currency: 'eur',
            status: 'paid',
          }),
        }),
        expect.objectContaining({
          recordType: 'subscription',
          data: expect.objectContaining({
            subscriptionId: 'sub_001',
            externalCustomerId: 'cus_001',
            status: 'active',
            product: 'prod_api',
            plan: 'Enterprise Usage',
          }),
        }),
      ]),
    )
    await expect(getParsedRecordStore().listByWorkspace(workspace.id)).resolves.toHaveLength(3)
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'stripe_sync_run',
        actorId: 'user_northstar_finance',
        targetType: 'connector',
        metadata: expect.objectContaining({
          provider: 'stripe',
          mode: 'read_only',
          status: 'complete',
          objectCount: 7,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('sends failed sync alerts to active customer invitees and internal admins when Stripe sync fails', async () => {
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
    await getWorkspaceStore().save(workspace)
    await getStripeConnectionStore().save(connection)
    await getInviteStore().save(
      createWorkspaceInvite({
        email: 'finance@northstar.ai',
        name: 'Northstar Finance',
        organizationId: workspace.organizationId,
        organizationName: workspace.organizationName,
        role: 'customer_admin',
        workspaceId: workspace.id,
        invitedBy: 'internal_admin',
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        async json() {
          return {}
        },
      })),
    )
    const formData = new FormData()
    formData.set('syncSecretKey', 'sk_live_sensitive_secret')

    await expect(runStripeSyncAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?stripe=synced')

    await expect(getStripeSyncRunStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        status: 'failed',
      }),
    ])
    await expect(getReminderEmailStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        type: 'failed_sync',
        recipientEmail: 'finance@northstar.ai',
        subject: 'Northstar AI June 2026 audit: Stripe sync needs attention',
        body: expect.stringContaining('Stripe invoices sync failed with HTTP 401'),
      }),
      expect.objectContaining({
        type: 'failed_sync',
        recipientEmail: 'internal@usageintegrity.local',
        recipientName: 'Internal admin',
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'reminder_email_sent',
          targetType: 'reminder_email',
          metadata: expect.objectContaining({
            reminderType: 'failed_sync',
            recipientCount: 2,
            provider: 'stripe',
            status: 'failed',
          }),
        }),
      ]),
    )
  })

  it('saves a read-only warehouse scheduled CSV export connector without persisting the export URL', async () => {
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
    const formData = new FormData()
    formData.set('sourceLabel', 'Northstar warehouse usage')
    formData.set('exportUrl', 'https://warehouse.example.com/exports/usage.csv?token=sensitive')
    formData.set('schedule', 'daily')
    formData.set('usageAccountIdColumn', 'tenant')
    formData.set('usageCustomerNameColumn', 'company')
    formData.set('usageMeterColumn', 'metric')
    formData.set('usageQuantityColumn', 'units_used')
    formData.set('usageUnitColumn', 'uom')
    formData.set('usagePeriodStartColumn', 'from_date')
    formData.set('usagePeriodEndColumn', 'to_date')

    await expect(saveWarehouseCsvConnectionAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?warehouse=connected')

    await expect(getWarehouseCsvConnectionStore().getByWorkspace(workspace.id)).resolves.toMatchObject({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      provider: 'warehouse_csv',
      mode: 'read_only',
      sourceLabel: 'Northstar warehouse usage',
      schedule: 'daily',
      status: 'connected',
      connectedBy: 'user_northstar_finance',
      usageCsvMapping: {
        accountId: 'tenant',
        customerName: 'company',
        meter: 'metric',
        quantity: 'units_used',
        unit: 'uom',
        periodStart: 'from_date',
        periodEnd: 'to_date',
      },
    })
    await expect(getWarehouseCsvConnectionStore().list()).resolves.not.toContainEqual(
      expect.objectContaining({
        exportUrl: 'https://warehouse.example.com/exports/usage.csv?token=sensitive',
      }),
    )
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'warehouse_connection_saved',
        actorId: 'user_northstar_finance',
        targetType: 'connector',
        metadata: expect.objectContaining({
          provider: 'warehouse_csv',
          mode: 'read_only',
          schedule: 'daily',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('runs a warehouse scheduled CSV export sync into normalized usage records', async () => {
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
    const connectForm = new FormData()
    connectForm.set('sourceLabel', 'Northstar warehouse usage')
    connectForm.set('exportUrl', 'https://warehouse.example.com/exports/usage.csv?token=sensitive')
    connectForm.set('schedule', 'daily')
    connectForm.set('usageAccountIdColumn', 'tenant')
    connectForm.set('usageCustomerNameColumn', 'company')
    connectForm.set('usageMeterColumn', 'metric')
    connectForm.set('usageQuantityColumn', 'units_used')
    connectForm.set('usageUnitColumn', 'uom')
    connectForm.set('usagePeriodStartColumn', 'from_date')
    connectForm.set('usagePeriodEndColumn', 'to_date')
    await expect(saveWarehouseCsvConnectionAction(connectForm)).rejects.toThrow('NEXT_REDIRECT:/settings?warehouse=connected')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        expect(String(input)).toBe('https://warehouse.example.com/exports/usage.csv?token=sensitive')

        return {
          ok: true,
          status: 200,
          async text() {
            return [
              'tenant,company,metric,units_used,uom,from_date,to_date',
              'acct_northstar,Northstar AI,api_calls,14600000,calls,2026-05-01,2026-05-31',
            ].join('\n')
          },
        }
      }),
    )
    const syncForm = new FormData()
    syncForm.set('warehouseExportUrl', 'https://warehouse.example.com/exports/usage.csv?token=sensitive')

    await expect(runWarehouseCsvSyncAction(syncForm)).rejects.toThrow('NEXT_REDIRECT:/settings?warehouse=synced')

    await expect(getUploadStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        category: 'usage_csv',
        filename: expect.stringMatching(/^warehouse-usage-/),
        metadata: expect.objectContaining({
          source: 'warehouse_csv_export',
          sourceLabel: 'Northstar warehouse usage',
        }),
      }),
    ])
    await expect(getParseJobStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        parser: 'usage_csv',
        status: 'complete',
        recordCount: 1,
        errorCount: 0,
      }),
    ])
    await expect(getParsedRecordStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        recordType: 'usage',
        data: expect.objectContaining({
          accountId: 'acct_northstar',
          customerName: 'Northstar AI',
          meter: 'api_calls',
          quantity: 14_600_000,
          unit: 'calls',
        }),
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'warehouse_sync_run',
          actorId: 'user_northstar_finance',
          targetType: 'connector',
          metadata: expect.objectContaining({
            provider: 'warehouse_csv',
            status: 'complete',
            recordCount: 1,
          }),
        }),
      ]),
    )
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('saves a monthly pre-close reconciliation schedule for the active workspace', async () => {
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
    const formData = new FormData()
    formData.set('scheduleName', 'June close pre-check')
    formData.set('periodStart', '2026-06-01')
    formData.set('periodEnd', '2026-06-30')
    formData.set('runAt', '2026-07-03T08:00:00.000Z')
    formData.set('timezone', 'Europe/Dublin')
    formData.set('lateUsageGracePeriodDays', '3')
    formData.append('ruleTemplateIds', 'usage_without_invoice')
    formData.append('ruleTemplateIds', 'invoice_without_usage')

    await expect(saveReconciliationScheduleAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?schedule=saved')

    await expect(getReconciliationScheduleStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        name: 'June close pre-check',
        cadence: 'monthly',
        status: 'active',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        runAt: '2026-07-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        lateUsageGracePeriodDays: 3,
        ruleTemplateIds: ['usage_without_invoice', 'invoice_without_usage'],
        createdBy: 'user_northstar_finance',
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'reconciliation_schedule_saved',
        actorId: 'user_northstar_finance',
        targetType: 'reconciliation_schedule',
        metadata: expect.objectContaining({
          cadence: 'monthly',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          runAt: '2026-07-03T08:00:00.000Z',
          lateUsageGracePeriodDays: 3,
          ruleTemplateCount: 2,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('saves a workspace pricing rule for a customer admin and audits the configuration', async () => {
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
    const formData = new FormData()
    formData.set('pricingRuleName', 'Northstar API overage')
    formData.set('pricingRuleType', 'overage_rate')
    formData.set('pricingRuleMeter', 'api_calls')
    formData.set('pricingRuleUnit', '1k_api_calls')
    formData.set('pricingRuleBillingPeriod', 'monthly')
    formData.set('pricingRuleRate', '1.25')
    formData.set('pricingRuleThreshold', '100000')
    formData.set('pricingRuleCurrency', 'EUR')
    formData.set('pricingRuleEffectiveFrom', '2026-06-01')
    formData.set('pricingRuleEffectiveTo', '2026-12-31')

    await expect(savePricingRuleAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?pricing=saved')

    await expect(getPricingRuleStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        name: 'Northstar API overage',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        billingPeriod: 'monthly',
        rate: 1.25,
        threshold: 100000,
        currency: 'eur',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-12-31',
        status: 'active',
        createdBy: 'user_northstar_finance',
        updatedBy: 'user_northstar_finance',
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'pricing_rule_saved',
        actorId: 'user_northstar_finance',
        targetType: 'pricing_rule',
        metadata: expect.objectContaining({
          mode: 'create',
          type: 'overage_rate',
          meter: 'api_calls',
          billingPeriod: 'monthly',
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-12-31',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('marks an internal admin material pricing rule change as pending customer approval', async () => {
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
    const existing = createPricingRule(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        name: 'Northstar API overage',
        type: 'overage_rate',
        rate: 1.25,
        currency: 'EUR',
        createdBy: 'user_northstar_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getPricingRuleStore().saveMany([existing])
    const formData = new FormData()
    formData.set('pricingRuleId', existing.id)
    formData.set('pricingRuleName', 'Northstar API overage - amended')
    formData.set('pricingRuleType', 'overage_rate')
    formData.set('pricingRuleRate', '1.50')
    formData.set('pricingRuleCurrency', 'EUR')
    formData.set('pricingRuleThreshold', '125000')
    formData.set('pricingRuleEffectiveFrom', '2026-07-01')

    await expect(savePricingRuleAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?pricing=saved')

    await expect(getPricingRuleStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        id: existing.id,
        name: 'Northstar API overage - amended',
        rate: 1.5,
        threshold: 125000,
        effectiveFrom: '2026-07-01',
        status: 'pending_customer_approval',
        createdBy: 'user_northstar_finance',
        updatedBy: 'internal_admin',
        createdAt: existing.createdAt,
        metadata: expect.objectContaining({
          customerApprovalRequestedBy: 'internal_admin',
          customerApprovalRequestedAt: expect.any(String),
        }),
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'pricing_rule_saved',
        actorId: 'internal_admin',
        targetType: 'pricing_rule',
        metadata: expect.objectContaining({
          mode: 'update',
          status: 'pending_customer_approval',
          customerApprovalRequired: true,
        }),
      }),
    ])
  })

  it('lets a customer admin approve a pending pricing rule', async () => {
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
    const pending = createPricingRule(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        name: 'Northstar API overage',
        type: 'overage_rate',
        rate: 1.5,
        currency: 'EUR',
        status: 'pending_customer_approval',
        createdBy: 'internal_admin',
        metadata: {
          customerApprovalRequestedBy: 'internal_admin',
          customerApprovalRequestedAt: '2026-06-03T09:00:00.000Z',
        },
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getPricingRuleStore().saveMany([pending])
    const formData = new FormData()
    formData.set('pricingRuleId', pending.id)
    formData.set('approvalDecision', 'approved')
    formData.set('approvalNote', 'Approved for July close.')

    await expect(reviewPricingRuleApprovalAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?pricing=approved')

    await expect(getPricingRuleStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        id: pending.id,
        status: 'active',
        updatedBy: 'user_northstar_finance',
        metadata: expect.objectContaining({
          customerApprovedBy: 'user_northstar_finance',
          customerApprovalNote: 'Approved for July close.',
        }),
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'pricing_rule_approval_changed',
        actorId: 'user_northstar_finance',
        targetType: 'pricing_rule',
        metadata: expect.objectContaining({
          decision: 'approved',
          fromStatus: 'pending_customer_approval',
          status: 'active',
        }),
      }),
    ])
  })

  it('lets a customer admin reject a pending pricing rule', async () => {
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
    const pending = createPricingRule(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        name: 'Northstar API overage',
        type: 'overage_rate',
        rate: 1.5,
        currency: 'EUR',
        status: 'pending_customer_approval',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getPricingRuleStore().saveMany([pending])
    const formData = new FormData()
    formData.set('pricingRuleId', pending.id)
    formData.set('approvalDecision', 'rejected')
    formData.set('approvalNote', 'Signed order form still says EUR 1.25.')

    await expect(reviewPricingRuleApprovalAction(formData)).rejects.toThrow('NEXT_REDIRECT:/settings?pricing=rejected')

    await expect(getPricingRuleStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        id: pending.id,
        status: 'rejected',
        updatedBy: 'user_northstar_finance',
        metadata: expect.objectContaining({
          customerRejectedBy: 'user_northstar_finance',
          customerRejectionNote: 'Signed order form still says EUR 1.25.',
        }),
      }),
    ])
  })

  it('blocks internal admins from customer-approval decisions', async () => {
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
    const pending = createPricingRule(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        name: 'Northstar API overage',
        type: 'overage_rate',
        rate: 1.5,
        currency: 'EUR',
        status: 'pending_customer_approval',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getPricingRuleStore().saveMany([pending])
    const formData = new FormData()
    formData.set('pricingRuleId', pending.id)
    formData.set('approvalDecision', 'approved')

    await expect(reviewPricingRuleApprovalAction(formData)).rejects.toThrow('Customer admin required')

    await expect(getPricingRuleStore().listByWorkspace(workspace.id)).resolves.toEqual([pending])
  })

  it('blocks customer members from saving pricing rules', async () => {
    sessionState.current = {
      userId: 'user_northstar_member',
      email: 'member@northstar.ai',
      name: 'Northstar Member',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_member',
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
    await getWorkspaceStore().save(workspace)
    const formData = new FormData()
    formData.set('pricingRuleName', 'Member-edited discount')
    formData.set('pricingRuleType', 'discount')
    formData.set('pricingRuleDiscountPercent', '10')

    await expect(savePricingRuleAction(formData)).rejects.toThrow('Customer admin or internal admin required')

    await expect(getPricingRuleStore().listByWorkspace(workspace.id)).resolves.toEqual([])
    expect(navigation.redirect).not.toHaveBeenCalledWith('/settings?pricing=saved')
  })
})

function stripeObjectId(resource: string) {
  const ids: Record<string, string> = {
    invoices: 'in_001',
    customers: 'cus_001',
    subscriptions: 'sub_001',
    prices: 'price_001',
    products: 'prod_001',
    coupons: 'coupon_001',
    credit_notes: 'cn_001',
  }

  return ids[resource] ?? `${resource}_001`
}

function stripeObject(resource: string): { id: string } & Record<string, unknown> {
  if (resource === 'customers') {
    return {
      id: 'cus_001',
      email: 'finance@northstar.ai',
      name: 'Northstar AI',
      created: 1777593600,
      currency: 'eur',
      delinquent: false,
    }
  }

  if (resource === 'invoices') {
    return {
      id: 'in_001',
      customer: 'cus_001',
      customer_email: 'finance@northstar.ai',
      description: 'May token overage',
      amount_due: 19950,
      currency: 'eur',
      status: 'paid',
      period_start: 1777593600,
      period_end: 1780185600,
      total: 19950,
    }
  }

  if (resource === 'subscriptions') {
    return {
      id: 'sub_001',
      customer: 'cus_001',
      status: 'active',
      current_period_start: 1777593600,
      current_period_end: 1780185600,
      items: {
        data: [
          {
            price: {
              id: 'price_enterprise',
              nickname: 'Enterprise Usage',
              product: 'prod_api',
            },
          },
        ],
      },
    }
  }

  return { id: stripeObjectId(resource) }
}

function stripeResponse(payload: { data: Array<{ id: string } & Record<string, unknown>>; has_more: boolean }) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload
    },
  }
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
