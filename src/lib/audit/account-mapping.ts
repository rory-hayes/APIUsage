import { dirname } from 'node:path'
import { z } from 'zod'

import { type ParsedRecord } from './parse-jobs'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { evidenceRefSchema } from './schemas'

export const accountMappingStatusSchema = z.enum(['suggested', 'approved', 'manual_override', 'rejected'])
export const accountMappingSourceSchema = z.enum(['system', 'manual'])

export const accountMappingSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  displayName: z.string().min(1),
  status: accountMappingStatusSchema,
  source: accountMappingSourceSchema,
  confidence: z.number().min(0).max(1),
  usageAccountId: z.string().min(1).optional(),
  usageCustomerId: z.string().min(1).optional(),
  usageCustomerName: z.string().min(1).optional(),
  stripeCustomerId: z.string().min(1).optional(),
  stripeCustomerEmail: z.string().email().optional(),
  contractCustomerId: z.string().min(1).optional(),
  costAccountId: z.string().min(1).optional(),
  matchReasons: z.array(z.string().min(1)).default([]),
  evidence: z.array(evidenceRefSchema).default([]),
  reviewerId: z.string().min(1).optional(),
  reviewedAt: z.string().datetime().optional(),
  note: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type AccountMapping = z.infer<typeof accountMappingSchema>

export type ManualAccountMappingInput = {
  organizationId: string
  workspaceId: string
  displayName: string
  usageAccountId?: string
  usageCustomerId?: string
  usageCustomerName?: string
  stripeCustomerId?: string
  stripeCustomerEmail?: string
  contractCustomerId?: string
  costAccountId?: string
  reviewerId: string
  note?: string
}

export type UnmappedAccountReport = {
  usageAccountIds: string[]
  stripeCustomerIds: string[]
  contractCustomerIds: string[]
  costAccountIds: string[]
}

export function buildAccountMappingSuggestions(records: ParsedRecord[], now = new Date()): AccountMapping[] {
  const usageRecords = records.map(toUsageIdentity).filter(isPresent)
  const stripeRecords = records.map(toStripeIdentity).filter(isPresent)
  const suggestions: AccountMapping[] = []

  for (const usage of usageRecords) {
    for (const stripe of stripeRecords) {
      const matchReasons = findMatchReasons(usage, stripe)

      if (matchReasons.length === 0) {
        continue
      }

      suggestions.push(
        accountMappingSchema.parse({
          id: mappingId(usage.workspaceId, usage.accountId ?? usage.customerId ?? usage.customerName, stripe.customerId ?? stripe.customerEmail),
          organizationId: usage.organizationId,
          workspaceId: usage.workspaceId,
          displayName: usage.customerName ?? stripe.customerEmail ?? usage.accountId ?? stripe.customerId,
          status: 'suggested',
          source: 'system',
          confidence: confidenceForReasons(matchReasons),
          usageAccountId: usage.accountId,
          usageCustomerId: usage.customerId,
          usageCustomerName: usage.customerName,
          stripeCustomerId: stripe.customerId,
          stripeCustomerEmail: stripe.customerEmail,
          matchReasons,
          evidence: [
            { type: 'usage_record', sourceId: usage.recordId },
            { type: stripe.evidenceType, sourceId: stripe.recordId },
          ],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        }),
      )
    }
  }

  return dedupeMappings(suggestions)
}

export function approveAccountMapping(
  mapping: AccountMapping,
  input: {
    reviewerId: string
    note?: string
  },
  now = new Date(),
): AccountMapping {
  return accountMappingSchema.parse({
    ...mapping,
    status: 'approved',
    reviewerId: input.reviewerId,
    reviewedAt: now.toISOString(),
    note: input.note,
    updatedAt: now.toISOString(),
  })
}

export function createManualAccountMapping(input: ManualAccountMappingInput, now = new Date()): AccountMapping {
  return accountMappingSchema.parse({
    id: mappingId(
      input.workspaceId,
      input.usageAccountId ?? input.usageCustomerId ?? input.displayName,
      input.stripeCustomerId ?? input.stripeCustomerEmail ?? input.contractCustomerId ?? input.costAccountId,
    ),
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    displayName: input.displayName.trim(),
    status: 'manual_override',
    source: 'manual',
    confidence: 1,
    usageAccountId: trimToUndefined(input.usageAccountId),
    usageCustomerId: trimToUndefined(input.usageCustomerId),
    usageCustomerName: trimToUndefined(input.usageCustomerName),
    stripeCustomerId: trimToUndefined(input.stripeCustomerId),
    stripeCustomerEmail: trimToUndefined(input.stripeCustomerEmail),
    contractCustomerId: trimToUndefined(input.contractCustomerId),
    costAccountId: trimToUndefined(input.costAccountId),
    matchReasons: ['manual_override'],
    evidence: [],
    reviewerId: input.reviewerId,
    reviewedAt: now.toISOString(),
    note: trimToUndefined(input.note),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })
}

export function getUnmappedAccountReport(records: ParsedRecord[], mappings: AccountMapping[]): UnmappedAccountReport {
  const mappedUsageIds = new Set(mappings.flatMap((mapping) => [mapping.usageAccountId, mapping.usageCustomerId]).filter(isPresent))
  const mappedStripeIds = new Set(mappings.map((mapping) => mapping.stripeCustomerId).filter(isPresent))
  const mappedContractIds = new Set(mappings.map((mapping) => mapping.contractCustomerId).filter(isPresent))
  const mappedCostIds = new Set(mappings.map((mapping) => mapping.costAccountId).filter(isPresent))

  return {
    usageAccountIds: sortedUnique(records.map(readUsageIdentifier).filter(isPresent).filter((id) => !mappedUsageIds.has(id))),
    stripeCustomerIds: sortedUnique(records.map(readStripeIdentifier).filter(isPresent).filter((id) => !mappedStripeIds.has(id))),
    contractCustomerIds: sortedUnique(records.map(readContractCustomerId).filter(isPresent).filter((id) => !mappedContractIds.has(id))),
    costAccountIds: sortedUnique(records.map(readCostAccountId).filter(isPresent).filter((id) => !mappedCostIds.has(id))),
  }
}

