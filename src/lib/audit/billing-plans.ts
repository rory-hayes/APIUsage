import { z } from 'zod'

export const billingPlanIdSchema = z.enum(['audit', 'monitoring', 'enterprise'])
export const billingPlanStatusSchema = z.enum(['active', 'inactive'])
export const billingCadenceSchema = z.enum(['one_time', 'monthly', 'custom'])
export const billingCommercialModelSchema = z.enum(['fixed_fee', 'retainer', 'custom_quote'])
export const billingPlanServiceSchema = z.enum([
  'workspace_setup',
  'upload_review',
  'contract_extraction',
  'reconciliation_checks',
  'evidence_pack',
  'monthly_workspace',
  'scheduled_checks',
  'issue_workflow',
  'integrations',
  'priority_support',
  'security_review',
  'custom_terms',
])

export const billingPlanRecordSchema = z
  .object({
    id: billingPlanIdSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    status: billingPlanStatusSchema.default('active'),
    billingCadence: billingCadenceSchema,
    commercialModel: billingCommercialModelSchema,
    currency: z.string().trim().min(3).max(3).transform((value) => value.toLowerCase()),
    basePriceAmount: z.number().int().nonnegative().optional(),
    includedServices: z.array(billingPlanServiceSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type BillingPlanId = z.infer<typeof billingPlanIdSchema>
export type BillingPlanRecord = z.infer<typeof billingPlanRecordSchema>
export type BillingPlanService = z.infer<typeof billingPlanServiceSchema>

export const BILLING_PLANS: BillingPlanRecord[] = [
  billingPlanRecordSchema.parse({
    id: 'audit',
    name: 'Audit',
    description: 'One-off operator-assisted revenue integrity audit with a verified evidence pack.',
    status: 'active',
    billingCadence: 'one_time',
    commercialModel: 'fixed_fee',
    currency: 'eur',
    basePriceAmount: 500000,
    includedServices: ['workspace_setup', 'upload_review', 'contract_extraction', 'reconciliation_checks', 'evidence_pack'],
    metadata: {
      salesMotion: 'founder_led',
    },
  }),
  billingPlanRecordSchema.parse({
    id: 'monitoring',
    name: 'Monitoring',
    description: 'Monthly pre-close monitoring for repeatable usage, billing, contract, and finding workflows.',
    status: 'active',
    billingCadence: 'monthly',
    commercialModel: 'retainer',
    currency: 'eur',
    basePriceAmount: 300000,
    includedServices: ['monthly_workspace', 'scheduled_checks', 'issue_workflow', 'evidence_pack'],
    metadata: {
      salesMotion: 'pilot_conversion',
    },
  }),
  billingPlanRecordSchema.parse({
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom monitoring package for larger teams with integrations, support, security review, and bespoke terms.',
    status: 'active',
    billingCadence: 'custom',
    commercialModel: 'custom_quote',
    currency: 'eur',
    includedServices: ['monthly_workspace', 'integrations', 'priority_support', 'security_review', 'custom_terms'],
    metadata: {
      salesMotion: 'sales_led',
    },
  }),
]

export function listActiveBillingPlans(plans: BillingPlanRecord[] = BILLING_PLANS): BillingPlanRecord[] {
  return plans.filter((plan) => plan.status === 'active')
}

export function getBillingPlan(planId: string, plans: BillingPlanRecord[] = BILLING_PLANS): BillingPlanRecord | null {
  return plans.find((plan) => plan.id === planId) ?? null
}
