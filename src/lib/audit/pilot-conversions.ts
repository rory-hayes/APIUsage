import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'

export const pilotConversionStatusSchema = z.enum(['not_offered', 'offered', 'converted', 'declined'])

export const pilotConversionRecordSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  currency: z.string().trim().min(3).max(3).transform((value) => value.toLowerCase()).default('eur'),
  auditFeeAmount: z.number().int().nonnegative().optional(),
  monitoringOfferAmount: z.number().int().nonnegative().optional(),
  conversionStatus: pilotConversionStatusSchema.default('not_offered'),
  renewalDate: z.string().date().optional(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type PilotConversionStatus = z.infer<typeof pilotConversionStatusSchema>
export type PilotConversionRecord = z.infer<typeof pilotConversionRecordSchema>

export type CreatePilotConversionRecordInput = {
  organizationId: string
  organizationName: string
  currency?: string
  auditFeeAmount?: number
  monitoringOfferAmount?: number
  conversionStatus?: PilotConversionStatus
  renewalDate?: string
  updatedBy: string
  metadata?: Record<string, unknown>
}

export function createPilotConversionRecord(input: CreatePilotConversionRecordInput, now = new Date()): PilotConversionRecord {
  const organizationId = input.organizationId.trim()

  return pilotConversionRecordSchema.parse({
    id: `pilot_conversion_${slug(organizationId)}`,
    organizationId,
    organizationName: input.organizationName.trim(),
    currency: input.currency ?? 'eur',
    auditFeeAmount: input.auditFeeAmount,
    monitoringOfferAmount: input.monitoringOfferAmount,
    conversionStatus: input.conversionStatus ?? 'not_offered',
    renewalDate: trimToUndefined(input.renewalDate),
    updatedBy: input.updatedBy,
    updatedAt: now.toISOString(),
    metadata: input.metadata ?? {},
  })
}

export function createPilotConversionRecordFromFormData(formData: FormData, updatedBy: string, now = new Date()): PilotConversionRecord {
  return createPilotConversionRecord(
    {
      organizationId: requiredString(formData, 'organizationId'),
      organizationName: requiredString(formData, 'organizationName'),
      currency: optionalString(formData, 'currency') ?? 'eur',
      auditFeeAmount: optionalMoneyMinorUnits(formData.get('auditFeeAmount')),
      monitoringOfferAmount: optionalMoneyMinorUnits(formData.get('monitoringOfferAmount')),
      conversionStatus: pilotConversionStatusSchema.parse(formData.get('conversionStatus') || 'not_offered'),
      renewalDate: optionalString(formData, 'renewalDate'),
      updatedBy,
    },
    now,
  )
}

export class JsonPilotConversionStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<PilotConversionRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortRecords(z.array(pilotConversionRecordSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async getByOrganization(organizationId: string): Promise<PilotConversionRecord | null> {
    const records = await this.list()

    return records.find((record) => record.organizationId === organizationId) ?? null
  }

  async save(record: PilotConversionRecord): Promise<void> {
    const records = await this.list()
    const nextByOrganization = new Map(records.map((existing) => [existing.organizationId, existing]))
    nextByOrganization.set(record.organizationId, record)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortRecords([...nextByOrganization.values()]), null, 2), 'utf8')
  }
}

function optionalMoneyMinorUnits(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined
  }

  const normalized = value.trim()

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Invalid money amount: ${normalized}`)
  }

  const [whole, fractional = ''] = normalized.split('.')

  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fractional.padEnd(2, '0'), 10)
}

function sortRecords(records: PilotConversionRecord[]): PilotConversionRecord[] {
  return [...records].sort((a, b) => a.organizationName.localeCompare(b.organizationName))
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key)

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required pilot conversion field: ${key}`)
  }

  return value
}

function optionalString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)

  return typeof value === 'string' ? trimToUndefined(value) : undefined
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed ? trimmed : undefined
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
