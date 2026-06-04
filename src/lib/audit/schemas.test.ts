import { describe, expect, it } from 'vitest'

import {
  contractTermSchema,
  findingSchema,
  normalizedCustomerSchema,
  normalizedInvoiceLineSchema,
  normalizedSubscriptionSchema,
  normalizedUsageSchema,
} from './schemas'

describe('audit normalized schemas', () => {
  it('accepts a normalized customer with source references and metadata', () => {
    const customer = normalizedCustomerSchema.parse({
      id: 'cus_internal_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      primaryEmail: 'finance@acme.ai',
      externalIds: {
        stripeCustomerId: 'cus_123',
        usageAccountId: 'acct_789',
      },
      sourceRefs: [{ sourceFileId: 'file_customers', rowNumber: 42 }],
      metadata: { segment: 'enterprise' },
    })

    expect(customer.displayName).toBe('Acme AI')
    expect(customer.workspaceId).toBe('workspace_001')
    expect(customer.externalIds.stripeCustomerId).toBe('cus_123')
  })

  it('rejects usage rows without a positive quantity', () => {
    const result = normalizedUsageSchema.safeParse({
      id: 'usage_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'cus_internal_001',
      accountId: 'acct_789',
      meter: 'llm_tokens',
      quantity: 0,
      unit: 'tokens',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T23:59:59.000Z',
      sourceRefs: [{ sourceFileId: 'file_usage', rowNumber: 2 }],
    })

    expect(result.success).toBe(false)
  })

  it('accepts invoice lines with amount, currency, period, status, and source evidence', () => {
    const line = normalizedInvoiceLineSchema.parse({
      id: 'line_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      invoiceId: 'in_123',
      customerId: 'cus_internal_001',
      description: 'May token overage',
      amount: 19950,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T23:59:59.000Z',
      sourceRefs: [{ sourceFileId: 'file_invoices', rowNumber: 9 }],
    })

    expect(line.currency).toBe('eur')
    expect(line.amount).toBe(19950)
  })

  it('accepts subscription records with cancellation evidence', () => {
    const subscription = normalizedSubscriptionSchema.parse({
      id: 'sub_record_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      subscriptionId: 'sub_123',
      externalCustomerId: 'cus_123',
      status: 'canceled',
      currentPeriodStart: '2026-05-01T00:00:00.000Z',
      currentPeriodEnd: '2026-05-31T23:59:59.000Z',
      canceledAt: '2026-05-15T00:00:00.000Z',
      product: 'API Platform',
      plan: 'enterprise',
      sourceRefs: [{ sourceFileId: 'file_subscriptions', rowNumber: 4 }],
    })

    expect(subscription.status).toBe('canceled')
    expect(subscription.canceledAt).toBe('2026-05-15T00:00:00.000Z')
  })

  it('captures approved contract terms with commercial evidence', () => {
    const term = contractTermSchema.parse({
      id: 'term_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'cus_internal_001',
      type: 'overage_rate',
      meter: 'llm_tokens',
      unit: '1k_tokens',
      rate: 2.5,
      currency: 'eur',
      effectiveFrom: '2026-05-01',
      status: 'approved',
      evidence: {
        sourceFileId: 'contract_acme',
        page: 3,
        snippet: 'Overage charged at EUR 2.50 per 1k tokens.',
      },
    })

    expect(term.status).toBe('approved')
    expect(term.evidence?.page).toBe(3)
  })

  it('keeps findings internal as draft by default', () => {
    const finding = findingSchema.parse({
      id: 'finding_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'cus_internal_001',
      category: 'usage_above_allowance_no_overage',
      severity: 'high',
      title: 'Usage exceeded allowance without overage billing',
      expectedAmount: 5000,
      actualAmount: 0,
      currency: 'eur',
      confidence: 0.91,
      evidenceRefs: [
        { type: 'contract_clause', sourceId: 'term_001' },
        { type: 'invoice_line', sourceId: 'line_001' },
      ],
      recommendedAction: 'Review May invoice before close.',
    })

    expect(finding.status).toBe('draft')
    expect(finding.varianceAmount).toBe(5000)
  })

  it('accepts customer issue workflow statuses for reviewed findings', () => {
    for (const status of ['open', 'investigating', 'accepted', 'fixed', 'ignored', 'closed'] as const) {
      const finding = findingSchema.parse({
        id: `finding_${status}`,
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        customerId: 'cus_internal_001',
        category: 'usage_above_allowance_no_overage',
        severity: 'high',
        title: `Usage issue is ${status}`,
        expectedAmount: 5000,
        actualAmount: 0,
        currency: 'eur',
        confidence: 0.91,
        status,
        evidenceRefs: [{ type: 'usage_record', sourceId: `usage_${status}` }],
        recommendedAction: 'Track remediation with the customer.',
      })

      expect(finding.status).toBe(status)
    }
  })
})
