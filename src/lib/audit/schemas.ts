import { z } from 'zod'

export const sourceRefSchema = z.object({
  sourceFileId: z.string().min(1),
  rowNumber: z.number().int().positive().optional(),
  page: z.number().int().positive().optional(),
  column: z.string().min(1).optional(),
})

export const evidenceRefSchema = z.object({
  type: z.enum([
    'invoice',
    'invoice_line',
    'usage_record',
    'usage_aggregate',
    'contract_clause',
    'pricing_rule',
    'credit_balance',
    'cost_record',
    'subscription',
    'customer_record',
    'mapping',
    'manual_note',
  ]),
  sourceId: z.string().min(1),
})

const metadataSchema = z.record(z.string(), z.unknown()).default({})
const currencySchema = z.string().trim().min(3).max(3).transform((value) => value.toLowerCase())
const isoDateTimeSchema = z.string().datetime()
export const contractBillingPeriodSchema = z.enum(['monthly', 'quarterly', 'annual', 'one_time', 'custom'])
export const findingAssignmentOwnerSchema = z.enum(['finance', 'engineering', 'revops', 'product'])
export const findingAssignmentSchema = z.object({
  owner: findingAssignmentOwnerSchema,
  assignedBy: z.string().min(1),
  assignedAt: isoDateTimeSchema,
  note: z.string().min(1).optional(),
})

export const normalizedCustomerSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  displayName: z.string().min(1),
  primaryEmail: z.string().email().optional(),
  externalIds: z.record(z.string(), z.string()).default({}),
  sourceRefs: z.array(sourceRefSchema).default([]),
  metadata: metadataSchema,
})

export const normalizedUsageSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  meter: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  sourceRefs: z.array(sourceRefSchema).default([]),
  metadata: metadataSchema,
})

export const normalizedInvoiceLineSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  invoiceId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  externalCustomerId: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
  description: z.string().min(1),
  amount: z.number().int(),
  currency: currencySchema,
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']),
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  sourceRefs: z.array(sourceRefSchema).default([]),
  metadata: metadataSchema,
})

export const normalizedCostSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  customerName: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  provider: z.string().min(1),
  product: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  costAmount: z.number().int(),
  currency: currencySchema,
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  sourceRefs: z.array(sourceRefSchema).default([]),
  metadata: metadataSchema,
})

export const normalizedAccountMappingSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  displayName: z.string().min(1),
  usageAccountId: z.string().min(1).optional(),
  usageCustomerId: z.string().min(1).optional(),
  usageCustomerName: z.string().min(1).optional(),
  stripeCustomerId: z.string().min(1).optional(),
  stripeCustomerEmail: z.string().email().optional(),
  contractCustomerId: z.string().min(1).optional(),
  costAccountId: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  sourceRefs: z.array(sourceRefSchema).default([]),
  metadata: metadataSchema,
})

export const normalizedSubscriptionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  subscriptionId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  externalCustomerId: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
  status: z.enum(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired']),
  product: z.string().min(1).optional(),
  plan: z.string().min(1).optional(),
  currentPeriodStart: isoDateTimeSchema,
  currentPeriodEnd: isoDateTimeSchema,
  canceledAt: isoDateTimeSchema.optional(),
  endedAt: isoDateTimeSchema.optional(),
  sourceRefs: z.array(sourceRefSchema).default([]),
  metadata: metadataSchema,
})

export const contractTermSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  type: z.enum(['rate', 'allowance', 'credit', 'minimum', 'overage_rate', 'discount', 'special_term']),
  meter: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  billingPeriod: contractBillingPeriodSchema.optional(),
  rate: z.number().nonnegative().optional(),
  allowance: z.number().nonnegative().optional(),
  threshold: z.number().nonnegative().optional(),
  creditAmount: z.number().nonnegative().optional(),
  minimumAmount: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  currency: currencySchema.optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(['candidate', 'approved', 'rejected']).default('candidate'),
  evidence: z
    .object({
      sourceFileId: z.string().min(1),
      page: z.number().int().positive().optional(),
      snippet: z.string().min(1).optional(),
    })
    .optional(),
  metadata: metadataSchema,
})

export const findingSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    workspaceId: z.string().min(1),
    customerId: z.string().min(1).optional(),
    category: z.enum([
      'usage_exists_no_invoice',
      'invoice_without_usage',
      'usage_above_allowance_no_overage',
      'wrong_overage_rate',
      'credit_burn_mismatch',
      'expired_discount_active',
      'minimum_not_enforced',
      'contract_terms_not_in_billing',
      'cancelled_account_usage',
      'internal_usage_billed',
      'paid_usage_marked_free',
      'cost_exceeds_revenue',
      'duplicate_usage',
      'missing_usage',
      'late_usage_after_invoice_finalization',
      'account_mapping_mismatch',
    ]),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    title: z.string().min(1),
    expectedAmount: z.number().int(),
    actualAmount: z.number().int(),
    varianceAmount: z.number().int().optional(),
    currency: currencySchema,
    confidence: z.number().min(0).max(1),
    status: z
      .enum([
        'draft',
        'needs_review',
        'needs_customer_input',
        'approved_internal',
        'published',
        'customer_reviewing',
        'open',
        'investigating',
        'accepted',
        'rejected',
        'fixed',
        'ignored',
        'monitoring',
        'closed',
      ])
      .default('draft'),
    evidenceRefs: z.array(evidenceRefSchema).min(1),
    recommendedAction: z.string().min(1),
    internalNote: z.string().optional(),
    customerNote: z.string().optional(),
    reviewerId: z.string().min(1).optional(),
    assignment: findingAssignmentSchema.optional(),
    metadata: metadataSchema,
  })
  .transform((finding) => ({
    ...finding,
    varianceAmount: finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount,
  }))

export type NormalizedCustomer = z.infer<typeof normalizedCustomerSchema>
export type NormalizedUsage = z.infer<typeof normalizedUsageSchema>
export type NormalizedInvoiceLine = z.infer<typeof normalizedInvoiceLineSchema>
export type NormalizedCost = z.infer<typeof normalizedCostSchema>
export type NormalizedAccountMapping = z.infer<typeof normalizedAccountMappingSchema>
export type NormalizedSubscription = z.infer<typeof normalizedSubscriptionSchema>
export type ContractTerm = z.infer<typeof contractTermSchema>
export type Finding = z.infer<typeof findingSchema>
export type FindingAssignment = z.infer<typeof findingAssignmentSchema>
export type FindingAssignmentOwner = z.infer<typeof findingAssignmentOwnerSchema>
