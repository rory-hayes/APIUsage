import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { contractBillingPeriodSchema } from './schemas'

export const pricingRuleTypeSchema = z.enum(['rate', 'allowance', 'overage_rate', 'discount'])
export const pricingRuleStatusSchema = z.enum(['active', 'inactive', 'pending_customer_approval', 'rejected'])
export const pricingRuleVersionSnapshotSchema = z.object({
  pricingRuleId: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  status: pricingRuleStatusSchema,
})

const metadataSchema = z.record(z.string(), z.unknown()).default({})
const currencySchema = z.string().trim().min(3).max(3).transform((value) => value.toLowerCase())

export const pricingRuleSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    workspaceId: z.string().min(1),
    customerId: z.string().min(1).optional(),
    name: z.string().min(1),
    type: pricingRuleTypeSchema,
    meter: z.string().min(1).optional(),
    unit: z.string().min(1).optional(),
    billingPeriod: contractBillingPeriodSchema.optional(),
    rate: z.number().nonnegative().optional(),
    allowance: z.number().nonnegative().optional(),
    threshold: z.number().nonnegative().optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    currency: currencySchema.optional(),
    effectiveFrom: z.string().date().optional(),
    effectiveTo: z.string().date().optional(),
    status: pricingRuleStatusSchema.default('active'),
    version: z.number().int().positive().default(1),
    createdBy: z.string().min(1),
    updatedBy: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    metadata: metadataSchema,
  })
  .superRefine((rule, ctx) => {
    if (rule.type === 'rate' && rule.rate === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Rate rules require a rate',
        path: ['rate'],
      })
    }

    if (rule.type === 'allowance' && rule.allowance === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Allowance rules require an allowance',
        path: ['allowance'],
      })
    }

    if (rule.type === 'overage_rate' && rule.rate === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Overage rules require a rate',
        path: ['rate'],
      })
    }

    if (rule.type === 'discount' && rule.discountPercent === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Discount rules require a discount percent',
        path: ['discountPercent'],
      })
    }

    if (rule.effectiveFrom && rule.effectiveTo && rule.effectiveTo < rule.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        message: 'Effective end date must be on or after effective start date',
        path: ['effectiveTo'],
      })
    }
  })

export type PricingRule = z.infer<typeof pricingRuleSchema>
export type PricingRuleType = z.infer<typeof pricingRuleTypeSchema>
export type PricingRuleStatus = z.infer<typeof pricingRuleStatusSchema>
export type PricingRuleVersionSnapshot = z.infer<typeof pricingRuleVersionSnapshotSchema>

export type CreatePricingRuleInput = {
  organizationId: string
  workspaceId: string
  customerId?: string
  name: string
  type: PricingRuleType
  meter?: string
  unit?: string
  billingPeriod?: PricingRule['billingPeriod']
  rate?: number
  allowance?: number
  threshold?: number
  discountPercent?: number
  currency?: string
  effectiveFrom?: string
  effectiveTo?: string
  status?: PricingRule['status']
  version?: PricingRule['version']
  createdBy: string
  metadata?: PricingRule['metadata']
}

export type UpdatePricingRuleInput = Omit<CreatePricingRuleInput, 'organizationId' | 'workspaceId' | 'createdBy'> & {
  updatedBy: string
}

const pricingRuleStoreSchema = z.object({
  rules: z.array(pricingRuleSchema).default([]),
})

type PricingRuleStoreData = z.infer<typeof pricingRuleStoreSchema>
const materialPricingRuleFields = [
  'type',
  'meter',
  'unit',
  'billingPeriod',
  'rate',
  'allowance',
  'threshold',
  'discountPercent',
  'currency',
  'effectiveFrom',
  'effectiveTo',
] as const

export function createPricingRule(input: CreatePricingRuleInput, now = new Date()): PricingRule {
  const timestamp = now.toISOString()

  return pricingRuleSchema.parse({
    ...input,
    id: createPricingRuleId(input.workspaceId, input.name, timestamp),
    status: input.status ?? 'active',
    version: input.version ?? 1,
    createdBy: input.createdBy,
    updatedBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: input.metadata ?? {},
  })
}

