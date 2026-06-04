import { describe, expect, it } from 'vitest'

import { createPricingRule } from './pricing-rules'
import { compareContractTermsToPricingRules, summarizePricingRuleComparisons } from './pricing-rule-comparison'
import { contractTermSchema, type ContractTerm } from './schemas'

describe('contract-to-pricing-rule comparison', () => {
  it('matches extracted contract terms to configured pricing rules by type, customer, meter, and billing shape', () => {
    const term = contractTerm({
      id: 'term_rate_northstar',
      customerId: 'contract_northstar',
      type: 'rate',
      meter: 'api_calls',
      unit: '1k_api_calls',
      billingPeriod: 'monthly',
      rate: 2.5,
      currency: 'EUR',
      effectiveFrom: '2026-06-01',
      effectiveTo: '2026-12-31',
      status: 'approved',
    })
    const pricingRule = createPricingRule(
      {
        organizationId: term.organizationId,
        workspaceId: term.workspaceId,
        customerId: 'contract_northstar',
        name: 'Northstar API rate',
        type: 'rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        billingPeriod: 'monthly',
        rate: 2.5,
        currency: 'EUR',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-12-31',
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    const comparisons = compareContractTermsToPricingRules([term], [pricingRule])

    expect(comparisons).toEqual([
      {
        term,
        pricingRule,
        status: 'matched',
        differences: [],
      },
    ])
    expect(summarizePricingRuleComparisons(comparisons)).toEqual({
      matched: 1,
      mismatch: 0,
      missingRule: 0,
      total: 1,
    })
  })

  it('reports mismatched commercial values and effective dates for the best matching rule', () => {
    const term = contractTerm({
      id: 'term_overage_northstar',
      customerId: 'contract_northstar',
      type: 'overage_rate',
      meter: 'api_calls',
      unit: '1k_api_calls',
      billingPeriod: 'monthly',
      threshold: 100_000,
      rate: 2.5,
      currency: 'EUR',
      effectiveFrom: '2026-06-01',
      effectiveTo: '2026-12-31',
      status: 'candidate',
    })
    const pricingRule = createPricingRule(
      {
        organizationId: term.organizationId,
        workspaceId: term.workspaceId,
        customerId: 'contract_northstar',
        name: 'Northstar API overage',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        billingPeriod: 'monthly',
        threshold: 125_000,
        rate: 2.75,
        currency: 'EUR',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2027-05-31',
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    const [comparison] = compareContractTermsToPricingRules([term], [pricingRule])

    expect(comparison).toMatchObject({
      term,
      pricingRule,
      status: 'mismatch',
      differences: [
        {
          field: 'rate',
          contractTermValue: 2.5,
          pricingRuleValue: 2.75,
        },
        {
          field: 'threshold',
          contractTermValue: 100_000,
          pricingRuleValue: 125_000,
        },
        {
          field: 'effectiveTo',
          contractTermValue: '2026-12-31',
          pricingRuleValue: '2027-05-31',
        },
      ],
    })
  })

  it('reports comparable extracted terms with no active configured pricing rule', () => {
    const allowance = contractTerm({
      id: 'term_allowance_northstar',
      type: 'allowance',
      meter: 'api_calls',
      unit: 'calls',
      allowance: 100_000,
      billingPeriod: 'monthly',
      status: 'approved',
    })
    const inactiveRule = createPricingRule(
      {
        organizationId: allowance.organizationId,
        workspaceId: allowance.workspaceId,
        name: 'Inactive allowance',
        type: 'allowance',
        meter: 'api_calls',
        unit: 'calls',
        allowance: 100_000,
        status: 'inactive',
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    const comparisons = compareContractTermsToPricingRules([allowance], [inactiveRule])

    expect(comparisons).toEqual([
      {
        term: allowance,
        pricingRule: undefined,
        status: 'missing_rule',
        differences: [],
      },
    ])
    expect(summarizePricingRuleComparisons(comparisons)).toEqual({
      matched: 0,
      mismatch: 0,
      missingRule: 1,
      total: 1,
    })
  })

  it('ignores rejected terms and contract term types that are not pricing rules', () => {
    const discount = contractTerm({
      id: 'term_rejected_discount',
      type: 'discount',
      discountPercent: 10,
      status: 'rejected',
    })
    const credit = contractTerm({
      id: 'term_credit',
      type: 'credit',
      creditAmount: 50000,
      currency: 'EUR',
      status: 'approved',
    })

    expect(compareContractTermsToPricingRules([discount, credit], [])).toEqual([])
  })
})

function contractTerm(input: Partial<ContractTerm> & Pick<ContractTerm, 'id' | 'type'>): ContractTerm {
  return contractTermSchema.parse({
    id: input.id,
    organizationId: input.organizationId ?? 'org_001',
    workspaceId: input.workspaceId ?? 'workspace_001',
    customerId: input.customerId,
    type: input.type,
    meter: input.meter,
    unit: input.unit,
    billingPeriod: input.billingPeriod,
    rate: input.rate,
    allowance: input.allowance,
    threshold: input.threshold,
    creditAmount: input.creditAmount,
    minimumAmount: input.minimumAmount,
    discountPercent: input.discountPercent,
    currency: input.currency,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    status: input.status ?? 'candidate',
    evidence: input.evidence,
    metadata: input.metadata ?? {},
  })
}
