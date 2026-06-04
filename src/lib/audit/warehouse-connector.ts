import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { z } from 'zod'

import { runParseForUploadWithRecords, type JsonParsedRecordStore, type JsonParseJobStore, type ParseExecution } from './parse-jobs'
import { type UsageCsvMapping } from './parsers'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { createUploadRecord, type JsonUploadStore, type UploadRecord, type UploadStorage } from './uploads'

const warehouseScheduleSchema = z.enum(['manual', 'daily', 'weekly', 'monthly'])
const usageCsvMappingSchema = z.object({
  accountId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  meter: z.string().min(1),
  quantity: z.string().min(1),
  unit: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
})
const warehouseCsvConnectionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  provider: z.literal('warehouse_csv'),
  mode: z.literal('read_only'),
  sourceLabel: z.string().min(1),
  schedule: warehouseScheduleSchema,
  secretRef: z.string().min(1),
  status: z.enum(['connected', 'needs_attention']),
  connectedBy: z.string().min(1),
  usageCsvMapping: usageCsvMappingSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type WarehouseSchedule = z.infer<typeof warehouseScheduleSchema>
export type WarehouseCsvConnection = z.infer<typeof warehouseCsvConnectionSchema>

type WarehouseFetchResponse = {
  ok: boolean
  status: number
  text(): Promise<string>
}

type WarehouseFetch = (url: string) => Promise<WarehouseFetchResponse>

export type WarehouseCsvSyncResult = ParseExecution & {
  upload: UploadRecord
}

export function createWarehouseCsvConnection(
  input: {
    organizationId: string
    workspaceId: string
    sourceLabel: string
    exportUrl: string
    schedule: WarehouseSchedule
    connectedBy: string
    usageCsvMapping: UsageCsvMapping
  },
  now = new Date(),
): WarehouseCsvConnection {
  const timestamp = now.toISOString()

  return warehouseCsvConnectionSchema.parse({
    id: `warehouse_csv_connection_${slug(input.workspaceId)}_${slug(input.sourceLabel)}`,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    provider: 'warehouse_csv',
    mode: 'read_only',
    sourceLabel: input.sourceLabel,
    schedule: input.schedule,
    secretRef: `warehouse_csv_export_${slug(input.workspaceId)}_${secretFingerprint(input.exportUrl)}`,
    status: 'connected',
    connectedBy: input.connectedBy,
    usageCsvMapping: input.usageCsvMapping,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export async function runAndPersistWarehouseCsvSync({
  connection,
  exportUrl,
  requestedBy,
  fetchImpl = globalFetch,
  uploadStore,
  uploadStorage,
  parseJobStore,
  parsedRecordStore,
  now = new Date(),
}: {
  connection: WarehouseCsvConnection
  exportUrl: string
  requestedBy: string
  fetchImpl?: WarehouseFetch
  uploadStore: JsonUploadStore
  uploadStorage: UploadStorage
  parseJobStore: JsonParseJobStore
  parsedRecordStore: JsonParsedRecordStore
  now?: Date
}): Promise<WarehouseCsvSyncResult> {
  const response = await fetchImpl(exportUrl)

  if (!response.ok) {
    throw new Error(`Warehouse CSV export sync failed with HTTP ${response.status}`)
  }

  const csv = await response.text()
  const saved = await uploadStorage.save({
    workspaceId: connection.workspaceId,
    category: 'usage_csv',
    filename: warehouseUsageFilename(now),
    bytes: Buffer.from(csv, 'utf8'),
    contentType: 'text/csv',
  })
  const upload = createUploadRecord(
    {
      organizationId: connection.organizationId,
      workspaceId: connection.workspaceId,
      category: 'usage_csv',
      filename: warehouseUsageFilename(now),
      uploadedBy: requestedBy,
      metadata: {
        source: 'warehouse_csv_export',
        connectionId: connection.id,
        sourceLabel: connection.sourceLabel,
        schedule: connection.schedule,
        usageCsvMapping: connection.usageCsvMapping,
      },
      ...saved,
    },
    now,
  )
  const execution = await runParseForUploadWithRecords(upload, uploadStorage, now)

  await uploadStore.save(upload)
  await parseJobStore.save(execution.job)
  await parsedRecordStore.saveMany(execution.records)

  return {
    upload,
    ...execution,
  }
}

export class JsonWarehouseCsvConnectionStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<WarehouseCsvConnection[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(warehouseCsvConnectionSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async getByWorkspace(workspaceId: string): Promise<WarehouseCsvConnection | null> {
    const connections = await this.list()

    return connections.find((connection) => connection.workspaceId === workspaceId) ?? null
  }

  async save(connection: WarehouseCsvConnection): Promise<void> {
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

async function globalFetch(url: string): Promise<WarehouseFetchResponse> {
  return fetch(url)
}

function warehouseUsageFilename(now: Date): string {
  return `warehouse-usage-${timestampSlug(now.toISOString())}.csv`
}

function secretFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
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
