import { z } from 'zod'

import { type Finding } from './schemas'

export const ruleTemplateIdSchema = z.enum([
  'cancelled_account_usage',
  'account_mapping_mismatch',
  'usage_without_invoice',
  'invoice_without_usage',
  'missing_usage',
  'late_usage_after_invoice_finalization',
  'duplicate_usage',
  'internal_usage_billed',
  'paid_usage_marked_free',
  'wrong_overage_rate',
  'usage_above_allowance',
  'credit_burn_mismatch',
  'minimum_not_enforced',
  'expired_discount_active',
  'contract_terms_not_in_billing',
  'cost_exceeds_revenue',
])

export type RuleTemplateId = z.infer<typeof ruleTemplateIdSchema>

export type RuleTemplate = {
  id: RuleTemplateId
  name: string
  description: string
  category: 'data_quality' | 'revenue_leakage' | 'contract_billing' | 'margin_risk' | 'account_lifecycle'
  findingCategory: Finding['category']
  requiredInputs: string[]
  defaultEnabled: boolean
}

export const DEFAULT_RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'cancelled_account_usage',
    name: 'Cancelled account usage',
    description: 'Flags customers consuming paid resources after cancellation or downgrade.',
    category: 'account_lifecycle',
    findingCategory: 'cancelled_account_usage',
    requiredInputs: ['usage_csv', 'stripe_subscriptions_export'],
    defaultEnabled: true,
  },
  {
    id: 'account_mapping_mismatch',
    name: 'Account mapping mismatch',
    description: 'Flags identifiers that cannot be reconciled across usage, billing, contract, and cost sources.',
    category: 'data_quality',
    findingCategory: 'account_mapping_mismatch',
    requiredInputs: ['usage_csv', 'stripe_invoices_export', 'account_mapping_csv'],
    defaultEnabled: true,
  },
  {
    id: 'usage_without_invoice',
    name: 'Usage without invoice',
    description: 'Detects billable usage records that do not have a matching invoice line.',
    category: 'revenue_leakage',
    findingCategory: 'usage_exists_no_invoice',
    requiredInputs: ['usage_csv', 'stripe_invoices_export'],
    defaultEnabled: true,
  },
  {
    id: 'invoice_without_usage',
    name: 'Invoice without usage',
    description: 'Detects usage-like invoice lines that do not have supporting usage records.',
    category: 'data_quality',
    findingCategory: 'invoice_without_usage',
    requiredInputs: ['stripe_invoices_export', 'usage_csv'],
    defaultEnabled: true,
  },
  {
    id: 'missing_usage',
    name: 'Missing usage',
    description: 'Detects invoice quantities that exceed the supporting recorded usage.',
    category: 'data_quality',
    findingCategory: 'missing_usage',
    requiredInputs: ['stripe_invoices_export', 'usage_csv'],
    defaultEnabled: true,
  },
  {
    id: 'late_usage_after_invoice_finalization',
    name: 'Late usage after finalization',
    description: 'Flags usage that arrived after the invoice was finalized.',
    category: 'data_quality',
    findingCategory: 'late_usage_after_invoice_finalization',
    requiredInputs: ['usage_csv', 'stripe_invoices_export'],
    defaultEnabled: true,
  },
  {
    id: 'duplicate_usage',
    name: 'Duplicate usage',
    description: 'Detects repeated usage events for the same account, meter, period, and quantity.',
    category: 'data_quality',
    findingCategory: 'duplicate_usage',
    requiredInputs: ['usage_csv'],
    defaultEnabled: true,
  },
  {
    id: 'internal_usage_billed',
    name: 'Internal usage billed',
    description: 'Flags usage classified as internal, test, demo, or free that appears billed.',
    category: 'revenue_leakage',
    findingCategory: 'internal_usage_billed',
    requiredInputs: ['usage_csv', 'stripe_invoices_export'],
    defaultEnabled: true,
  },
  {
    id: 'paid_usage_marked_free',
    name: 'Paid usage marked free',
    description: 'Detects paid contract meters that are classified as free or internal in usage data.',
    category: 'revenue_leakage',
    findingCategory: 'paid_usage_marked_free',
    requiredInputs: ['usage_csv', 'contracts_order_forms'],
    defaultEnabled: true,
  },
  {
    id: 'wrong_overage_rate',
    name: 'Wrong overage rate',
    description: 'Compares approved overage rates with invoice amounts.',
    category: 'contract_billing',
    findingCategory: 'wrong_overage_rate',
    requiredInputs: ['usage_csv', 'stripe_invoices_export', 'contracts_order_forms'],
    defaultEnabled: true,
  },
  {
    id: 'usage_above_allowance',
    name: 'Usage above allowance',
    description: 'Detects usage above approved allowances with missing or insufficient overage billing.',
    category: 'contract_billing',
    findingCategory: 'usage_above_allowance_no_overage',
    requiredInputs: ['usage_csv', 'stripe_invoices_export', 'contracts_order_forms'],
    defaultEnabled: true,
  },
  {
    id: 'credit_burn_mismatch',
    name: 'Credit burn mismatch',
    description: 'Compares credit or allowance burn to invoice treatment where data exists.',
    category: 'contract_billing',
    findingCategory: 'credit_burn_mismatch',
    requiredInputs: ['stripe_invoices_export', 'credits_allowances_csv'],
    defaultEnabled: true,
  },
  {
    id: 'minimum_not_enforced',
    name: 'Minimum not enforced',
    description: 'Detects approved minimum commitments that are not reflected in billing.',
    category: 'contract_billing',
    findingCategory: 'minimum_not_enforced',
    requiredInputs: ['stripe_invoices_export', 'contracts_order_forms'],
    defaultEnabled: true,
  },
  {
    id: 'expired_discount_active',
    name: 'Expired discount active',
    description: 'Detects discounts that remain active after their approved end date.',
    category: 'contract_billing',
    findingCategory: 'expired_discount_active',
    requiredInputs: ['stripe_invoices_export', 'contracts_order_forms'],
    defaultEnabled: true,
  },
  {
    id: 'contract_terms_not_in_billing',
    name: 'Contract terms not in billing',
    description: 'Flags approved contract terms that lack linked billing or pricing rules.',
    category: 'contract_billing',
    findingCategory: 'contract_terms_not_in_billing',
    requiredInputs: ['contracts_order_forms', 'stripe_invoices_export'],
    defaultEnabled: true,
  },
  {
    id: 'cost_exceeds_revenue',
    name: 'Cost exceeds revenue',
    description: 'Flags accounts where cost-to-serve exceeds revenue or target gross margin.',
    category: 'margin_risk',
    findingCategory: 'cost_exceeds_revenue',
    requiredInputs: ['provider_cost_csv', 'stripe_invoices_export'],
    defaultEnabled: true,
  },
]

export function resolveRuleTemplateSelection(selectedIds?: string[]): RuleTemplate[] {
  if (!selectedIds || selectedIds.length === 0) {
    return DEFAULT_RULE_TEMPLATES.filter((template) => template.defaultEnabled)
  }

  const selected = new Set(selectedIds.filter(isRuleTemplateId))

  return DEFAULT_RULE_TEMPLATES.filter((template) => selected.has(template.id))
}

export function isRuleTemplateId(value: string): value is RuleTemplateId {
  return ruleTemplateIdSchema.safeParse(value).success
}