export class JsonAccountMappingStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AccountMapping[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(accountMappingSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<AccountMapping[]> {
    const mappings = await this.list()

    return mappings.filter((mapping) => mapping.workspaceId === workspaceId)
  }

  async saveMany(mappings: AccountMapping[]): Promise<void> {
    const existing = await this.list()
    const nextById = new Map(existing.map((mapping) => [mapping.id, mapping]))

    for (const mapping of mappings) {
      nextById.set(mapping.id, mapping)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const mappings = await this.list()
    const next = mappings.filter((mapping) => mapping.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return mappings.length - next.length
  }
}

type UsageIdentity = {
  recordId: string
  organizationId: string
  workspaceId: string
  accountId?: string
  customerId?: string
  customerName?: string
  domain?: string
}

type StripeIdentity = {
  recordId: string
  organizationId: string
  workspaceId: string
  customerId?: string
  customerEmail?: string
  evidenceType: 'invoice_line' | 'customer_record'
}

function toUsageIdentity(record: ParsedRecord): UsageIdentity | null {
  if (record.recordType !== 'usage') {
    return null
  }

  return {
    recordId: record.id,
    organizationId: record.organizationId,
    workspaceId: record.workspaceId,
    accountId: readString(record.data, 'accountId'),
    customerId: readString(record.data, 'customerId'),
    customerName: readString(record.data, 'customerName'),
    domain: readString(readRecord(record.data, 'metadata'), 'domain'),
  }
}

function toStripeIdentity(record: ParsedRecord): StripeIdentity | null {
  if (record.recordType === 'invoice_line') {
    return {
      recordId: record.id,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      customerId: readString(record.data, 'externalCustomerId') ?? readString(record.data, 'customerId'),
      customerEmail: readString(record.data, 'customerEmail'),
      evidenceType: 'invoice_line',
    }
  }

  if (record.recordType === 'customer') {
    return {
      recordId: record.id,
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      customerId: readString(readRecord(record.data, 'externalIds'), 'stripeCustomerId'),
      customerEmail: readString(record.data, 'primaryEmail'),
      evidenceType: 'customer_record',
    }
  }

  return null
}

function findMatchReasons(usage: UsageIdentity, stripe: StripeIdentity): string[] {
  const reasons: string[] = []

  if (usage.customerId && stripe.customerId && normalizeKey(usage.customerId) === normalizeKey(stripe.customerId)) {
    reasons.push('customer_id_match')
  }

  const usageDomain = usage.domain ? normalizeDomain(usage.domain) : undefined
  const stripeDomain = stripe.customerEmail ? normalizeDomain(stripe.customerEmail.split('@')[1]) : undefined

  if (usageDomain && stripeDomain && usageDomain === stripeDomain) {
    reasons.push('domain_match')
  }

  const usageNameSlug = usage.customerName ? slug(usage.customerName) : undefined
  const stripeLocalPartSlug = stripe.customerEmail ? slug(stripe.customerEmail.split('@')[0]) : undefined

  if (usageNameSlug && stripeLocalPartSlug && stripeLocalPartSlug.includes(usageNameSlug)) {
    reasons.push('name_match')
  }

  return reasons
}

function confidenceForReasons(reasons: string[]): number {
  if (reasons.includes('customer_id_match')) {
    return 0.98
  }

  if (reasons.includes('domain_match')) {
    return 0.9
  }

  return 0.72
}

function dedupeMappings(mappings: AccountMapping[]): AccountMapping[] {
  const byId = new Map<string, AccountMapping>()

  for (const mapping of mappings) {
    const existing = byId.get(mapping.id)

    if (!existing || mapping.confidence > existing.confidence) {
      byId.set(mapping.id, mapping)
    }
  }

  return [...byId.values()]
}

function readUsageIdentifier(record: ParsedRecord): string | undefined {
  if (record.recordType !== 'usage') {
    return undefined
  }

  return readString(record.data, 'accountId') ?? readString(record.data, 'customerId')
}

function readStripeIdentifier(record: ParsedRecord): string | undefined {
  if (record.recordType === 'invoice_line') {
    return readString(record.data, 'externalCustomerId') ?? readString(record.data, 'customerId')
  }

  if (record.recordType === 'customer') {
    return readString(readRecord(record.data, 'externalIds'), 'stripeCustomerId')
  }

  return undefined
}

function readContractCustomerId(record: ParsedRecord): string | undefined {
  if ((record.recordType as string) !== 'contract_term') {
    return undefined
  }

  return readString(record.data, 'customerId')
}

function readCostAccountId(record: ParsedRecord): string | undefined {
  if (record.recordType !== 'cost') {
    return undefined
  }

  return readString(record.data, 'accountId')
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function mappingId(workspaceId: string, left: string | undefined, right: string | undefined): string {
  return `map_${slug(workspaceId)}_${slug(left ?? 'unknown_usage')}_${slug(right ?? 'unknown_stripe')}`
}

function readRecord(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key]

  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function trimToUndefined(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '')
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined && !(typeof value === 'string' && value.trim().length === 0)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
