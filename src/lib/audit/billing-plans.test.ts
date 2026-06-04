import { describe, expect, it } from 'vitest'

import { BILLING_PLANS, billingPlanRecordSchema, getBillingPlan, listActiveBillingPlans } from './billing-plans'

describe('billing plan records', () => {
  it('defines audit, monitoring, and enterprise plan records', () => {
    expect(BILLING_PLANS).toHaveLength(3)
    expect(BILLING_PLANS.map((plan) => plan.id)).toEqual(['audit', 'monitoring', 'enterprise'])
    expect(BILLING_PLANS).toMatchObject([
      {
        id: 'audit',
        name: 'Audit',
        billingCadence: 'one_time',
        commercialModel: 'fixed_fee',
        currency: 'eur',
        basePriceAmount: 500000,
        includedServices: ['workspace_setup', 'upload_review', 'contract_extraction', 'reconciliation_checks', 'evidence_pack'],
      },
      {
        id: 'monitoring',
        name: 'Monitoring',
        billingCadence: 'monthly',
        commercialModel: 'retainer',
        currency: 'eur',
        basePriceAmount: 300000,
        includedServices: ['monthly_workspace', 'scheduled_checks', 'issue_workflow', 'evidence_pack'],
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        billingCadence: 'custom',
        commercialModel: 'custom_quote',
        currency: 'eur',
        includedServices: ['monthly_workspace', 'integrations', 'priority_support', 'security_review', 'custom_terms'],
      },
    ])
  })

  it('validates plan records strictly and normalizes currency', () => {
    const parsed = billingPlanRecordSchema.parse({
      id: 'audit',
      name: 'Audit',
      description: 'One-off operator-assisted revenue integrity audit.',
      status: 'active',
      billingCadence: 'one_time',
      commercialModel: 'fixed_fee',
      currency: 'EUR',
      basePriceAmount: 500000,
      includedServices: ['workspace_setup', 'evidence_pack'],
      metadata: {
        salesMotion: 'founder_led',
      },
    })

    expect(parsed.currency).toBe('eur')
    expect(
      billingPlanRecordSchema.safeParse({
        ...parsed,
        unexpected: 'not allowed',
      }).success,
    ).toBe(false)
  })

  it('lists active plans and resolves a plan by id', () => {
    expect(listActiveBillingPlans().map((plan) => plan.id)).toEqual(['audit', 'monitoring', 'enterprise'])
    expect(getBillingPlan('monitoring')).toMatchObject({
      id: 'monitoring',
      billingCadence: 'monthly',
      commercialModel: 'retainer',
    })
    expect(getBillingPlan('missing')).toBeNull()
  })
})