export function updatePricingRule(rule: PricingRule, input: UpdatePricingRuleInput, now = new Date()): PricingRule {
  const nextRule = pricingRuleSchema.parse({
    id: rule.id,
    organizationId: rule.organizationId,
    workspaceId: rule.workspaceId,
    customerId: input.customerId,
    name: input.name,
    type: input.type,
    meter: input.meter,
    unit: input.unit,
    billingPeriod: input.billingPeriod,
    rate: input.rate,
    allowance: input.allowance,
    threshold: input.threshold,
    discountPercent: input.discountPercent,
    currency: input.currency,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    status: input.status ?? rule.status,
    version: input.version ?? rule.version,
    createdBy: rule.createdBy,
    updatedBy: input.updatedBy,
    createdAt: rule.createdAt,
    updatedAt: now.toISOString(),
    metadata: input.metadata ?? rule.metadata,
  })

  return pricingRuleSchema.parse({
    ...nextRule,
    version: input.version ?? (isMaterialPricingRuleChange(rule, nextRule) ? rule.version + 1 : rule.version),
  })
}

export function isMaterialPricingRuleChange(before: PricingRule, after: PricingRule): boolean {
  return materialPricingRuleFields.some((field) => comparableRuleValue(before[field]) !== comparableRuleValue(after[field]))
}

export function requestPricingRuleCustomerApproval(
  rule: PricingRule,
  input: {
    requestedBy: string
    reason?: string
  },
  now = new Date(),
): PricingRule {
  const timestamp = now.toISOString()

  return pricingRuleSchema.parse({
    ...rule,
    status: 'pending_customer_approval',
    updatedBy: input.requestedBy,
    updatedAt: timestamp,
    metadata: {
      ...rule.metadata,
      customerApprovalRequestedBy: input.requestedBy,
      customerApprovalRequestedAt: timestamp,
      ...(input.reason ? { customerApprovalReason: input.reason } : {}),
    },
  })
}

export function approvePricingRule(
  rule: PricingRule,
  input: {
    approvedBy: string
    note?: string
  },
  now = new Date(),
): PricingRule {
  const timestamp = now.toISOString()

  return pricingRuleSchema.parse({
    ...rule,
    status: 'active',
    updatedBy: input.approvedBy,
    updatedAt: timestamp,
    metadata: {
      ...rule.metadata,
      customerApprovedBy: input.approvedBy,
      customerApprovedAt: timestamp,
      ...(input.note ? { customerApprovalNote: input.note } : {}),
    },
  })
}

export function rejectPricingRule(
  rule: PricingRule,
  input: {
    rejectedBy: string
    note?: string
  },
  now = new Date(),
): PricingRule {
  const timestamp = now.toISOString()

  return pricingRuleSchema.parse({
    ...rule,
    status: 'rejected',
    updatedBy: input.rejectedBy,
    updatedAt: timestamp,
    metadata: {
      ...rule.metadata,
      customerRejectedBy: input.rejectedBy,
      customerRejectedAt: timestamp,
      ...(input.note ? { customerRejectionNote: input.note } : {}),
    },
  })
}

export function snapshotActivePricingRuleVersions(pricingRules: PricingRule[]): PricingRuleVersionSnapshot[] {
  return pricingRules
    .filter((rule) => rule.status === 'active')
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .map((rule) =>
      pricingRuleVersionSnapshotSchema.parse({
        pricingRuleId: rule.id,
        name: rule.name,
        version: rule.version,
        status: rule.status,
      }),
    )
}

export class JsonPricingRuleStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<PricingRule[]> {
    return (await this.read()).rules
  }

  async listByWorkspace(workspaceId: string): Promise<PricingRule[]> {
    const rules = await this.list()

    return rules.filter((rule) => rule.workspaceId === workspaceId)
  }

  async saveMany(rules: PricingRule[]): Promise<void> {
    const data = await this.read()
    const nextById = new Map(data.rules.map((rule) => [rule.id, rule]))

    for (const rule of rules) {
      nextById.set(rule.id, rule)
    }

    await this.write({
      rules: [...nextById.values()],
    })
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const data = await this.read()
    const rules = data.rules.filter((rule) => rule.workspaceId !== workspaceId)

    await this.write({
      rules,
    })

    return data.rules.length - rules.length
  }

  private async read(): Promise<PricingRuleStoreData> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return pricingRuleStoreSchema.parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return { rules: [] }
      }

      throw error
    }
  }

  private async write(data: PricingRuleStoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }
}

function createPricingRuleId(workspaceId: string, name: string, timestamp: string): string {
  return `pricing_rule_${slug(workspaceId)}_${slug(name)}_${slugTimestamp(timestamp)}`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function comparableRuleValue(value: unknown): string | number | undefined {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().toLowerCase()
  }

  return undefined
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
