import { dirname } from 'node:path'
import { z } from 'zod'

import { billingPlanIdSchema, type BillingPlanId } from './billing-plans'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'

export const stripeAppInvoiceStatusSchema = z.enum(['draft', 'open', 'paid', 'void', 'uncollectible'])
export const stripeAppSubscriptionStatusSchema = z.enum([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'paused',
  'canceled',
  'incomplete',
  'incomplete_expired',
])
export const appBillingStatusSchema = z.enum(['tracked', 'invoiced', 'paid', 'active', 'past_due', 'canceled'])

export const appBillingRecordSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    organizationName: z.string().min(1),
    provider: z.literal('stripe'),
    planId: billingPlanIdSchema,
    stripeCustomerId: z.string().min(1).optional(),
    stripeInvoiceId: z.string().min(1).optional(),
    stripeInvoiceStatus: stripeAppInvoiceStatusSchema.optional(),
    stripeHostedInvoiceUrl: z.string().url().optional(),
    stripeSubscriptionId: z.string().min(1).optional(),
    stripeSubscriptionStatus: stripeAppSubscriptionStatusSchema.optional(),
    billingStatus: appBillingStatusSchema,
    note: z.string().min(1).optional(),
    updatedBy: z.string().min(1),
    updatedAt: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((record, context) => {
    if (!record.stripeCustomerId && !record.stripeInvoiceId && !record.stripeSubscriptionId) {
      context.addIssue({
        code: 'custom',
        message: 'App billing records require a Stripe customer, invoice, or subscription ID',
        path: ['stripeCustomerId'],
      })
    }
  })

export type StripeAppInvoiceStatus = z.infer<typeof stripeAppInvoiceStatusSchema>
export type StripeAppSubscriptionStatus = z.infer<typeof stripeAppSubscriptionStatusSchema>
export type AppBillingStatus = z.infer<typeof appBillingStatusSchema>
export type AppBillingRecord = z.infer<typeof appBillingRecordSchema>

export type CreateAppBillingRecordInput = {
  organizationId: string
  organizationName: string
  planId: BillingPlanId
  stripeCustomerId?: string
  stripeInvoiceId?: string
  stripeInvoiceStatus?: StripeAppInvoiceStatus
  stripeHostedInvoiceUrl?: string
  stripeSubscriptionId?: string
  stripeSubscriptionStatus?: StripeAppSubscriptionStatus
  note?: string
  updatedBy: string
  metadata?: Record<string, unknown>
}

export function createAppBillingRecord(input: CreateAppBillingRecordInput, now = new Date()): AppBillingRecord {
  const organizationId = input.organizationId.trim()

  return appBillingRecordSchema.parse({
    id: `app_billing_${slug(organizationId)}`,
    organizationId,
    organizationName: input.organizationName.trim(),
    provider: 'stripe',
    planId: input.planId,
    stripeCustomerId: trimToUndefined(input.stripeCustomerId),
    stripeInvoiceId: trimToUndefined(input.stripeInvoiceId),
    stripeInvoiceStatus: input.stripeInvoiceStatus,
    stripeHostedInvoiceUrl: trimToUndefined(input.stripeHostedInvoiceUrl),
    stripeSubscriptionId: trimToUndefined(input.stripeSubscriptionId),
    stripeSubscriptionStatus: input.stripeSubscriptionStatus,
    billingStatus: deriveBillingStatus(input),
    note: trimToUndefined(input.note),
    updatedBy: input.updatedBy,
    updatedAt: now.toISOString(),
    metadata: input.metadata ?? {},
  })
}

export function createAppBillingRecordFromFormData(formData: FormData, updatedBy: string, now = new Date()): AppBillingRecord {
  return createAppBillingRecord(
    {
      organizationId: requiredString(formData, 'organizationId'),
      organizationName: requiredString(formData, 'organizationName'),
      planId: billingPlanIdSchema.parse(formData.get('planId') || 'audit'),
      stripeCustomerId: optionalString(formData, 'stripeCustomerId'),
      stripeInvoiceId: optionalString(formData, 'stripeInvoiceId'),
      stripeInvoiceStatus: optionalStripeInvoiceStatus(formData, 'stripeInvoiceStatus'),
      stripeHostedInvoiceUrl: optionalString(formData, 'stripeHostedInvoiceUrl'),
      stripeSubscriptionId: optionalString(formData, 'stripeSubscriptionId'),
      stripeSubscriptionStatus: optionalStripeSubscriptionStatus(formData, 'stripeSubscriptionStatus'),
      note: optionalString(formData, 'note'),
      updatedBy,
    },
    now,
  )
}

export class JsonAppBillingStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AppBillingRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortRecords(z.array(appBillingRecordSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async getByOrganization(organizationId: string): Promise<AppBillingRecord | null> {
    const records = await this.list()

    return records.find((record) => record.organizationId === organizationId) ?? null
  }

  async save(record: AppBillingRecord): Promise<void> {
    const records = await this.list()
    const nextByOrganization = new Map(records.map((existing) => [existing.organizationId, existing]))
    nextByOrganization.set(record.organizationId, record)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortRecords([...nextByOrganization.values()]), null, 2), 'utf8')
  }
}

function deriveBillingStatus(input: CreateAppBillingRecordInput): AppBillingStatus {
  if (input.stripeSubscriptionStatus === 'active' || input.stripeSubscriptionStatus === 'trialing') {
    return 'active'
  }

  if (input.stripeSubscriptionStatus === 'past_due' || input.stripeSubscriptionStatus === 'unpaid') {
    return 'past_due'
  }

  if (input.stripeSubscriptionStatus === 'canceled' || input.stripeSubscriptionStatus === 'incomplete_expired') {
    return 'canceled'
  }

  if (input.stripeInvoiceStatus === 'paid') {
    return 'paid'
  }

  if (input.stripeInvoiceStatus === 'open' || input.stripeInvoiceStatus === 'draft') {
    return 'invoiced'
  }

  return 'tracked'
}

function optionalStripeInvoiceStatus(formData: FormData, key: string): StripeAppInvoiceStatus | undefined {
  const value = optionalString(formData, key)

  return value ? stripeAppInvoiceStatusSchema.parse(value) : undefined
}

function optionalStripeSubscriptionStatus(formData: FormData, key: string): StripeAppSubscriptionStatus | undefined {
  const value = optionalString(formData, key)

  return value ? stripeAppSubscriptionStatusSchema.parse(value) : undefined
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key)

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required app billing field: ${key}`)
  }

  return value.trim()
}

function optionalString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)

  return typeof value === 'string' ? trimToUndefined(value) : undefined
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed ? trimmed : undefined
}

function sortRecords(records: AppBillingRecord[]): AppBillingRecord[] {
  return [...records].sort((a, b) => a.organizationName.localeCompare(b.organizationName))
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
