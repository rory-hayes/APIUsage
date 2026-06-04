import { describe, expect, it } from 'vitest'

import {
  parseAccountMappingCsv,
  parseCreditsAllowancesCsv,
  parseProviderCostCsv,
  parseStripeCustomerCsv,
  parseStripeInvoiceCsv,
  parseStripeSubscriptionCsv,
  parseUsageCsv,
} from './parsers'

describe('audit CSV parsers', () => {
  it('normalizes Stripe invoice CSV rows and reports row-level errors', () => {
    const csv = [
      'id,customer,customer_email,description,amount_due,currency,status,period_start,period_end',
      'in_001,cus_123,finance@acme.ai,May token overage,199.50,EUR,open,2026-05-01,2026-05-31',
      'in_bad,cus_456,finance@example.com,Bad row,not-a-number,EUR,open,2026-05-01,2026-05-31',
    ].join('\n')

    const result = parseStripeInvoiceCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_invoices',
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      invoiceId: 'in_001',
      externalCustomerId: 'cus_123',
      description: 'May token overage',
      amount: 19950,
      currency: 'eur',
      status: 'open',
    })
    expect(result.errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        message: expect.stringContaining('amount'),
      }),
    ])
  })

  it('preserves Stripe invoice finalization, usage quantity, and billing rule metadata when present', () => {
    const csv = [
      'id,customer,customer_email,description,amount_due,currency,status,period_start,period_end,finalized_at,quantity,contract_term_id,billing_rule_id,pricing_rule_id',
      'in_001,cus_123,finance@acme.ai,May token overage,199.50,EUR,paid,2026-05-01,2026-05-31,2026-06-01T10:00:00.000Z,250000,term_api_commit,bill_rule_001,price_rule_001',
    ].join('\n')

    const result = parseStripeInvoiceCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_invoices',
    })

    expect(result.errors).toEqual([])
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      invoiceId: 'in_001',
      metadata: {
        finalizedAt: '2026-06-01T10:00:00.000Z',
        quantity: 250000,
        contractTermId: 'term_api_commit',
        billingRuleId: 'bill_rule_001',
        pricingRuleId: 'price_rule_001',
      },
    })
  })

  it('normalizes Stripe customer CSV rows and reports row-level errors', () => {
    const csv = [
      'id,email,name,created,currency',
      'cus_123,finance@acme.ai,Acme AI,2026-04-01,EUR',
      'cus_bad,not-an-email,Bad Customer,2026-04-02,EUR',
    ].join('\n')

    const result = parseStripeCustomerCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_customers',
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      id: 'file_customers:2:cus_123',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      primaryEmail: 'finance@acme.ai',
      externalIds: {
        stripeCustomerId: 'cus_123',
      },
      sourceRefs: [{ sourceFileId: 'file_customers', rowNumber: 2 }],
      metadata: {
        created: '2026-04-01',
        currency: 'EUR',
      },
    })
    expect(result.errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        message: expect.stringContaining('email'),
      }),
    ])
  })

  it('normalizes mapped usage CSV rows into usage records', () => {
    const csv = [
      'account_id,customer_name,meter_name,total,unit,start,end',
      'acct_789,Acme AI,llm_tokens,250000,tokens,2026-05-01,2026-05-31',
    ].join('\n')

    const result = parseUsageCsv(
      csv,
      {
        accountId: 'account_id',
        customerName: 'customer_name',
        meter: 'meter_name',
        quantity: 'total',
        unit: 'unit',
        periodStart: 'start',
        periodEnd: 'end',
      },
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        sourceFileId: 'file_usage',
      },
    )

    expect(result.errors).toEqual([])
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      accountId: 'acct_789',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 250000,
      unit: 'tokens',
    })
  })

  it('preserves usage arrival metadata from mapped usage CSV rows when present', () => {
    const csv = [
      'account_id,customer_name,meter_name,total,unit,start,end,ingested_at',
      'acct_789,Acme AI,llm_tokens,250000,tokens,2026-05-01,2026-05-31,2026-06-03T09:00:00.000Z',
    ].join('\n')

    const result = parseUsageCsv(
      csv,
      {
        accountId: 'account_id',
        customerName: 'customer_name',
        meter: 'meter_name',
        quantity: 'total',
        unit: 'unit',
        periodStart: 'start',
        periodEnd: 'end',
      },
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        sourceFileId: 'file_usage',
      },
    )

    expect(result.errors).toEqual([])
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      accountId: 'acct_789',
      metadata: {
        ingestedAt: '2026-06-03T09:00:00.000Z',
      },
    })
  })

  it('normalizes provider cost CSV rows and reports row-level errors', () => {
    const csv = [
      'account_id,customer_name,provider,product,model,cost,currency,start,end',
      'acct_789,Acme AI,OpenAI,Responses API,gpt-4.1,240.75,EUR,2026-05-01,2026-05-31',
      'acct_456,Example Ltd,Anthropic,Messages,claude,not-a-cost,EUR,2026-05-01,2026-05-31',
    ].join('\n')

    const result = parseProviderCostCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_costs',
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      id: 'file_costs:2:acct_789:OpenAI:Responses API:gpt-4.1',
      accountId: 'acct_789',
      customerName: 'Acme AI',
      provider: 'OpenAI',
      product: 'Responses API',
      model: 'gpt-4.1',
      costAmount: 24075,
      currency: 'eur',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'file_costs', rowNumber: 2 }],
    })
    expect(result.errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        message: expect.stringContaining('cost'),
      }),
    ])
  })

  it('normalizes customer account mapping CSV rows and reports row-level errors', () => {
    const csv = [
      'display_name,usage_account_id,usage_customer_id,usage_customer_name,stripe_customer_id,stripe_customer_email,contract_customer_id,cost_account_id,note',
      'Northstar AI,acct_northstar,usage_northstar,Northstar AI,cus_northstar,billing@northstar.ai,contract_northstar,cost_northstar,Customer supplied mapping',
      ',acct_missing_name,,,,,,,',
    ].join('\n')

    const result = parseAccountMappingCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_mappings',
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      id: 'file_mappings:2:acct_northstar:cus_northstar',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Northstar AI',
      usageAccountId: 'acct_northstar',
      usageCustomerId: 'usage_northstar',
      usageCustomerName: 'Northstar AI',
      stripeCustomerId: 'cus_northstar',
      stripeCustomerEmail: 'billing@northstar.ai',
      contractCustomerId: 'contract_northstar',
      costAccountId: 'cost_northstar',
      note: 'Customer supplied mapping',
      sourceRefs: [{ sourceFileId: 'file_mappings', rowNumber: 2 }],
    })
    expect(result.errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        message: expect.stringContaining('display name'),
      }),
    ])
  })

  it('normalizes credits and allowances CSV rows into candidate contract terms', () => {
    const csv = [
      'customer_id,type,meter,unit,allowance,credit_amount,currency,effective_from,effective_to,evidence_snippet',
      'acct_northstar,allowance,api_calls,calls,100000,,EUR,2026-06-01,2026-06-30,Monthly included API-call allowance',
      'acct_northstar,credit,,, ,50000,EUR,2026-06-01,,Prepaid credit ledger balance',
      'acct_bad,discount,,,,,EUR,2026-06-01,,Discount rows are not supported by this parser',
    ].join('\n')

    const result = parseCreditsAllowancesCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_credits_allowances',
    })

    expect(result.records).toHaveLength(2)
    expect(result.records).toMatchObject([
      {
        id: 'term_workspace_001_file_credits_allowances_allowance_2',
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        customerId: 'acct_northstar',
        type: 'allowance',
        meter: 'api_calls',
        unit: 'calls',
        allowance: 100000,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-06-30',
        status: 'candidate',
        evidence: {
          sourceFileId: 'file_credits_allowances',
          snippet: 'Monthly included API-call allowance',
        },
        metadata: {
          source: 'credits_allowances_csv',
          sourceRowNumber: 2,
        },
      },
      {
        id: 'term_workspace_001_file_credits_allowances_credit_3',
        type: 'credit',
        creditAmount: 50000,
        currency: 'eur',
        effectiveFrom: '2026-06-01',
        status: 'candidate',
      },
    ])
    expect(result.errors).toEqual([
      expect.objectContaining({
        rowNumber: 4,
        message: expect.stringContaining('Unsupported credit/allowance type'),
      }),
    ])
  })

  it('normalizes Stripe subscription CSV rows and reports row-level errors', () => {
    const csv = [
      'id,customer,status,current_period_start,current_period_end,canceled_at,product,plan',
      'sub_001,cus_123,canceled,2026-05-01,2026-05-31,2026-05-15,API Platform,enterprise',
      'sub_bad,cus_456,active,not-a-date,2026-05-31,,API Platform,pro',
    ].join('\n')

    const result = parseStripeSubscriptionCsv(csv, {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: 'file_subscriptions',
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      id: 'file_subscriptions:2:sub_001',
      subscriptionId: 'sub_001',
      externalCustomerId: 'cus_123',
      status: 'canceled',
      product: 'API Platform',
      plan: 'enterprise',
      currentPeriodStart: '2026-05-01T00:00:00.000Z',
      currentPeriodEnd: '2026-05-31T00:00:00.000Z',
      canceledAt: '2026-05-15T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'file_subscriptions', rowNumber: 2 }],
    })
    expect(result.errors).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        message: expect.stringContaining('date'),
      }),
    ])
  })
})
