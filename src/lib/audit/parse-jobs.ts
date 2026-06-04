import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import {
  parseAccountMappingCsv,
  parseCreditsAllowancesCsv,
  parseProviderCostCsv,
  parseStripeCustomerCsv,
  parseStripeInvoiceCsv,
  parseStripeSubscriptionCsv,
  parseUsageCsv,
  type ParseError,
  type ProviderCostCsvMapping,
  type UsageCsvMapping,
} from './parsers'
import { type UploadRecord, type UploadStorage } from './uploads'

export const parseJobStatusSchema = z.enum(['complete', 'completed_with_errors', 'failed', 'unsupported'])
export const parserKindSchema = z.enum([
  'stripe_invoices_export',
  'stripe_customers_export',
  'stripe_subscriptions_export',
  'stripe_api_sync',
  'usage_csv',
  'account_mapping_csv',
  'credits_allowances_csv',
  'provider_cost_csv',
  'unsupported',
])
export const parsedRecordTypeSchema = z.enum(['customer', 'usage', 'invoice_line', 'subscription', 'mapping', 'contract_term', 'cost'])

export const parseJobSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  uploadId: z.string().min(1),
  sourceFileId: z.string().min(1),
  filename: z.string().min(1),
  category: z.string().min(1),
  parser: parserKindSchema,
  status: parseJobStatusSchema,
  recordCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errors: z.array(z.object({ rowNumber: z.number().int().positive(), message: z.string().min(1) })),
  ranAt: z.string().datetime(),
})

export type ParseJob = z.infer<typeof parseJobSchema>

export const parsedRecordSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  jobId: z.string().min(1),
  uploadId: z.string().min(1),
  sourceFileId: z.string().min(1),
  recordType: parsedRecordTypeSchema,
  sourceRowNumber: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown()),
})

export type ParsedRecord = z.infer<typeof parsedRecordSchema>

export type ParseExecution = {
  job: ParseJob
  records: ParsedRecord[]
}

const defaultUsageCsvMapping = {
  accountId: 'account_id',
  customerName: 'customer_name',
  meter: 'meter_name',
  quantity: 'total',
  unit: 'unit',
  periodStart: 'start',
  periodEnd: 'end',
} satisfies UsageCsvMapping

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

const providerCostCsvMappingSchema = z.object({
  accountId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  provider: z.string().min(1),
  product: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  costAmount: z.string().min(1),
  currency: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
})

export async function runParseForUpload(upload: UploadRecord, storage: UploadStorage, now = new Date()): Promise<ParseJob> {
  const execution = await runParseForUploadWithRecords(upload, storage, now)

  return execution.job
}

export async function runParseForUploadWithRecords(
  upload: UploadRecord,
  storage: UploadStorage,
  now = new Date(),
): Promise<ParseExecution> {
  if (upload.category === 'stripe_invoices_export') {
    return runSupportedParser(
      upload,
      'stripe_invoices_export',
      'invoice_line',
      storage,
      (csv) =>
        parseStripeInvoiceCsv(csv, {
          organizationId: upload.organizationId,
          workspaceId: upload.workspaceId,
          sourceFileId: upload.sourceFileId,
        }),
      now,
    )
  }

  if (upload.category === 'stripe_customers_export') {
    return runSupportedParser(
      upload,
      'stripe_customers_export',
      'customer',
      storage,
      (csv) =>
        parseStripeCustomerCsv(csv, {
          organizationId: upload.organizationId,
          workspaceId: upload.workspaceId,
          sourceFileId: upload.sourceFileId,
        }),
      now,
    )
  }

  if (upload.category === 'usage_csv') {
    return runSupportedParser(
      upload,
      'usage_csv',
      'usage',
      storage,
      (csv) =>
        parseUsageCsv(
          csv,
          usageCsvMappingForUpload(upload),
          {
            organizationId: upload.organizationId,
            workspaceId: upload.workspaceId,
            sourceFileId: upload.sourceFileId,
          },
        ),
      now,
    )
  }

  if (upload.category === 'stripe_subscriptions_export') {
    return runSupportedParser(
      upload,
      'stripe_subscriptions_export',
      'subscription',
      storage,
      (csv) =>
        parseStripeSubscriptionCsv(csv, {
          organizationId: upload.organizationId,
          workspaceId: upload.workspaceId,
          sourceFileId: upload.sourceFileId,
        }),
      now,
    )
  }

  if (upload.category === 'provider_cost_csv') {
    return runSupportedParser(
      upload,
      'provider_cost_csv',
      'cost',
      storage,
      (csv) =>
        parseProviderCostCsv(
          csv,
          {
            organizationId: upload.organizationId,
            workspaceId: upload.workspaceId,
            sourceFileId: upload.sourceFileId,
          },
          providerCostCsvMappingForUpload(upload),
        ),
      now,
    )
  }

  if (upload.category === 'account_mapping_csv') {
    return runSupportedParser(
      upload,
      'account_mapping_csv',
      'mapping',
      storage,
      (csv) =>
        parseAccountMappingCsv(csv, {
          organizationId: upload.organizationId,
          workspaceId: upload.workspaceId,
          sourceFileId: upload.sourceFileId,
        }),
      now,
    )
  }

  if (upload.category === 'credits_allowances_csv') {
    return runSupportedParser(
      upload,
      'credits_allowances_csv',
      'contract_term',
      storage,
      (csv) =>
        parseCreditsAllowancesCsv(csv, {
          organizationId: upload.organizationId,
          workspaceId: upload.workspaceId,
          sourceFileId: upload.sourceFileId,
        }),
      now,
    )
  }

  return {
    job: createJob(
      upload,
      'unsupported',
      'unsupported',
      0,
      [{ rowNumber: 1, message: `No V0 parser is available for ${upload.category}` }],
      now,
    ),
    records: [],
  }
}

