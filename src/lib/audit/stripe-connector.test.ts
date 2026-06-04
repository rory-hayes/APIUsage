import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  STRIPE_CONNECTOR_API_VERSION,
  JsonStripeConnectionStore,
  JsonStripeResourceSnapshotStore,
  JsonStripeSyncRunStore,
  buildStripeReadOnlySyncPlan,
  createStripeConnection,
  getStripeConnectorHealth,
  normalizeStripeSyncSnapshotsToParseExecution,
  runAndPersistStripeReadOnlySync,
  syncStripeReadOnlyResources,
} from './stripe-connector'

describe('stripe api connector', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-stripe-connector-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('persists a read-only Stripe connection without storing the raw secret key', async () => {
    const store = new JsonStripeConnectionStore(join(tempDir, 'stripe-connections.json'))
    const connection = createStripeConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_customer_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )

    await store.save(connection)

    await expect(store.getByWorkspace('workspace_northstar_june_2026')).resolves.toEqual({
      id: 'stripe_connection_workspace_northstar_june_2026_northstar_stripe_live',
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      provider: 'stripe',
      mode: 'read_only',
      accountLabel: 'Northstar Stripe live',
      apiVersion: STRIPE_CONNECTOR_API_VERSION,
      secretRef: 'stripe_secret_workspace_northstar_june_2026_a1761dc0bc1f',
      status: 'connected',
      connectedBy: 'user_customer_admin',
      createdAt: '2026-06-03T09:30:00.000Z',
      updatedAt: '2026-06-03T09:30:00.000Z',
    })
    await expect(store.list()).resolves.not.toContainEqual(expect.objectContaining({ secretKey: 'sk_live_sensitive_secret' }))
  })

  it('builds a full read-only sync plan for Stripe billing resources', () => {
    const plan = buildStripeReadOnlySyncPlan({
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      connectionId: 'stripe_connection_workspace_northstar_june_2026_northstar_stripe_live',
      requestedBy: 'internal_admin',
      now: new Date('2026-06-03T10:00:00.000Z'),
    })

    expect(plan).toEqual({
      id: 'stripe_sync_workspace_northstar_june_2026_2026_06_03T10_00_00_000Z',
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      connectionId: 'stripe_connection_workspace_northstar_june_2026_northstar_stripe_live',
      provider: 'stripe',
      mode: 'read_only',
      apiVersion: STRIPE_CONNECTOR_API_VERSION,
      requestedBy: 'internal_admin',
      requestedAt: '2026-06-03T10:00:00.000Z',
      resources: [
        { resource: 'invoices', method: 'GET', path: '/v1/invoices', params: { limit: '100' } },
        { resource: 'customers', method: 'GET', path: '/v1/customers', params: { limit: '100' } },
        { resource: 'subscriptions', method: 'GET', path: '/v1/subscriptions', params: { limit: '100', status: 'all' } },
        { resource: 'prices', method: 'GET', path: '/v1/prices', params: { limit: '100' } },
        { resource: 'products', method: 'GET', path: '/v1/products', params: { limit: '100' } },
        { resource: 'coupons', method: 'GET', path: '/v1/coupons', params: { limit: '100' } },
        { resource: 'credit_notes', method: 'GET', path: '/v1/credit_notes', params: { limit: '100' } },
      ],
    })
    expect(plan.resources.every((resource) => resource.method === 'GET')).toBe(true)
  })

  it('paginates read-only Stripe list requests and reports per-resource sync status', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = []
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, headers: init.headers })

      if (url === 'https://api.stripe.com/v1/invoices?limit=100') {
        return stripeResponse({ data: [{ id: 'in_001' }], has_more: true })
      }

      if (url === 'https://api.stripe.com/v1/invoices?limit=100&starting_after=in_001') {
        return stripeResponse({ data: [{ id: 'in_002' }], has_more: false })
      }

      if (url === 'https://api.stripe.com/v1/customers?limit=100') {
        return stripeResponse({ data: [{ id: 'cus_001' }], has_more: false })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const result = await syncStripeReadOnlyResources({
      secretKey: 'sk_test_secret',
      resources: ['invoices', 'customers'],
      fetchImpl,
      now: new Date('2026-06-03T10:15:00.000Z'),
    })

    expect(result).toEqual({
      provider: 'stripe',
      mode: 'read_only',
      apiVersion: STRIPE_CONNECTOR_API_VERSION,
      startedAt: '2026-06-03T10:15:00.000Z',
      completedAt: '2026-06-03T10:15:00.000Z',
      resources: [
        { resource: 'invoices', status: 'complete', objectCount: 2, pageCount: 2, error: undefined, objects: [{ id: 'in_001' }, { id: 'in_002' }] },
        { resource: 'customers', status: 'complete', objectCount: 1, pageCount: 1, error: undefined, objects: [{ id: 'cus_001' }] },
      ],
    })
    expect(calls).toEqual([
      {
        url: 'https://api.stripe.com/v1/invoices?limit=100',
        method: 'GET',
        headers: {
          Authorization: 'Bearer sk_test_secret',
          'Stripe-Version': STRIPE_CONNECTOR_API_VERSION,
        },
      },
      {
        url: 'https://api.stripe.com/v1/invoices?limit=100&starting_after=in_001',
        method: 'GET',
        headers: {
          Authorization: 'Bearer sk_test_secret',
          'Stripe-Version': STRIPE_CONNECTOR_API_VERSION,
        },
      },
      {
        url: 'https://api.stripe.com/v1/customers?limit=100',
        method: 'GET',
        headers: {
          Authorization: 'Bearer sk_test_secret',
          'Stripe-Version': STRIPE_CONNECTOR_API_VERSION,
        },
      },
    ])
    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })

  it('persists sync runs and raw Stripe resource snapshots without storing the secret key', async () => {
    const connection = createStripeConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_customer_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    const syncRunStore = new JsonStripeSyncRunStore(join(tempDir, 'stripe-sync-runs.json'))
    const snapshotStore = new JsonStripeResourceSnapshotStore(join(tempDir, 'stripe-resource-snapshots.json'))
    const fetchImpl = async (url: string) => {
      if (url === 'https://api.stripe.com/v1/invoices?limit=100') {
        return stripeResponse({ data: [{ id: 'in_001', amount_due: 12000 }], has_more: false })
      }

      if (url === 'https://api.stripe.com/v1/customers?limit=100') {
        return stripeResponse({ data: [{ id: 'cus_001', email: 'finance@northstar.ai' }], has_more: false })
      }

      throw new Error(`Unexpected request: ${url}`)
    }

    const run = await runAndPersistStripeReadOnlySync({
      connection,
      secretKey: 'sk_live_sensitive_secret',
      requestedBy: 'internal_admin',
      resources: ['invoices', 'customers'],
      fetchImpl,
      syncRunStore,
      snapshotStore,
      now: new Date('2026-06-03T10:20:00.000Z'),
    })

    expect(run).toEqual({
      id: 'stripe_sync_workspace_northstar_june_2026_2026_06_03T10_20_00_000Z',
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      connectionId: connection.id,
      provider: 'stripe',
      mode: 'read_only',
      apiVersion: STRIPE_CONNECTOR_API_VERSION,
      requestedBy: 'internal_admin',
      status: 'complete',
      startedAt: '2026-06-03T10:20:00.000Z',
      completedAt: '2026-06-03T10:20:00.000Z',
      resources: [
        { resource: 'invoices', status: 'complete', objectCount: 1, pageCount: 1, error: undefined },
        { resource: 'customers', status: 'complete', objectCount: 1, pageCount: 1, error: undefined },
      ],
    })
    await expect(syncRunStore.listByWorkspace(connection.workspaceId)).resolves.toEqual([run])
    await expect(snapshotStore.listByWorkspace(connection.workspaceId)).resolves.toEqual([
      {
        id: 'stripe_snapshot_stripe_sync_workspace_northstar_june_2026_2026_06_03T10_20_00_000Z_invoices_in_001',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        connectionId: connection.id,
        syncRunId: run.id,
        resource: 'invoices',
        objectId: 'in_001',
        object: { id: 'in_001', amount_due: 12000 },
        syncedAt: '2026-06-03T10:20:00.000Z',
      },
      {
        id: 'stripe_snapshot_stripe_sync_workspace_northstar_june_2026_2026_06_03T10_20_00_000Z_customers_cus_001',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        connectionId: connection.id,
        syncRunId: run.id,
        resource: 'customers',
        objectId: 'cus_001',
        object: { id: 'cus_001', email: 'finance@northstar.ai' },
        syncedAt: '2026-06-03T10:20:00.000Z',
      },
    ])
    await expect(syncRunStore.list()).resolves.not.toContainEqual(expect.objectContaining({ secretKey: 'sk_live_sensitive_secret' }))
    await expect(snapshotStore.list()).resolves.not.toContainEqual(expect.objectContaining({ secretKey: 'sk_live_sensitive_secret' }))
  })

  it('normalizes synced Stripe customer, invoice, and subscription snapshots into parsed records', async () => {
    const connection = createStripeConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_customer_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    const syncRunStore = new JsonStripeSyncRunStore(join(tempDir, 'stripe-sync-runs.json'))
    const snapshotStore = new JsonStripeResourceSnapshotStore(join(tempDir, 'stripe-resource-snapshots.json'))
    const fetchImpl = async (url: string) => {
      if (url === 'https://api.stripe.com/v1/customers?limit=100') {
        return stripeResponse({
          data: [{ id: 'cus_001', email: 'finance@northstar.ai', name: 'Northstar AI', created: 1777593600, currency: 'eur', delinquent: false }],
          has_more: false,
        })
      }

      if (url === 'https://api.stripe.com/v1/invoices?limit=100') {
        return stripeResponse({
          data: [
            {
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
            },
          ],
          has_more: false,
        })
      }

      if (url === 'https://api.stripe.com/v1/subscriptions?limit=100&status=all') {
        return stripeResponse({
          data: [
            {
              id: 'sub_001',
              customer: 'cus_001',
              status: 'canceled',
              current_period_start: 1777593600,
              current_period_end: 1780185600,
              canceled_at: 1778803200,
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
            },
          ],
          has_more: false,
        })
      }

      if (url === 'https://api.stripe.com/v1/prices?limit=100') {
        return stripeResponse({ data: [{ id: 'price_enterprise' }], has_more: false })
      }

      throw new Error(`Unexpected request: ${url}`)
    }
    const run = await runAndPersistStripeReadOnlySync({
      connection,
      secretKey: 'sk_live_sensitive_secret',
      requestedBy: 'internal_admin',
      resources: ['customers', 'invoices', 'subscriptions', 'prices'],
      fetchImpl,
      syncRunStore,
      snapshotStore,
      now: new Date('2026-06-03T10:20:00.000Z'),
    })
    const execution = await normalizeStripeSyncSnapshotsToParseExecution({
      syncRun: run,
      snapshots: await snapshotStore.listByWorkspace(connection.workspaceId),
      now: new Date('2026-06-03T10:21:00.000Z'),
    })

    expect(execution.job).toEqual({
      id: 'parse_stripe_sync_workspace_northstar_june_2026_2026_06_03T10_20_00_000Z',
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      uploadId: run.id,
      sourceFileId: 'src_stripe_sync_workspace_northstar_june_2026_2026_06_03T10_20_00_000Z',
      filename: 'Stripe API sync 2026-06-03T10:20:00.000Z',
      category: 'stripe_api_sync',
      parser: 'stripe_api_sync',
      status: 'complete',
      recordCount: 3,
      errorCount: 0,
      errors: [],
      ranAt: '2026-06-03T10:21:00.000Z',
    })
    expect(execution.records).toEqual([
      expect.objectContaining({
        id: `${execution.job.id}_customers_cus_001`,
        jobId: execution.job.id,
        uploadId: run.id,
        sourceFileId: execution.job.sourceFileId,
        recordType: 'customer',
        data: expect.objectContaining({
          displayName: 'Northstar AI',
          primaryEmail: 'finance@northstar.ai',
          externalIds: { stripeCustomerId: 'cus_001' },
          metadata: expect.objectContaining({
            source: 'stripe_api_sync',
            stripeResource: 'customers',
            stripeObjectId: 'cus_001',
            syncRunId: run.id,
          }),
        }),
      }),
      expect.objectContaining({
        id: `${execution.job.id}_invoices_in_001`,
        recordType: 'invoice_line',
        data: expect.objectContaining({
          invoiceId: 'in_001',
          externalCustomerId: 'cus_001',
          customerEmail: 'finance@northstar.ai',
          description: 'May token overage',
          amount: 19950,
          currency: 'eur',
          status: 'paid',
          periodStart: '2026-05-01T00:00:00.000Z',
          periodEnd: '2026-05-31T00:00:00.000Z',
        }),
      }),
      expect.objectContaining({
        id: `${execution.job.id}_subscriptions_sub_001`,
        recordType: 'subscription',
        data: expect.objectContaining({
          subscriptionId: 'sub_001',
          externalCustomerId: 'cus_001',
          status: 'canceled',
          product: 'prod_api',
          plan: 'Enterprise Usage',
          currentPeriodStart: '2026-05-01T00:00:00.000Z',
          currentPeriodEnd: '2026-05-31T00:00:00.000Z',
          canceledAt: '2026-05-15T00:00:00.000Z',
        }),
      }),
    ])
  })

  it('reports healthy connector status for a recent complete sync', async () => {
    const connection = createStripeConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_customer_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    const syncRunStore = new JsonStripeSyncRunStore(join(tempDir, 'stripe-sync-runs.json'))
    const snapshotStore = new JsonStripeResourceSnapshotStore(join(tempDir, 'stripe-resource-snapshots.json'))
    const run = await runAndPersistStripeReadOnlySync({
      connection,
      secretKey: 'sk_live_sensitive_secret',
      requestedBy: 'internal_admin',
      resources: ['invoices', 'customers'],
      fetchImpl: async () => stripeResponse({ data: [{ id: 'stripe_object_001' }], has_more: false }),
      syncRunStore,
      snapshotStore,
      now: new Date('2026-06-03T10:20:00.000Z'),
    })

    const health = getStripeConnectorHealth({
      connection,
      syncRuns: [run],
      now: new Date('2026-06-03T11:00:00.000Z'),
    })

    expect(health).toEqual({
      status: 'healthy',
      label: 'Healthy',
      badgeColor: 'green',
      summary: 'Last sync complete with 2 Stripe objects.',
      lastSyncAt: '2026-06-03T10:20:00.000Z',
      objectCount: 2,
      failedResources: [],
      staleCredentials: false,
    })
  })

  it('reports failed resources from the latest Stripe sync', async () => {
    const connection = createStripeConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_customer_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    const syncRunStore = new JsonStripeSyncRunStore(join(tempDir, 'stripe-sync-runs.json'))
    const snapshotStore = new JsonStripeResourceSnapshotStore(join(tempDir, 'stripe-resource-snapshots.json'))
    const run = await runAndPersistStripeReadOnlySync({
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
      syncRunStore,
      snapshotStore,
      now: new Date('2026-06-03T10:20:00.000Z'),
    })

    const health = getStripeConnectorHealth({
      connection,
      syncRuns: [run],
      now: new Date('2026-06-03T11:00:00.000Z'),
    })

    expect(health).toEqual({
      status: 'degraded',
      label: 'Needs attention',
      badgeColor: 'amber',
      summary: 'Latest Stripe sync completed with errors.',
      lastSyncAt: '2026-06-03T10:20:00.000Z',
      objectCount: 1,
      failedResources: [{ resource: 'invoices', error: 'Stripe invoices sync failed with HTTP 401' }],
      staleCredentials: false,
    })
  })

  it('marks Stripe credentials stale when no successful sync has run inside the freshness window', async () => {
    const connection = createStripeConnection(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_sensitive_secret',
        connectedBy: 'user_customer_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )
    const syncRunStore = new JsonStripeSyncRunStore(join(tempDir, 'stripe-sync-runs.json'))
    const snapshotStore = new JsonStripeResourceSnapshotStore(join(tempDir, 'stripe-resource-snapshots.json'))
    const run = await runAndPersistStripeReadOnlySync({
      connection,
      secretKey: 'sk_live_sensitive_secret',
      requestedBy: 'internal_admin',
      resources: ['invoices'],
      fetchImpl: async () => stripeResponse({ data: [{ id: 'in_001' }], has_more: false }),
      syncRunStore,
      snapshotStore,
      now: new Date('2026-05-30T10:20:00.000Z'),
    })

    const health = getStripeConnectorHealth({
      connection,
      syncRuns: [run],
      now: new Date('2026-06-03T11:00:00.000Z'),
      freshnessHours: 48,
    })

    expect(health).toEqual({
      status: 'stale_credentials',
      label: 'Stale credentials',
      badgeColor: 'amber',
      summary: 'Stripe credentials need a fresh successful sync.',
      lastSyncAt: '2026-05-30T10:20:00.000Z',
      objectCount: 1,
      failedResources: [],
      staleCredentials: true,
    })
  })
})

function stripeResponse(payload: { data: Array<{ id: string } & Record<string, unknown>>; has_more: boolean }) {
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
