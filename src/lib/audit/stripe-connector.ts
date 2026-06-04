import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { z } from 'zod'

import { parsedRecordSchema, parseJobSchema, type ParsedRecord, type ParseExecution } from './parse-jobs'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { normalizedCustomerSchema, normalizedInvoiceLineSchema, normalizedSubscriptionSchema } from './schemas'

export const STRIPE_CONNECTOR_API_VERSION = '2026-02-25.clover'

const stripeResourceSchema = z.enum(['invoices', 'customers', 'subscriptions', 'prices', 'products', 'coupons', 'credit_notes'])
const stripeConnectionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  provider: z.literal('stripe'),
  mode: z.literal('read_only'),
  accountLabel: z.string().min(1),
  apiVersion: z.literal(STRIPE_CONNECTOR_API_VERSION),
  secretRef: z.string().min(1),
  status: z.enum(['connected', 'needs_attention']),
  connectedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
const syncPlanResourceSchema = z.object({
  resource: stripeResourceSchema,
  method: z.literal('GET'),
  path: z.string().min(1),
  params: z.record(z.string(), z.string()),
})
const stripeListResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).passthrough()),
  has_more: z.boolean().default(false),
})
const stripeSyncRunResourceSchema = z.object({
  resource: stripeResourceSchema,
  status: z.enum(['complete', 'failed']),
  objectCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
  error: z.string().optional(),
})
const stripeSyncRunSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
  provider: z.literal('stripe'),
  mode: z.literal('read_only'),
  apiVersion: z.literal(STRIPE_CONNECTOR_API_VERSION),
  requestedBy: z.string().min(1),
  status: z.enum(['complete', 'completed_with_errors', 'failed']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  resources: z.array(stripeSyncRunResourceSchema),
})
const stripeResourceSnapshotSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  connectionId: z.string().min(1),
  syncRunId: z.string().min(1),
  resource: stripeResourceSchema,
  objectId: z.string().min(1),
  object: z.object({ id: z.string().min(1) }).passthrough(),
  syncedAt: z.string().datetime(),
})

export type StripeResource = z.infer<typeof stripeResourceSchema>
export type StripeConnection = z.infer<typeof stripeConnectionSchema>
export type StripeSyncPlanResource = z.infer<typeof syncPlanResourceSchema>
export type StripeSyncRun = z.infer<typeof stripeSyncRunSchema>
export type StripeResourceSnapshot = z.infer<typeof stripeResourceSnapshotSchema>
export type StripeConnectorHealth = {
  status: 'not_connected' | 'needs_sync' | 'healthy' | 'degraded' | 'failed' | 'stale_credentials'
  label: string
  badgeColor: 'green' | 'amber' | 'red' | 'zinc'
  summary: string
  lastSyncAt?: string
  objectCount: number
  failedResources: Array<{ resource: StripeResource; error: string }>
  staleCredentials: boolean
}

type StripeFetchResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type StripeFetch = (url: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<StripeFetchResponse>
type StripeFetchedObject = z.infer<typeof stripeListResponseSchema>['data'][number]
type StripeSyncResourceResult = z.infer<typeof stripeSyncRunResourceSchema> & {
  objects: StripeFetchedObject[]
}

const defaultStripeResources: StripeResource[] = ['invoices', 'customers', 'subscriptions', 'prices', 'products', 'coupons', 'credit_notes']

export function createStripeConnection(
  input: {
    organizationId: string
    workspaceId: string
    accountLabel: string
    secretKey: string
    connectedBy: string
  },
  now = new Date(),
): StripeConnection {
  const timestamp = now.toISOString()

  return stripeConnectionSchema.parse({
    id: `stripe_connection_${slug(input.workspaceId)}_${slug(input.accountLabel)}`,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    provider: 'stripe',
    mode: 'read_only',
    accountLabel: input.accountLabel,
    apiVersion: STRIPE_CONNECTOR_API_VERSION,
    secretRef: `stripe_secret_${slug(input.workspaceId)}_${secretFingerprint(input.secretKey)}`,
    status: 'connected',
    connectedBy: input.connectedBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export function buildStripeReadOnlySyncPlan({
  organizationId,
  workspaceId,
  connectionId,
  requestedBy,
  resources = defaultStripeResources,
  now = new Date(),
}: {
  organizationId: string
  workspaceId: string
  connectionId: string
  requestedBy: string
  resources?: StripeResource[]
  now?: Date
}) {
  const requestedAt = now.toISOString()

  return {
    id: `stripe_sync_${slug(workspaceId)}_${timestampSlug(requestedAt)}`,
    organizationId,
    workspaceId,
    connectionId,
    provider: 'stripe' as const,
    mode: 'read_only' as const,
    apiVersion: STRIPE_CONNECTOR_API_VERSION,
    requestedBy,
    requestedAt,
    resources: resources.map(stripeSyncPlanResource),
  }
}

export async function syncStripeReadOnlyResources({
  secretKey,
  resources = defaultStripeResources,
  fetchImpl = globalFetch,
  now = new Date(),
}: {
  secretKey: string
  resources?: StripeResource[]
  fetchImpl?: StripeFetch
  now?: Date
}) {
  const startedAt = now.toISOString()
  const summaries: StripeSyncResourceResult[] = []

  for (const resource of resources) {
    summaries.push(await syncStripeResource({ resource, secretKey, fetchImpl }))
  }

  return {
    provider: 'stripe' as const,
    mode: 'read_only' as const,
    apiVersion: STRIPE_CONNECTOR_API_VERSION,
    startedAt,
    completedAt: now.toISOString(),
    resources: summaries,
  }
}

export async function runAndPersistStripeReadOnlySync({
  connection,
  secretKey,
  requestedBy,
  resources,
  fetchImpl = globalFetch,
  syncRunStore,
  snapshotStore,
  now = new Date(),
}: {
  connection: StripeConnection
  secretKey: string
  requestedBy: string
  resources?: StripeResource[]
  fetchImpl?: StripeFetch
  syncRunStore: JsonStripeSyncRunStore
  snapshotStore: JsonStripeResourceSnapshotStore
  now?: Date
}): Promise<StripeSyncRun> {
  const result = await syncStripeReadOnlyResources({
    secretKey,
    resources,
    fetchImpl,
    now,
  })
  const run = stripeSyncRunSchema.parse({
    id: `stripe_sync_${slug(connection.workspaceId)}_${timestampSlug(result.startedAt)}`,
    organizationId: connection.organizationId,
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    provider: 'stripe',
    mode: 'read_only',
    apiVersion: STRIPE_CONNECTOR_API_VERSION,
    requestedBy,
    status: syncRunStatus(result.resources),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    resources: result.resources.map(({ objects: _objects, ...resource }) => resource),
  })
  const snapshots = result.resources.flatMap((resource) =>
    resource.objects.map((object) =>
      stripeResourceSnapshotSchema.parse({
        id: `stripe_snapshot_${run.id}_${resource.resource}_${slug(object.id)}`,
        organizationId: connection.organizationId,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        syncRunId: run.id,
        resource: resource.resource,
        objectId: object.id,
        object,
        syncedAt: result.completedAt,
      }),
    ),
  )

  await syncRunStore.save(run)
  await snapshotStore.saveMany(snapshots)

  return run
}

export async function normalizeStripeSyncSnapshotsToParseExecution({
  syncRun,
  snapshots,
  now = new Date(),
}: {
  syncRun: StripeSyncRun
  snapshots: StripeResourceSnapshot[]
  now?: Date
}): Promise<ParseExecution> {
  const jobId = `parse_${syncRun.id}`
  const sourceFileId = `src_${syncRun.id}`
  const records: ParsedRecord[] = []
  const errors: Array<{ rowNumber: number; message: string }> = []

  snapshots
    .filter((snapshot) => snapshot.syncRunId === syncRun.id && snapshot.workspaceId === syncRun.workspaceId)
    .forEach((snapshot, index) => {
      try {
        const record = normalizeStripeSnapshot({ snapshot, syncRun, jobId, sourceFileId })

        if (record) {
          records.push(record)
        }
      } catch (error) {
        errors.push({
          rowNumber: index + 1,
          message: error instanceof Error ? error.message : 'Unknown Stripe snapshot normalization error',
        })
      }
    })

  const job = parseJobSchema.parse({
    id: jobId,
    organizationId: syncRun.organizationId,
    workspaceId: syncRun.workspaceId,
    uploadId: syncRun.id,
    sourceFileId,
    filename: `Stripe API sync ${syncRun.startedAt}`,
    category: 'stripe_api_sync',
    parser: 'stripe_api_sync',
    status: parseExecutionStatus(records.length, errors.length),
    recordCount: records.length,
    errorCount: errors.length,
    errors,
    ranAt: now.toISOString(),
  })

  return { job, records }
}

export function getStripeConnectorHealth({
  connection,
  syncRuns,
  now = new Date(),
  freshnessHours = 48,
}: {
  connection: StripeConnection | null
  syncRuns: StripeSyncRun[]
  now?: Date
  freshnessHours?: number
}): StripeConnectorHealth {
  if (!connection) {
    return {
      status: 'not_connected',
      label: 'Not connected',
      badgeColor: 'zinc',
      summary: 'Stripe is not connected.',
      objectCount: 0,
      failedResources: [],
      staleCredentials: false,
    }
  }

  const latestRun = sortSyncRuns(syncRuns.filter((run) => run.connectionId === connection.id))[0]

  if (!latestRun) {
    return {
      status: 'needs_sync',
      label: 'Needs sync',
      badgeColor: 'amber',
      summary: 'Stripe is connected but has not synced yet.',
      objectCount: 0,
      failedResources: [],
      staleCredentials: false,
    }
  }

  const objectCount = stripeSyncObjectCount(latestRun)
  const failedResources = latestRun.resources
    .filter((resource) => resource.status === 'failed')
    .map((resource) => ({
      resource: resource.resource,
      error: resource.error ?? `Stripe ${resource.resource} sync failed`,
    }))

  if (latestRun.status === 'failed') {
    return {
      status: 'failed',
      label: 'Sync failed',
      badgeColor: 'red',
      summary: 'Latest Stripe sync failed.',
      lastSyncAt: latestRun.completedAt,
      objectCount,
      failedResources,
      staleCredentials: false,
    }
  }

  if (latestRun.status === 'completed_with_errors') {
    return {
      status: 'degraded',
      label: 'Needs attention',
      badgeColor: 'amber',
      summary: 'Latest Stripe sync completed with errors.',
      lastSyncAt: latestRun.completedAt,
      objectCount,
      failedResources,
      staleCredentials: false,
    }
  }

  if (isStaleSync(latestRun.completedAt, now, freshnessHours)) {
    return {
      status: 'stale_credentials',
      label: 'Stale credentials',
      badgeColor: 'amber',
      summary: 'Stripe credentials need a fresh successful sync.',
      lastSyncAt: latestRun.completedAt,
      objectCount,
      failedResources: [],
      staleCredentials: true,
    }
  }

  return {
    status: 'healthy',
    label: 'Healthy',
    badgeColor: 'green',
    summary: `Last sync complete with ${objectCount} Stripe ${objectCount === 1 ? 'object' : 'objects'}.`,
    lastSyncAt: latestRun.completedAt,
    objectCount,
    failedResources: [],
    staleCredentials: false,
  }
}

export class JsonStripeConnectionStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<StripeConnection[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(stripeConnectionSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async getByWorkspace(workspaceId: string): Promise<StripeConnection | null> {
    const connections = await this.list()

    return connections.find((connection) => connection.workspaceId === workspaceId) ?? null
  }

  async save(connection: StripeConnection): Promise<void> {
    const connections = await this.list()
    const nextById = new Map(connections.map((existing) => [existing.id, existing]))
    nextById.set(connection.id, connection)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const connections = await this.list()
    const next = connections.filter((connection) => connection.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return connections.length - next.length
  }
}

export class JsonStripeSyncRunStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<StripeSyncRun[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortSyncRuns(z.array(stripeSyncRunSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<StripeSyncRun[]> {
    const runs = await this.list()

    return runs.filter((run) => run.workspaceId === workspaceId)
  }

  async save(run: StripeSyncRun): Promise<void> {
    const runs = await this.list()
    const nextById = new Map(runs.map((existing) => [existing.id, existing]))
    nextById.set(run.id, run)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortSyncRuns([...nextById.values()]), null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const runs = await this.list()
    const next = runs.filter((run) => run.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return runs.length - next.length
  }
}

export class JsonStripeResourceSnapshotStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<StripeResourceSnapshot[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(stripeResourceSnapshotSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<StripeResourceSnapshot[]> {
    const snapshots = await this.list()

    return snapshots.filter((snapshot) => snapshot.workspaceId === workspaceId)
  }

  async saveMany(snapshots: StripeResourceSnapshot[]): Promise<void> {
    const existing = await this.list()
    const nextById = new Map(existing.map((snapshot) => [snapshot.id, snapshot]))

    for (const snapshot of snapshots) {
      nextById.set(snapshot.id, snapshot)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const snapshots = await this.list()
    const next = snapshots.filter((snapshot) => snapshot.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return snapshots.length - next.length
  }
}

function stripeSyncPlanResource(resource: StripeResource): StripeSyncPlanResource {
  return syncPlanResourceSchema.parse({
    resource,
    method: 'GET',
    path: `/v1/${resource}`,
    params: resource === 'subscriptions' ? { limit: '100', status: 'all' } : { limit: '100' },
  })
}

async function syncStripeResource({
  resource,
  secretKey,
  fetchImpl,
}: {
  resource: StripeResource
  secretKey: string
  fetchImpl: StripeFetch
}) {
  const config = stripeSyncPlanResource(resource)
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_CONNECTOR_API_VERSION,
  }
  const objects: StripeFetchedObject[] = []
  let pageCount = 0
  let startingAfter: string | undefined

  while (true) {
    const url = stripeListUrl(config, startingAfter)
    const response = await fetchImpl(url, { method: 'GET', headers })

    if (!response.ok) {
      return {
        resource,
        status: 'failed' as const,
        objectCount: objects.length,
        pageCount,
        error: `Stripe ${resource} sync failed with HTTP ${response.status}`,
        objects,
      }
    }

    const page = stripeListResponseSchema.parse(await response.json())
    pageCount += 1
    objects.push(...page.data)

    if (!page.has_more || page.data.length === 0) {
      return {
        resource,
        status: 'complete' as const,
        objectCount: objects.length,
        pageCount,
        error: undefined,
        objects,
      }
    }

    startingAfter = page.data[page.data.length - 1]?.id
  }
}

function stripeListUrl(config: StripeSyncPlanResource, startingAfter?: string): string {
  const params = new URLSearchParams(config.params)

  if (startingAfter) {
    params.set('starting_after', startingAfter)
  }

  return `https://api.stripe.com${config.path}?${params.toString()}`
}

function syncRunStatus(resources: StripeSyncResourceResult[]): StripeSyncRun['status'] {
  const failedCount = resources.filter((resource) => resource.status === 'failed').length

  if (failedCount === 0) {
    return 'complete'
  }

  return failedCount === resources.length ? 'failed' : 'completed_with_errors'
}

function stripeSyncObjectCount(syncRun: StripeSyncRun): number {
  return syncRun.resources.reduce((total, resource) => total + resource.objectCount, 0)
}

function isStaleSync(completedAt: string, now: Date, freshnessHours: number): boolean {
  return now.getTime() - new Date(completedAt).getTime() > freshnessHours * 60 * 60 * 1000
}

function normalizeStripeSnapshot({
  snapshot,
  syncRun,
  jobId,
  sourceFileId,
}: {
  snapshot: StripeResourceSnapshot
  syncRun: StripeSyncRun
  jobId: string
  sourceFileId: string
}): ParsedRecord | null {
  if (snapshot.resource === 'customers') {
    return createStripeParsedRecord({
      snapshot,
      syncRun,
      jobId,
      sourceFileId,
      recordType: 'customer',
      data: normalizeStripeCustomer(snapshot, syncRun, sourceFileId),
    })
  }

  if (snapshot.resource === 'invoices') {
    return createStripeParsedRecord({
      snapshot,
      syncRun,
      jobId,
      sourceFileId,
      recordType: 'invoice_line',
      data: normalizeStripeInvoice(snapshot, syncRun, sourceFileId),
    })
  }

  if (snapshot.resource === 'subscriptions') {
    return createStripeParsedRecord({
      snapshot,
      syncRun,
      jobId,
      sourceFileId,
      recordType: 'subscription',
      data: normalizeStripeSubscription(snapshot, syncRun, sourceFileId),
    })
  }

  return null
}

function normalizeStripeCustomer(snapshot: StripeResourceSnapshot, syncRun: StripeSyncRun, sourceFileId: string) {
  const object = snapshot.object
  const email = validEmail(readString(object, 'email'))
  const displayName = readString(object, 'name') ?? email ?? snapshot.objectId

  return normalizedCustomerSchema.parse({
    id: `${sourceFileId}:customers:${snapshot.objectId}`,
    organizationId: syncRun.organizationId,
    workspaceId: syncRun.workspaceId,
    displayName,
    primaryEmail: email,
    externalIds: {
      stripeCustomerId: snapshot.objectId,
    },
    sourceRefs: stripeSourceRefs(sourceFileId, snapshot),
    metadata: stripeMetadata(snapshot, syncRun, {
      createdAt: optionalStripeTimestampToIso(object.created),
      currency: readString(object, 'currency'),
      delinquent: readBoolean(object, 'delinquent'),
    }),
  })
}

function normalizeStripeInvoice(snapshot: StripeResourceSnapshot, syncRun: StripeSyncRun, sourceFileId: string) {
  const object = snapshot.object
  const amount = readInteger(object, 'amount_due') ?? readInteger(object, 'total') ?? readInteger(object, 'amount_paid')

  if (amount === undefined) {
    throw new Error(`Stripe invoice ${snapshot.objectId} is missing an amount`)
  }

  return normalizedInvoiceLineSchema.parse({
    id: `${sourceFileId}:invoices:${snapshot.objectId}`,
    organizationId: syncRun.organizationId,
    workspaceId: syncRun.workspaceId,
    invoiceId: snapshot.objectId,
    externalCustomerId: stripeObjectId(readValue(object, 'customer')),
    customerEmail: validEmail(readString(object, 'customer_email')),
    description: readString(object, 'description') ?? readString(object, 'number') ?? `Stripe invoice ${snapshot.objectId}`,
    amount,
    currency: requiredString(object, 'currency', `Stripe invoice ${snapshot.objectId} is missing currency`),
    status: normalizeInvoiceStatus(requiredString(object, 'status', `Stripe invoice ${snapshot.objectId} is missing status`)),
    periodStart: stripeTimestampToIso(readValue(object, 'period_start'), `Stripe invoice ${snapshot.objectId} is missing period_start`),
    periodEnd: stripeTimestampToIso(readValue(object, 'period_end'), `Stripe invoice ${snapshot.objectId} is missing period_end`),
    sourceRefs: stripeSourceRefs(sourceFileId, snapshot),
    metadata: stripeMetadata(snapshot, syncRun, {
      billingReason: readString(object, 'billing_reason'),
      finalizedAt: optionalStripeTimestampToIso(readValue(object, 'finalized_at')),
      hostedInvoiceUrl: readString(object, 'hosted_invoice_url'),
      invoicePdf: readString(object, 'invoice_pdf'),
      total: readInteger(object, 'total'),
      amountPaid: readInteger(object, 'amount_paid'),
      amountRemaining: readInteger(object, 'amount_remaining'),
    }),
  })
}

function normalizeStripeSubscription(snapshot: StripeResourceSnapshot, syncRun: StripeSyncRun, sourceFileId: string) {
  const object = snapshot.object
  const firstItem = readRecord(readArray(readRecord(object, 'items'), 'data')[0])
  const price = readRecord(firstItem, 'price')

  return normalizedSubscriptionSchema.parse({
    id: `${sourceFileId}:subscriptions:${snapshot.objectId}`,
    organizationId: syncRun.organizationId,
    workspaceId: syncRun.workspaceId,
    subscriptionId: snapshot.objectId,
    externalCustomerId: stripeObjectId(readValue(object, 'customer')),
    status: normalizeSubscriptionStatus(requiredString(object, 'status', `Stripe subscription ${snapshot.objectId} is missing status`)),
    product: stripeObjectId(readValue(price, 'product')) ?? readString(readRecord(readValue(price, 'product')), 'name'),
    plan: readString(price, 'nickname') ?? readString(price, 'lookup_key') ?? stripeObjectId(price) ?? stripeObjectId(readValue(object, 'plan')),
    currentPeriodStart: stripeTimestampToIso(
      readValue(object, 'current_period_start') ?? readValue(firstItem, 'current_period_start'),
      `Stripe subscription ${snapshot.objectId} is missing current_period_start`,
    ),
    currentPeriodEnd: stripeTimestampToIso(
      readValue(object, 'current_period_end') ?? readValue(firstItem, 'current_period_end'),
      `Stripe subscription ${snapshot.objectId} is missing current_period_end`,
    ),
    canceledAt: optionalStripeTimestampToIso(readValue(object, 'canceled_at')),
    endedAt: optionalStripeTimestampToIso(readValue(object, 'ended_at')),
    sourceRefs: stripeSourceRefs(sourceFileId, snapshot),
    metadata: stripeMetadata(snapshot, syncRun, {
      cancelAtPeriodEnd: readBoolean(object, 'cancel_at_period_end'),
      priceId: stripeObjectId(price),
    }),
  })
}

function createStripeParsedRecord({
  snapshot,
  syncRun,
  jobId,
  sourceFileId,
  recordType,
  data,
}: {
  snapshot: StripeResourceSnapshot
  syncRun: StripeSyncRun
  jobId: string
  sourceFileId: string
  recordType: ParsedRecord['recordType']
  data: Record<string, unknown>
}): ParsedRecord {
  return parsedRecordSchema.parse({
    id: `${jobId}_${snapshot.resource}_${slug(snapshot.objectId)}`,
    organizationId: syncRun.organizationId,
    workspaceId: syncRun.workspaceId,
    jobId,
    uploadId: syncRun.id,
    sourceFileId,
    recordType,
    data,
  })
}

function parseExecutionStatus(recordCount: number, errorCount: number): 'complete' | 'completed_with_errors' | 'failed' {
  if (errorCount === 0) {
    return 'complete'
  }

  return recordCount > 0 ? 'completed_with_errors' : 'failed'
}

function stripeSourceRefs(sourceFileId: string, snapshot: StripeResourceSnapshot) {
  return [{ sourceFileId, column: `stripe.${snapshot.resource}.${snapshot.objectId}` }]
}

function stripeMetadata(snapshot: StripeResourceSnapshot, syncRun: StripeSyncRun, extra: Record<string, unknown | undefined> = {}) {
  return compactMetadata({
    source: 'stripe_api_sync',
    stripeResource: snapshot.resource,
    stripeObjectId: snapshot.objectId,
    stripeSnapshotId: snapshot.id,
    syncRunId: syncRun.id,
    connectionId: syncRun.connectionId,
    syncedAt: snapshot.syncedAt,
    ...extra,
  })
}

function requiredString(object: Record<string, unknown>, key: string, message: string): string {
  const value = readString(object, key)

  if (!value) {
    throw new Error(message)
  }

  return value
}

function readValue(object: Record<string, unknown>, key: string): unknown {
  return object[key]
}

function readString(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readInteger(object: Record<string, unknown>, key: string): number | undefined {
  const value = object[key]

  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function readBoolean(object: Record<string, unknown>, key: string): boolean | undefined {
  const value = object[key]

  return typeof value === 'boolean' ? value : undefined
}

function readRecord(value: unknown, key?: string): Record<string, unknown> {
  const candidate = key && typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : value

  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : {}
}

function readArray(object: Record<string, unknown>, key: string): unknown[] {
  const value = object[key]

  return Array.isArray(value) ? value : []
}

function validEmail(value: string | undefined): string | undefined {
  return value && z.string().email().safeParse(value).success ? value : undefined
}

function stripeObjectId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return readString(value as Record<string, unknown>, 'id')
  }

  return undefined
}

function stripeTimestampToIso(value: unknown, message: string): string {
  const timestamp = optionalStripeTimestampToIso(value)

  if (!timestamp) {
    throw new Error(message)
  }

  return timestamp
}

function optionalStripeTimestampToIso(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(String(value))

  if (Number.isNaN(date.getTime())) {
    return undefined
  }

  return date.toISOString()
}

function compactMetadata(metadata: Record<string, unknown | undefined>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined))
}

function normalizeInvoiceStatus(value: string) {
  const status = value.trim().toLowerCase().replace(/\s+/g, '_')

  if (status === 'draft' || status === 'open' || status === 'paid' || status === 'void' || status === 'uncollectible') {
    return status
  }

  throw new Error(`Unsupported Stripe invoice status: ${value}`)
}

function normalizeSubscriptionStatus(value: string) {
  const status = value.trim().toLowerCase().replace(/\s+/g, '_').replace('cancelled', 'canceled')

  if (
    status === 'active' ||
    status === 'trialing' ||
    status === 'past_due' ||
    status === 'unpaid' ||
    status === 'paused' ||
    status === 'canceled' ||
    status === 'incomplete' ||
    status === 'incomplete_expired'
  ) {
    return status
  }

  throw new Error(`Unsupported Stripe subscription status: ${value}`)
}

function sortSyncRuns(runs: StripeSyncRun[]): StripeSyncRun[] {
  return [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

async function globalFetch(url: string, init: { method: 'GET'; headers: Record<string, string> }): Promise<StripeFetchResponse> {
  return fetch(url, init)
}

function secretFingerprint(secretKey: string): string {
  return createHash('sha256').update(secretKey).digest('hex').slice(0, 12)
}

function timestampSlug(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