function usageCsvMappingForUpload(upload: UploadRecord): UsageCsvMapping {
  const mapping = upload.metadata.usageCsvMapping

  return mapping === undefined ? defaultUsageCsvMapping : usageCsvMappingSchema.parse(mapping)
}

function providerCostCsvMappingForUpload(upload: UploadRecord): ProviderCostCsvMapping | undefined {
  const mapping = upload.metadata.providerCostCsvMapping

  return mapping === undefined ? undefined : providerCostCsvMappingSchema.parse(mapping)
}

export class JsonParseJobStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ParseJob[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(parseJobSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<ParseJob[]> {
    const jobs = await this.list()

    return jobs
      .filter((job) => job.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())
  }

  async save(job: ParseJob): Promise<void> {
    const jobs = await this.list()
    const next = [...jobs.filter((existing) => existing.id !== job.id), job]

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const jobs = await this.list()
    const next = jobs.filter((job) => job.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return jobs.length - next.length
  }
}

export class JsonParsedRecordStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ParsedRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(parsedRecordSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByJob(jobId: string): Promise<ParsedRecord[]> {
    const records = await this.list()

    return records.filter((record) => record.jobId === jobId)
  }

  async listByWorkspace(workspaceId: string): Promise<ParsedRecord[]> {
    const records = await this.list()

    return records.filter((record) => record.workspaceId === workspaceId)
  }

  async saveMany(records: ParsedRecord[]): Promise<void> {
    const existing = await this.list()
    const nextById = new Map(existing.map((record) => [record.id, record]))

    for (const record of records) {
      nextById.set(record.id, record)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const records = await this.list()
    const next = records.filter((record) => record.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return records.length - next.length
  }
}

async function runSupportedParser<T>(
  upload: UploadRecord,
  parser: Exclude<z.infer<typeof parserKindSchema>, 'unsupported'>,
  recordType: z.infer<typeof parsedRecordTypeSchema>,
  storage: UploadStorage,
  parseCsv: (csv: string) => { records: T[]; errors: ParseError[] },
  now: Date,
): Promise<ParseExecution> {
  try {
    const csv = await storage.readText(upload.storageKey)
    const result = parseCsv(csv)
    const status = result.errors.length > 0 ? 'completed_with_errors' : 'complete'
    const job = createJob(upload, parser, status, result.records.length, result.errors, now)

    return {
      job,
      records: result.records.map((record, index) => createParsedRecord(upload, job.id, recordType, record, index)),
    }
  } catch (error) {
    return {
      job: createJob(
        upload,
        parser,
        'failed',
        0,
        [{ rowNumber: 1, message: error instanceof Error ? error.message : 'Unknown parser failure' }],
        now,
      ),
      records: [],
    }
  }
}

function createParsedRecord<T>(
  upload: UploadRecord,
  jobId: string,
  recordType: z.infer<typeof parsedRecordTypeSchema>,
  record: T,
  index: number,
): ParsedRecord {
  return parsedRecordSchema.parse({
    id: `parsed_${jobId}_${index + 1}`,
    organizationId: upload.organizationId,
    workspaceId: upload.workspaceId,
    jobId,
    uploadId: upload.id,
    sourceFileId: upload.sourceFileId,
    recordType,
    sourceRowNumber: getSourceRowNumber(record),
    data: record,
  })
}

function createJob(
  upload: UploadRecord,
  parser: z.infer<typeof parserKindSchema>,
  status: z.infer<typeof parseJobStatusSchema>,
  recordCount: number,
  errors: ParseError[],
  now: Date,
): ParseJob {
  return parseJobSchema.parse({
    id: `parse_${upload.id}`,
    organizationId: upload.organizationId,
    workspaceId: upload.workspaceId,
    uploadId: upload.id,
    sourceFileId: upload.sourceFileId,
    filename: upload.filename,
    category: upload.category,
    parser,
    status,
    recordCount,
    errorCount: errors.length,
    errors,
    ranAt: now.toISOString(),
  })
}

function getSourceRowNumber(record: unknown): number | undefined {
  if (typeof record !== 'object' || record === null) {
    return undefined
  }

  if ('sourceRefs' in record && Array.isArray(record.sourceRefs)) {
    const firstRef = record.sourceRefs[0]

    if (typeof firstRef === 'object' && firstRef !== null && 'rowNumber' in firstRef && typeof firstRef.rowNumber === 'number') {
      return firstRef.rowNumber
    }
  }

  if ('metadata' in record && typeof record.metadata === 'object' && record.metadata !== null && !Array.isArray(record.metadata)) {
    const metadata = record.metadata as Record<string, unknown>

    if (typeof metadata.sourceRowNumber === 'number') {
      return metadata.sourceRowNumber
    }
  }

  return undefined
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
