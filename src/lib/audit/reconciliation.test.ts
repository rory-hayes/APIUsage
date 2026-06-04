import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { approveAccountMapping, createManualAccountMapping, buildAccountMappingSuggestions } from './account-mapping'
import {
  generateAccountMappingMismatchFindings,
  generateCancelledAccountUsageFindings,
  generateContractTermsNotInBillingFindings,
  generateCostExceedsRevenueFindings,
  generateReconciliationFindings,
  generateCreditBurnMismatchFindings,
  generateDuplicateUsageFindings,
  generateExpiredDiscountActiveFindings,
  generateInternalUsageBilledFindings,
  generateInvoiceWithoutUsageFindings,
  generateLateUsageAfterInvoiceFinalizationFindings,
  generateMissingUsageFindings,
  generateMinimumNotEnforcedFindings,
  generatePaidUsageMarkedFreeFindings,
  generateUsageAboveAllowanceFindings,
  generateUsageWithoutInvoiceFindings,
  generateWrongOverageRateFindings,
  JsonFindingStore,
  reviewFinding,
} from './reconciliation'
import { isCustomerVisibleFinding } from './evidence-pack'
import { type ParsedRecord } from './parse-jobs'
import { type ContractTerm } from './schemas'

describe('audit reconciliation checks', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-reconciliation-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('generates a draft finding when billable usage has no matching invoice line', () => {
    const usage = usageRecord({
      id: 'parsed_usage_001',
      normalizedId: 'usage_001',
      accountId: 'acct_001',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 250000,
    })

    const findings = generateUsageWithoutInvoiceFindings([usage], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_usage_exists_no_invoice_acct_001_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_exists_no_invoice',
      severity: 'medium',
      status: 'draft',
      title: 'Billable usage has no matching invoice line',
      expectedAmount: 0,
      actualAmount: 0,
      currency: 'eur',
      confidence: 0.72,
      evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
      recommendedAction: 'Review billing configuration and confirm whether this usage should appear on the May invoice.',
      metadata: {
        checkId: 'usage_without_invoice',
        accountKey: 'acct_001',
        customerName: 'Acme AI',
        meter: 'llm_tokens',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        quantity: 250000,
        unit: 'tokens',
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a finding when usage has a matching invoice line for the same account and period', () => {
    const usage = usageRecord({
      accountId: 'cus_123',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_123',
      description: 'May llm_tokens overage',
    })

    const findings = generateUsageWithoutInvoiceFindings([usage, invoice])

    expect(findings).toEqual([])
  })

  it('generates findings only for the selected rule templates', () => {
    const usage = usageRecord({ accountId: 'acct_usage_only', customerName: 'Usage Only Co' })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_invoice_only',
      description: 'May usage overage',
      amount: 19950,
      metadata: { quantity: 1000 },
    })

    const findings = generateReconciliationFindings(
      [usage, invoice],
      [],
      new Date('2026-06-01T12:00:00.000Z'),
      [],
      ['usage_without_invoice'],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].category).toBe('usage_exists_no_invoice')
    expect(findings.map((finding) => finding.category)).not.toContain('invoice_without_usage')
  })

  it('does not treat usage marked internal as missing invoice evidence', () => {
    const usage = usageRecord({
      accountId: 'acct_internal',
      customerName: 'Internal Labs',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { billingClass: 'internal' },
    })

    const findings = generateUsageWithoutInvoiceFindings([usage], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved account mappings to match usage and invoice records with different source identifiers', () => {
    const usage = usageRecord({
      accountId: 'acct_acme_usage',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_acme_stripe',
      description: 'May llm_tokens overage',
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      usageAccountId: 'acct_acme_usage',
      stripeCustomerId: 'cus_acme_stripe',
      reviewerId: 'internal_admin',
    })

    const findings = generateUsageWithoutInvoiceFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'), [mapping])

    expect(findings).toEqual([])
  })

  it('does not trust suggested account mappings until an internal operator approves them', () => {
    const usage = usageRecord({
      accountId: 'acct_acme_usage',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_acme_stripe',
      customerEmail: 'billing@acme.ai',
      description: 'May llm_tokens overage',
    })
    const [suggested] = buildAccountMappingSuggestions([
      usageRecord({
        id: 'usage_acme',
        accountId: 'acct_acme_usage',
        customerName: 'Acme AI',
        meter: 'llm_tokens',
        metadata: { domain: 'acme.ai' },
      }),
      invoiceLineRecord({
        id: 'invoice_acme',
        externalCustomerId: 'cus_acme_stripe',
        customerEmail: 'billing@acme.ai',
        description: 'May llm_tokens overage',
      }),
    ])

    const suggestedFindings = generateUsageWithoutInvoiceFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'), [suggested])
    const approvedFindings = generateUsageWithoutInvoiceFindings(
      [usage, invoice],
      new Date('2026-06-01T12:00:00.000Z'),
      [approveAccountMapping(suggested, { reviewerId: 'internal_admin' })],
    )

    expect(suggestedFindings).toHaveLength(1)
    expect(suggestedFindings[0].category).toBe('usage_exists_no_invoice')
    expect(approvedFindings).toEqual([])
  })

  it('generates a draft finding when a suggested mapping would reconcile usage to billing', () => {
    const usage = usageRecord({
      id: 'parsed_usage_mapping_mismatch',
      normalizedId: 'usage_mapping_mismatch',
      accountId: 'acct_acme_usage',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 1000,
      metadata: { domain: 'acme.ai' },
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_mapping_mismatch',
      normalizedId: 'line_mapping_mismatch',
      externalCustomerId: 'cus_acme_stripe',
      customerEmail: 'billing@acme.ai',
      description: 'May llm_tokens overage',
      amount: 19950,
    })
    const [suggested] = buildAccountMappingSuggestions([usage, invoice], new Date('2026-06-01T11:00:00.000Z'))

    const findings = generateAccountMappingMismatchFindings(
      [usage, invoice],
      new Date('2026-06-01T12:00:00.000Z'),
      [suggested],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_account_mapping_mismatch_acct_acme_usage_cus_acme_stripe',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'account_mapping_mismatch',
      severity: 'medium',
      status: 'draft',
      title: 'Usage and billing account mapping needs review',
      expectedAmount: 0,
      actualAmount: 0,
      varianceAmount: 0,
      currency: 'eur',
      confidence: 0.9,
      evidenceRefs: [
        { type: 'mapping', sourceId: 'map_workspace_001_acct_acme_usage_cus_acme_stripe' },
        { type: 'usage_record', sourceId: 'usage_mapping_mismatch' },
        { type: 'invoice_line', sourceId: 'line_mapping_mismatch' },
      ],
      recommendedAction: 'Approve or reject the suggested account mapping before publishing revenue leakage findings for this account.',
      metadata: {
        checkId: 'account_mapping_mismatch',
        mappingId: 'map_workspace_001_acct_acme_usage_cus_acme_stripe',
        usageAccountId: 'acct_acme_usage',
        stripeCustomerId: 'cus_acme_stripe',
        stripeCustomerEmail: 'billing@acme.ai',
        customerName: 'Acme AI',
        matchReasons: ['domain_match'],
        billedAmount: 19950,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate an account mapping mismatch finding after the mapping is approved', () => {
    const usage = usageRecord({
      accountId: 'acct_acme_usage',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      metadata: { domain: 'acme.ai' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_acme_stripe',
      customerEmail: 'billing@acme.ai',
      description: 'May llm_tokens overage',
    })
    const [suggested] = buildAccountMappingSuggestions([usage, invoice], new Date('2026-06-01T11:00:00.000Z'))

    const findings = generateAccountMappingMismatchFindings(
      [usage, invoice],
      new Date('2026-06-01T12:00:00.000Z'),
      [approveAccountMapping(suggested, { reviewerId: 'internal_admin' })],
    )

    expect(findings).toEqual([])
  })

  it('includes account mapping mismatch findings in aggregate runs and suppresses unresolved usage/invoice leakage noise', () => {
    const usage = usageRecord({
      id: 'parsed_usage_mapping_mismatch',
      normalizedId: 'usage_mapping_mismatch',
      accountId: 'acct_acme_usage',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      metadata: { domain: 'acme.ai' },
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_mapping_mismatch',
      normalizedId: 'line_mapping_mismatch',
      externalCustomerId: 'cus_acme_stripe',
      customerEmail: 'billing@acme.ai',
      description: 'May llm_tokens overage',
    })
    const [suggested] = buildAccountMappingSuggestions([usage, invoice], new Date('2026-06-01T11:00:00.000Z'))

    const findings = generateReconciliationFindings([usage, invoice], [], new Date('2026-06-01T12:00:00.000Z'), [suggested])

    expect(findings.map((finding) => finding.category)).toEqual(['account_mapping_mismatch'])
  })

  it('still generates a finding when the only same-account invoice line is unrelated to usage', () => {
    const usage = usageRecord({
      accountId: 'cus_123',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_123',
      description: 'May platform subscription',
    })

    const findings = generateUsageWithoutInvoiceFindings([usage, invoice])

    expect(findings).toHaveLength(1)
    expect(findings[0].category).toBe('usage_exists_no_invoice')
  })

  it('generates a draft finding when a usage invoice line has no matching usage record', () => {
    const unrelatedUsage = usageRecord({
      id: 'parsed_usage_other',
      normalizedId: 'usage_other',
      accountId: 'acct_other',
      customerName: 'Other Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_without_usage',
      normalizedId: 'line_without_usage',
      externalCustomerId: 'acct_billed_no_usage',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateInvoiceWithoutUsageFindings(
      [unrelatedUsage, invoice],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_invoice_without_usage_acct_billed_no_usage_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'invoice_without_usage',
      severity: 'medium',
      status: 'draft',
      title: 'Usage invoice line has no matching usage record',
      expectedAmount: 0,
      actualAmount: 19950,
      varianceAmount: -19950,
      currency: 'eur',
      confidence: 0.74,
      evidenceRefs: [{ type: 'invoice_line', sourceId: 'line_without_usage' }],
      recommendedAction: 'Confirm whether this usage charge has source usage evidence or should be adjusted before close.',
      metadata: {
        checkId: 'invoice_without_usage',
        accountKey: 'acct_billed_no_usage',
        invoiceId: 'in_001',
        description: 'May llm_tokens overage',
        billedAmount: 19950,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate an invoice-without-usage finding when matching usage exists', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_present',
      customerName: 'Usage Present Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_usage_present',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateInvoiceWithoutUsageFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved mappings when matching invoice usage charges to usage records', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_mapped',
      customerName: 'Mapped Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_stripe_mapped',
      description: 'May llm_tokens overage',
      amount: 19950,
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Mapped Usage Ltd.',
      usageAccountId: 'acct_usage_mapped',
      stripeCustomerId: 'cus_stripe_mapped',
      reviewerId: 'internal_admin',
    })

    const findings = generateInvoiceWithoutUsageFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'), [mapping])

    expect(findings).toEqual([])
  })

  it('does not generate invoice-without-usage findings before usage data is available', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_pending_usage_export',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateInvoiceWithoutUsageFindings([invoice], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('includes invoice-without-usage findings in aggregate operator runs', () => {
    const usage = usageRecord({
      id: 'parsed_usage_other',
      normalizedId: 'usage_other',
      accountId: 'acct_other',
      customerName: 'Other Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_billed_no_usage',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateReconciliationFindings([usage, invoice], [], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['usage_exists_no_invoice', 'invoice_without_usage'])
  })

  it('generates a draft finding when an invoice bills more quantity than usage records support', () => {
    const usage = usageRecord({
      id: 'parsed_usage_under_recorded',
      normalizedId: 'usage_under_recorded',
      accountId: 'acct_under_recorded',
      customerName: 'Under Recorded Ltd.',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_missing_usage',
      normalizedId: 'line_missing_usage',
      externalCustomerId: 'acct_under_recorded',
      description: 'May llm_tokens usage',
      amount: 15000,
      metadata: { quantity: 1500 },
    })

    const findings = generateMissingUsageFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_missing_usage_acct_under_recorded_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'missing_usage',
      severity: 'medium',
      status: 'draft',
      title: 'Invoice quantity exceeds recorded usage',
      expectedAmount: 10000,
      actualAmount: 15000,
      varianceAmount: -5000,
      currency: 'eur',
      confidence: 0.75,
      evidenceRefs: [
        { type: 'invoice_line', sourceId: 'line_missing_usage' },
        { type: 'usage_record', sourceId: 'usage_under_recorded' },
      ],
      recommendedAction: 'Confirm whether usage events are missing from the export or whether the invoice quantity should be corrected.',
      metadata: {
        checkId: 'missing_usage',
        accountKey: 'acct_under_recorded',
        invoiceId: 'in_001',
        meter: 'llm_tokens',
        billedQuantity: 1500,
        recordedQuantity: 1000,
        unsupportedQuantity: 500,
        billedAmount: 15000,
        supportedAmount: 10000,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a missing-usage finding when recorded usage covers invoice quantity', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_covers_invoice',
      customerName: 'Covered Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 1500,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_usage_covers_invoice',
      description: 'May llm_tokens usage',
      amount: 15000,
      metadata: { quantity: 1500 },
    })

    const findings = generateMissingUsageFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved mappings when comparing invoiced quantity to recorded usage quantity', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_under_recorded',
      customerName: 'Mapped Under Recorded Ltd.',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_under_recorded_stripe',
      description: 'May llm_tokens usage',
      amount: 15000,
      metadata: { quantity: 1500 },
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Mapped Under Recorded Ltd.',
      usageAccountId: 'acct_usage_under_recorded',
      stripeCustomerId: 'cus_under_recorded_stripe',
      reviewerId: 'internal_admin',
    })

    const findings = generateMissingUsageFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'), [mapping])

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      category: 'missing_usage',
      expectedAmount: 10000,
      actualAmount: 15000,
      metadata: expect.objectContaining({
        unsupportedQuantity: 500,
      }),
    })
  })

  it('includes missing-usage findings in aggregate operator runs', () => {
    const usage = usageRecord({
      accountId: 'acct_under_recorded',
      customerName: 'Under Recorded Ltd.',
      meter: 'llm_tokens',
      quantity: 1000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_under_recorded',
      description: 'May llm_tokens usage',
      amount: 15000,
      metadata: { quantity: 1500 },
    })

    const findings = generateReconciliationFindings([usage, invoice], [], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['missing_usage'])
  })

  it('generates a draft finding when usage arrives after invoice finalization', () => {
    const usage = usageRecord({
      id: 'parsed_usage_late',
      normalizedId: 'usage_late',
      accountId: 'acct_late_usage',
      customerName: 'Late Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { ingestedAt: '2026-06-03T09:00:00.000Z' },
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_finalized',
      normalizedId: 'line_finalized',
      externalCustomerId: 'acct_late_usage',
      description: 'May llm_tokens usage',
      amount: 19950,
      metadata: { finalizedAt: '2026-06-01T10:00:00.000Z' },
    })

    const findings = generateLateUsageAfterInvoiceFinalizationFindings([usage, invoice], new Date('2026-06-04T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_late_usage_after_invoice_finalization_acct_late_usage_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'late_usage_after_invoice_finalization',
      severity: 'medium',
      status: 'draft',
      title: 'Usage arrived after invoice finalization',
      expectedAmount: 0,
      actualAmount: 0,
      varianceAmount: 0,
      currency: 'eur',
      confidence: 0.76,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_late' },
        { type: 'invoice_line', sourceId: 'line_finalized' },
      ],
      recommendedAction: 'Review invoice finalization timing and confirm whether late-arriving usage should be adjusted or included in the next billing cycle.',
      metadata: {
        checkId: 'late_usage_after_invoice_finalization',
        accountKey: 'acct_late_usage',
        customerName: 'Late Usage Ltd.',
        meter: 'llm_tokens',
        quantity: 5000,
        unit: 'tokens',
        invoiceId: 'in_001',
        invoiceFinalizedAt: '2026-06-01T10:00:00.000Z',
        usageArrivedAt: '2026-06-03T09:00:00.000Z',
        ranAt: '2026-06-04T12:00:00.000Z',
      },
    })
  })

  it('does not generate a late-usage finding when usage arrives inside the configured grace period', () => {
    const usage = usageRecord({
      id: 'parsed_usage_grace_period',
      normalizedId: 'usage_grace_period',
      accountId: 'acct_late_usage',
      customerName: 'Late Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { ingestedAt: '2026-06-03T09:00:00.000Z' },
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_finalized_grace_period',
      normalizedId: 'line_finalized_grace_period',
      externalCustomerId: 'acct_late_usage',
      description: 'May llm_tokens usage',
      amount: 19950,
      metadata: { finalizedAt: '2026-06-01T10:00:00.000Z' },
    })

    const findings = generateLateUsageAfterInvoiceFinalizationFindings([usage, invoice], new Date('2026-06-04T12:00:00.000Z'), [], {
      lateUsageGracePeriodDays: 3,
    })

    expect(findings).toEqual([])
  })

  it('does not generate a late-usage finding when usage arrived before invoice finalization', () => {
    const usage = usageRecord({
      accountId: 'acct_on_time_usage',
      customerName: 'On Time Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { ingestedAt: '2026-06-01T09:00:00.000Z' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_on_time_usage',
      description: 'May llm_tokens usage',
      amount: 19950,
      metadata: { finalizedAt: '2026-06-01T10:00:00.000Z' },
    })

    const findings = generateLateUsageAfterInvoiceFinalizationFindings([usage, invoice], new Date('2026-06-04T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('does not generate a late-usage finding without explicit finalization and arrival timestamps', () => {
    const usage = usageRecord({
      accountId: 'acct_missing_timestamps',
      customerName: 'Missing Timestamp Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_missing_timestamps',
      description: 'May llm_tokens usage',
      amount: 19950,
    })

    const findings = generateLateUsageAfterInvoiceFinalizationFindings([usage, invoice], new Date('2026-06-04T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved mappings when checking late usage after invoice finalization', () => {
    const usage = usageRecord({
      accountId: 'acct_late_usage',
      customerName: 'Mapped Late Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { receivedAt: '2026-06-03T09:00:00.000Z' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_late_usage_stripe',
      description: 'May llm_tokens usage',
      amount: 19950,
      metadata: { invoiceFinalizedAt: '2026-06-01T10:00:00.000Z' },
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Mapped Late Usage Ltd.',
      usageAccountId: 'acct_late_usage',
      stripeCustomerId: 'cus_late_usage_stripe',
      reviewerId: 'internal_admin',
    })

    const findings = generateLateUsageAfterInvoiceFinalizationFindings([usage, invoice], new Date('2026-06-04T12:00:00.000Z'), [mapping])

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      category: 'late_usage_after_invoice_finalization',
      metadata: expect.objectContaining({
        invoiceFinalizedAt: '2026-06-01T10:00:00.000Z',
        usageArrivedAt: '2026-06-03T09:00:00.000Z',
      }),
    })
  })

  it('includes late-usage findings in aggregate operator runs', () => {
    const usage = usageRecord({
      accountId: 'acct_late_usage',
      customerName: 'Late Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { ingestedAt: '2026-06-03T09:00:00.000Z' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_late_usage',
      description: 'May llm_tokens usage',
      amount: 19950,
      metadata: { finalizedAt: '2026-06-01T10:00:00.000Z' },
    })

    const findings = generateReconciliationFindings([usage, invoice], [], new Date('2026-06-04T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['late_usage_after_invoice_finalization'])
  })

  it('generates a draft finding when an approved billing-required contract term has no billing-system evidence', () => {
    const customTerm = contractTerm({
      id: 'term_custom_support_uplift',
      customerId: 'acct_contract_gap',
      type: 'special_term',
      currency: 'eur',
      metadata: {
        billingRequired: true,
        summary: 'Support uplift must be configured in billing.',
      },
    })
    const unrelatedInvoice = invoiceLineRecord({
      externalCustomerId: 'acct_other_customer',
      description: 'May platform subscription',
      amount: 25000,
    })

    const findings = generateContractTermsNotInBillingFindings([unrelatedInvoice], [customTerm], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_contract_terms_not_in_billing_acct_contract_gap_term_custom_support_uplift',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'acct_contract_gap',
      category: 'contract_terms_not_in_billing',
      severity: 'high',
      status: 'draft',
      title: 'Approved contract term is not reflected in billing evidence',
      expectedAmount: 0,
      actualAmount: 0,
      varianceAmount: 0,
      currency: 'eur',
      confidence: 0.73,
      evidenceRefs: [{ type: 'contract_clause', sourceId: 'term_custom_support_uplift' }],
      recommendedAction: 'Map the approved contract term to a billing rule or confirm it does not need billing-system enforcement before close.',
      metadata: {
        checkId: 'contract_terms_not_in_billing',
        accountKey: 'acct_contract_gap',
        termId: 'term_custom_support_uplift',
        termType: 'special_term',
        billingRequired: true,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a contract-term billing finding when invoice metadata references the approved term', () => {
    const customTerm = contractTerm({
      id: 'term_custom_support_uplift',
      customerId: 'acct_contract_ok',
      type: 'special_term',
      metadata: { billingRequired: true },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_contract_ok',
      description: 'May platform subscription',
      metadata: { contractTermId: 'term_custom_support_uplift' },
    })

    const findings = generateContractTermsNotInBillingFindings([invoice], [customTerm], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved account mappings when checking whether billing evidence references a contract term', () => {
    const customTerm = contractTerm({
      id: 'term_custom_support_uplift',
      customerId: 'contract_acme',
      type: 'special_term',
      metadata: { billingRequired: true },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_acme_stripe',
      description: 'May platform subscription',
      metadata: { billingRuleId: 'term_custom_support_uplift' },
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      contractCustomerId: 'contract_acme',
      stripeCustomerId: 'cus_acme_stripe',
      reviewerId: 'internal_admin',
    })

    const findings = generateContractTermsNotInBillingFindings([invoice], [customTerm], new Date('2026-06-01T12:00:00.000Z'), [mapping])

    expect(findings).toEqual([])
  })

  it('ignores contract terms that are not approved or not explicitly billing-required', () => {
    const candidateTerm = contractTerm({
      id: 'term_candidate',
      customerId: 'acct_contract_gap',
      type: 'special_term',
      status: 'candidate',
      metadata: { billingRequired: true },
    })
    const informationalTerm = contractTerm({
      id: 'term_informational',
      customerId: 'acct_contract_gap',
      type: 'special_term',
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_other_customer',
      description: 'May platform subscription',
    })

    const findings = generateContractTermsNotInBillingFindings(
      [invoice],
      [candidateTerm, informationalTerm],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('includes contract-term billing evidence findings in aggregate operator runs', () => {
    const customTerm = contractTerm({
      id: 'term_custom_support_uplift',
      customerId: 'acct_contract_gap',
      type: 'special_term',
      metadata: { billingRequired: true },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_other_customer',
      description: 'May platform subscription',
    })

    const findings = generateReconciliationFindings([invoice], [customTerm], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['contract_terms_not_in_billing'])
  })

  it('generates a draft finding when usage records are exact duplicates', () => {
    const firstUsage = usageRecord({
      id: 'parsed_usage_duplicate_first',
      normalizedId: 'usage_duplicate_first',
      accountId: 'acct_duplicate',
      customerName: 'Duplicate Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const secondUsage = usageRecord({
      id: 'parsed_usage_duplicate_second',
      normalizedId: 'usage_duplicate_second',
      accountId: 'acct_duplicate',
      customerName: 'Duplicate Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })

    const findings = generateDuplicateUsageFindings([firstUsage, secondUsage], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_duplicate_usage_acct_duplicate_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'duplicate_usage',
      severity: 'medium',
      status: 'draft',
      title: 'Duplicate usage records detected',
      expectedAmount: 0,
      actualAmount: 0,
      varianceAmount: 0,
      currency: 'eur',
      confidence: 0.76,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_duplicate_first' },
        { type: 'usage_record', sourceId: 'usage_duplicate_second' },
      ],
      recommendedAction: 'Review the usage export for repeated rows before relying on this data for billing or reconciliation.',
      metadata: {
        checkId: 'duplicate_usage',
        accountKey: 'acct_duplicate',
        customerName: 'Duplicate Usage Ltd.',
        meter: 'llm_tokens',
        quantity: 5000,
        unit: 'tokens',
        duplicateCount: 2,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a duplicate usage finding when quantities differ', () => {
    const firstUsage = usageRecord({
      accountId: 'acct_legit_repeated_usage',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const secondUsage = usageRecord({
      id: 'parsed_usage_different_quantity',
      normalizedId: 'usage_different_quantity',
      accountId: 'acct_legit_repeated_usage',
      meter: 'llm_tokens',
      quantity: 6000,
    })

    const findings = generateDuplicateUsageFindings([firstUsage, secondUsage], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('does not generate a duplicate usage finding when periods differ', () => {
    const firstUsage = usageRecord({
      accountId: 'acct_next_period_usage',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const secondUsage = usageRecord({
      id: 'parsed_usage_next_period',
      normalizedId: 'usage_next_period',
      accountId: 'acct_next_period_usage',
      meter: 'llm_tokens',
      quantity: 5000,
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T00:00:00.000Z',
    })

    const findings = generateDuplicateUsageFindings([firstUsage, secondUsage], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('includes duplicate usage findings in aggregate operator runs', () => {
    const firstUsage = usageRecord({
      id: 'parsed_usage_duplicate_first',
      normalizedId: 'usage_duplicate_first',
      accountId: 'acct_duplicate',
      customerName: 'Duplicate Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const secondUsage = usageRecord({
      id: 'parsed_usage_duplicate_second',
      normalizedId: 'usage_duplicate_second',
      accountId: 'acct_duplicate',
      customerName: 'Duplicate Usage Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_duplicate',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateReconciliationFindings([firstUsage, secondUsage, invoice], [], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['duplicate_usage'])
  })

  it('generates a draft finding when usage marked internal is billed', () => {
    const usage = usageRecord({
      id: 'parsed_usage_internal',
      normalizedId: 'usage_internal',
      accountId: 'acct_internal',
      customerName: 'Internal Labs',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { billingClass: 'internal' },
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_internal',
      normalizedId: 'line_internal',
      externalCustomerId: 'acct_internal',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateInternalUsageBilledFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_internal_usage_billed_acct_internal_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'internal_usage_billed',
      severity: 'high',
      status: 'draft',
      title: 'Internal or free usage was billed',
      expectedAmount: 0,
      actualAmount: 19950,
      varianceAmount: -19950,
      currency: 'eur',
      confidence: 0.78,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_internal' },
        { type: 'invoice_line', sourceId: 'line_internal' },
      ],
      recommendedAction: 'Review billing rules and credit or suppress charges for usage marked internal, test, demo, or free.',
      metadata: {
        checkId: 'internal_usage_billed',
        accountKey: 'acct_internal',
        customerName: 'Internal Labs',
        meter: 'llm_tokens',
        quantity: 5000,
        unit: 'tokens',
        nonBillableReason: 'internal',
        billedAmount: 19950,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate an internal-usage finding for production billable usage', () => {
    const usage = usageRecord({
      accountId: 'acct_billable',
      customerName: 'Billable Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { billingClass: 'billable', environment: 'production' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_billable',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateInternalUsageBilledFindings([usage, invoice], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved mappings when checking internal usage billed through Stripe', () => {
    const usage = usageRecord({
      accountId: 'acct_internal_usage',
      customerName: 'Internal Labs',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { environment: 'test' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_internal_stripe',
      description: 'May llm_tokens overage',
      amount: 19950,
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Internal Labs',
      usageAccountId: 'acct_internal_usage',
      stripeCustomerId: 'cus_internal_stripe',
      reviewerId: 'internal_admin',
    })

    const findings = generateInternalUsageBilledFindings(
      [usage, invoice],
      new Date('2026-06-01T12:00:00.000Z'),
      [mapping],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      category: 'internal_usage_billed',
      metadata: expect.objectContaining({
        nonBillableReason: 'test',
        billedAmount: 19950,
      }),
    })
  })

  it('includes internal-usage billed findings in aggregate operator runs', () => {
    const usage = usageRecord({
      accountId: 'acct_internal',
      customerName: 'Internal Labs',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { usageClass: 'free' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_internal',
      description: 'May llm_tokens overage',
      amount: 19950,
    })

    const findings = generateReconciliationFindings([usage, invoice], [], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['internal_usage_billed'])
  })

  it('generates a draft finding when usage marked free has an approved paid rate and no invoice', () => {
    const usage = usageRecord({
      id: 'parsed_usage_marked_free',
      normalizedId: 'usage_marked_free',
      accountId: 'acct_paid',
      customerName: 'Paid Account Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { usageClass: 'free' },
    })
    const rate = contractTerm({
      id: 'term_rate_paid',
      customerId: 'acct_paid',
      type: 'rate',
      meter: 'llm_tokens',
      rate: 0.002,
      unit: 'tokens',
      currency: 'eur',
    })

    const findings = generatePaidUsageMarkedFreeFindings([usage], [rate], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_paid_usage_marked_free_acct_paid_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'paid_usage_marked_free',
      severity: 'high',
      status: 'draft',
      title: 'Paid usage was classified as free or internal',
      expectedAmount: 1000,
      actualAmount: 0,
      varianceAmount: 1000,
      currency: 'eur',
      confidence: 0.77,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_marked_free' },
        { type: 'pricing_rule', sourceId: 'term_rate_paid' },
      ],
      recommendedAction: 'Review usage classification and billing rules, then invoice or reclassify the paid usage before close.',
      metadata: {
        checkId: 'paid_usage_marked_free',
        accountKey: 'acct_paid',
        customerName: 'Paid Account Ltd.',
        meter: 'llm_tokens',
        quantity: 5000,
        unit: 'tokens',
        nonBillableReason: 'free',
        rate: 0.002,
        expectedAmount: 1000,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a paid-usage-marked-free finding when matching billing exists', () => {
    const usage = usageRecord({
      accountId: 'acct_paid_billed',
      customerName: 'Paid Billed Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { usageClass: 'free' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_paid_billed',
      description: 'May llm_tokens usage',
      amount: 1000,
    })

    const findings = generatePaidUsageMarkedFreeFindings(
      [usage, invoice],
      [
        contractTerm({
          customerId: 'acct_paid_billed',
          type: 'rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('ignores candidate paid rates when checking usage marked free', () => {
    const usage = usageRecord({
      accountId: 'acct_candidate_rate',
      customerName: 'Candidate Rate Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { usageClass: 'free' },
    })

    const findings = generatePaidUsageMarkedFreeFindings(
      [usage],
      [
        contractTerm({
          customerId: 'acct_candidate_rate',
          type: 'rate',
          status: 'candidate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('includes paid-usage-marked-free findings in aggregate operator runs', () => {
    const usage = usageRecord({
      accountId: 'acct_paid',
      customerName: 'Paid Account Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      metadata: { billingClass: 'free' },
    })
    const rate = contractTerm({
      customerId: 'acct_paid',
      type: 'rate',
      meter: 'llm_tokens',
      rate: 0.002,
      unit: 'tokens',
      currency: 'eur',
    })

    const findings = generateReconciliationFindings([usage], [rate], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['paid_usage_marked_free'])
  })

  it('generates a draft finding when usage exceeds an approved allowance and overage billing is missing', () => {
    const usage = usageRecord({
      id: 'parsed_usage_acme',
      normalizedId: 'usage_acme',
      accountId: 'acct_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const allowance = contractTerm({
      id: 'term_allowance_acme',
      customerId: 'acct_acme',
      type: 'allowance',
      meter: 'llm_tokens',
      allowance: 100000,
      unit: 'tokens',
    })
    const overageRate = contractTerm({
      id: 'term_overage_rate_acme',
      customerId: 'acct_acme',
      type: 'overage_rate',
      meter: 'llm_tokens',
      rate: 0.002,
      unit: 'tokens',
      currency: 'eur',
    })

    const findings = generateUsageAboveAllowanceFindings(
      [usage],
      [allowance, overageRate],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_usage_above_allowance_acct_acme_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: undefined,
      category: 'usage_above_allowance_no_overage',
      severity: 'high',
      status: 'draft',
      title: 'Usage exceeded contract allowance without sufficient overage billing',
      expectedAmount: 5000,
      actualAmount: 0,
      varianceAmount: 5000,
      currency: 'eur',
      confidence: 0.8,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_acme' },
        { type: 'contract_clause', sourceId: 'term_allowance_acme' },
        { type: 'pricing_rule', sourceId: 'term_overage_rate_acme' },
      ],
      metadata: {
        checkId: 'usage_above_allowance',
        accountKey: 'acct_acme',
        customerName: 'Acme AI',
        meter: 'llm_tokens',
        allowance: 100000,
        quantity: 125000,
        overageQuantity: 25000,
        rate: 0.002,
        unit: 'tokens',
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('uses the approved allowance threshold before flagging overage shortfalls', () => {
    const usage = usageRecord({
      id: 'parsed_usage_threshold_tolerance',
      normalizedId: 'usage_threshold_tolerance',
      accountId: 'acct_threshold',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const allowance = {
      ...contractTerm({
        id: 'term_allowance_threshold',
        customerId: 'acct_threshold',
        type: 'allowance',
        meter: 'llm_tokens',
        allowance: 100000,
        unit: 'tokens',
      }),
      threshold: 30000,
    } as ContractTerm & { threshold: number }
    const overageRate = contractTerm({
      id: 'term_overage_rate_threshold',
      customerId: 'acct_threshold',
      type: 'overage_rate',
      meter: 'llm_tokens',
      rate: 0.002,
      unit: 'tokens',
      currency: 'eur',
    })

    const findings = generateUsageAboveAllowanceFindings(
      [usage],
      [allowance, overageRate],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('does not generate an allowance finding when approved overage billing covers the expected amount', () => {
    const usage = usageRecord({
      accountId: 'acct_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_acme',
      description: 'May llm_tokens overage',
      amount: 5000,
    })

    const findings = generateUsageAboveAllowanceFindings(
      [usage, invoice],
      [
        contractTerm({
          customerId: 'acct_acme',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'acct_acme',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('uses approved account mappings when matching allowance terms and overage invoice lines', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_stripe_acme',
      description: 'May llm_tokens overage',
      amount: 2500,
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      usageAccountId: 'acct_usage_acme',
      stripeCustomerId: 'cus_stripe_acme',
      contractCustomerId: 'contract_acme',
      reviewerId: 'internal_admin',
    })

    const findings = generateUsageAboveAllowanceFindings(
      [usage, invoice],
      [
        contractTerm({
          customerId: 'contract_acme',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'contract_acme',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
      [mapping],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      expectedAmount: 5000,
      actualAmount: 2500,
      varianceAmount: 2500,
      evidenceRefs: expect.arrayContaining([{ type: 'invoice_line', sourceId: 'line_001' }]),
    })
  })

  it('ignores candidate allowance terms until an internal operator approves them', () => {
    const usage = usageRecord({
      accountId: 'acct_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })

    const findings = generateUsageAboveAllowanceFindings(
      [usage],
      [
        contractTerm({
          customerId: 'acct_acme',
          type: 'allowance',
          status: 'candidate',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'acct_acme',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('generates a draft finding when an overage invoice line uses the wrong unit rate', () => {
    const usage = usageRecord({
      id: 'parsed_usage_acme',
      normalizedId: 'usage_acme',
      accountId: 'acct_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_acme',
      description: 'May llm_tokens overage',
      amount: 2500,
      metadata: {
        unitRate: 0.001,
        quantity: 25000,
      },
    })

    const findings = generateWrongOverageRateFindings(
      [usage, invoice],
      [
        contractTerm({
          id: 'term_allowance_acme',
          customerId: 'acct_acme',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          id: 'term_overage_rate_acme',
          customerId: 'acct_acme',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_wrong_overage_rate_acct_acme_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'wrong_overage_rate',
      severity: 'high',
      status: 'draft',
      title: 'Invoice overage rate does not match approved contract rate',
      expectedAmount: 5000,
      actualAmount: 2500,
      varianceAmount: 2500,
      currency: 'eur',
      confidence: 0.86,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_acme' },
        { type: 'contract_clause', sourceId: 'term_allowance_acme' },
        { type: 'pricing_rule', sourceId: 'term_overage_rate_acme' },
        { type: 'invoice_line', sourceId: 'line_001' },
      ],
      metadata: {
        checkId: 'wrong_overage_rate',
        accountKey: 'acct_acme',
        customerName: 'Acme AI',
        meter: 'llm_tokens',
        allowance: 100000,
        quantity: 125000,
        overageQuantity: 25000,
        expectedRate: 0.002,
        actualRate: 0.001,
        unit: 'tokens',
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a wrong-rate finding without invoice unit-rate evidence', () => {
    const usage = usageRecord({
      accountId: 'acct_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_acme',
      description: 'May llm_tokens overage',
      amount: 2500,
    })

    const findings = generateWrongOverageRateFindings(
      [usage, invoice],
      [
        contractTerm({
          customerId: 'acct_acme',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'acct_acme',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('uses approved mappings when detecting wrong overage rates across usage, contracts, and Stripe', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_acme',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_stripe_acme',
      description: 'May llm_tokens overage',
      amount: 2500,
      metadata: {
        unitRate: 0.001,
        quantity: 25000,
      },
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      usageAccountId: 'acct_usage_acme',
      stripeCustomerId: 'cus_stripe_acme',
      contractCustomerId: 'contract_acme',
      reviewerId: 'internal_admin',
    })

    const findings = generateWrongOverageRateFindings(
      [usage, invoice],
      [
        contractTerm({
          customerId: 'contract_acme',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'contract_acme',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
      [mapping],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].category).toBe('wrong_overage_rate')
  })

  it('generates all supported draft reconciliation findings from one operator run', () => {
    const missingInvoiceUsage = usageRecord({
      id: 'parsed_usage_missing_invoice',
      normalizedId: 'usage_missing_invoice',
      accountId: 'acct_missing_invoice',
      customerName: 'No Invoice Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const overAllowanceUsage = usageRecord({
      id: 'parsed_usage_over_allowance',
      normalizedId: 'usage_over_allowance',
      accountId: 'acct_over_allowance',
      customerName: 'Over Allowance Ltd.',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const underbilledOverageInvoice = invoiceLineRecord({
      id: 'parsed_invoice_over_allowance',
      externalCustomerId: 'acct_over_allowance',
      description: 'May llm_tokens overage',
      amount: 2500,
    })

    const findings = generateReconciliationFindings(
      [missingInvoiceUsage, overAllowanceUsage, underbilledOverageInvoice],
      [
        contractTerm({
          customerId: 'acct_over_allowance',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'acct_over_allowance',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings.map((finding) => finding.category).sort()).toEqual(['usage_above_allowance_no_overage', 'usage_exists_no_invoice'])
  })

  it('classifies explicit unit-rate mismatches as wrong-rate findings during an operator run', () => {
    const usage = usageRecord({
      id: 'parsed_usage_wrong_rate',
      normalizedId: 'usage_wrong_rate',
      accountId: 'acct_wrong_rate',
      customerName: 'Wrong Rate Ltd.',
      meter: 'llm_tokens',
      quantity: 125000,
    })
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_wrong_rate',
      externalCustomerId: 'acct_wrong_rate',
      description: 'May llm_tokens overage',
      amount: 2500,
      metadata: {
        unitRate: 0.001,
        quantity: 25000,
      },
    })

    const findings = generateReconciliationFindings(
      [usage, invoice],
      [
        contractTerm({
          customerId: 'acct_wrong_rate',
          type: 'allowance',
          meter: 'llm_tokens',
          allowance: 100000,
          unit: 'tokens',
        }),
        contractTerm({
          customerId: 'acct_wrong_rate',
          type: 'overage_rate',
          meter: 'llm_tokens',
          rate: 0.002,
          unit: 'tokens',
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings.map((finding) => finding.category)).toEqual(['wrong_overage_rate'])
  })

  it('generates a draft finding when contracted credits are not fully applied on invoice lines', () => {
    const creditInvoice = invoiceLineRecord({
      id: 'parsed_invoice_credit',
      normalizedId: 'line_credit_001',
      externalCustomerId: 'acct_credit_shortfall',
      description: 'May prepaid credit balance applied',
      amount: -70000,
    })
    const creditTerm = contractTerm({
      id: 'term_credit_acme',
      customerId: 'acct_credit_shortfall',
      type: 'credit',
      creditAmount: 100000,
      currency: 'eur',
    })

    const findings = generateCreditBurnMismatchFindings(
      [creditInvoice],
      [creditTerm],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_credit_burn_mismatch_acct_credit_shortfall_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'credit_burn_mismatch',
      severity: 'high',
      status: 'draft',
      title: 'Contracted credits were not fully applied to invoice',
      expectedAmount: 100000,
      actualAmount: 70000,
      varianceAmount: 30000,
      currency: 'eur',
      confidence: 0.79,
      evidenceRefs: [
        { type: 'contract_clause', sourceId: 'term_credit_acme' },
        { type: 'credit_balance', sourceId: 'line_credit_001' },
      ],
      recommendedAction: 'Review prepaid credit balance treatment and adjust the invoice or credit ledger before close.',
      metadata: {
        checkId: 'credit_burn_mismatch',
        accountKey: 'acct_credit_shortfall',
        expectedCreditAmount: 100000,
        actualCreditAmount: 70000,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('includes credit burn mismatches in aggregate operator runs', () => {
    const creditInvoice = invoiceLineRecord({
      externalCustomerId: 'acct_credit_shortfall',
      description: 'May prepaid credit balance applied',
      amount: -70000,
    })

    const findings = generateReconciliationFindings(
      [creditInvoice],
      [
        contractTerm({
          customerId: 'acct_credit_shortfall',
          type: 'credit',
          creditAmount: 100000,
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings.map((finding) => finding.category)).toEqual(['credit_burn_mismatch'])
  })

  it('generates a draft finding when an approved monthly minimum is not met by invoice revenue', () => {
    const invoice = invoiceLineRecord({
      id: 'parsed_invoice_minimum_shortfall',
      normalizedId: 'line_minimum_shortfall',
      externalCustomerId: 'acct_minimum_shortfall',
      description: 'May platform subscription',
      amount: 12000,
    })
    const minimumTerm = contractTerm({
      id: 'term_minimum_acme',
      customerId: 'acct_minimum_shortfall',
      type: 'minimum',
      minimumAmount: 20000,
      currency: 'eur',
    })

    const findings = generateMinimumNotEnforcedFindings(
      [invoice],
      [minimumTerm],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_minimum_not_enforced_acct_minimum_shortfall_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'acct_minimum_shortfall',
      category: 'minimum_not_enforced',
      severity: 'high',
      status: 'draft',
      title: 'Contract minimum was not fully invoiced',
      expectedAmount: 20000,
      actualAmount: 12000,
      varianceAmount: 8000,
      currency: 'eur',
      confidence: 0.81,
      evidenceRefs: [
        { type: 'contract_clause', sourceId: 'term_minimum_acme' },
        { type: 'invoice_line', sourceId: 'line_minimum_shortfall' },
      ],
      recommendedAction: 'Review the customer invoice against the approved minimum commitment and add an adjustment before close.',
      metadata: {
        checkId: 'minimum_not_enforced',
        accountKey: 'acct_minimum_shortfall',
        minimumAmount: 20000,
        revenueAmount: 12000,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('uses approved mappings when matching contract minimums to Stripe invoice revenue', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_stripe_minimum',
      description: 'May platform subscription',
      amount: 12000,
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Minimum Shortfall Ltd.',
      stripeCustomerId: 'cus_stripe_minimum',
      contractCustomerId: 'contract_minimum',
      reviewerId: 'internal_admin',
    })

    const findings = generateMinimumNotEnforcedFindings(
      [invoice],
      [
        contractTerm({
          customerId: 'contract_minimum',
          type: 'minimum',
          minimumAmount: 20000,
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
      [mapping],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      category: 'minimum_not_enforced',
      expectedAmount: 20000,
      actualAmount: 12000,
    })
  })

  it('does not generate a minimum finding when invoice revenue meets the approved minimum', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_minimum_met',
      description: 'May platform subscription',
      amount: 20000,
    })

    const findings = generateMinimumNotEnforcedFindings(
      [invoice],
      [
        contractTerm({
          customerId: 'acct_minimum_met',
          type: 'minimum',
          minimumAmount: 20000,
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('does not generate a minimum finding before invoice data is available', () => {
    const findings = generateMinimumNotEnforcedFindings(
      [],
      [
        contractTerm({
          customerId: 'acct_minimum_pending_invoice_export',
          type: 'minimum',
          minimumAmount: 20000,
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('includes contract minimum shortfalls in aggregate operator runs', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_minimum_shortfall',
      description: 'May platform subscription',
      amount: 12000,
    })

    const findings = generateReconciliationFindings(
      [invoice],
      [
        contractTerm({
          customerId: 'acct_minimum_shortfall',
          type: 'minimum',
          minimumAmount: 20000,
          currency: 'eur',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings.map((finding) => finding.category)).toEqual(['minimum_not_enforced'])
  })

  it('generates a draft finding when an expired discount is still applied to an invoice', () => {
    const discountInvoice = invoiceLineRecord({
      id: 'parsed_invoice_expired_discount',
      normalizedId: 'line_expired_discount',
      externalCustomerId: 'acct_expired_discount',
      description: 'May promotional discount',
      amount: -3000,
    })
    const discountTerm = contractTerm({
      id: 'term_discount_acme',
      customerId: 'acct_expired_discount',
      type: 'discount',
      discountPercent: 15,
      effectiveTo: '2026-04-30',
    })

    const findings = generateExpiredDiscountActiveFindings(
      [discountInvoice],
      [discountTerm],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_expired_discount_active_acct_expired_discount_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: 'acct_expired_discount',
      category: 'expired_discount_active',
      severity: 'high',
      status: 'draft',
      title: 'Expired discount was still applied to invoice',
      expectedAmount: 3000,
      actualAmount: 0,
      varianceAmount: 3000,
      currency: 'eur',
      confidence: 0.8,
      evidenceRefs: [
        { type: 'contract_clause', sourceId: 'term_discount_acme' },
        { type: 'invoice_line', sourceId: 'line_expired_discount' },
      ],
      recommendedAction: 'Review the invoice discount against the approved contract end date and remove or reverse the expired discount before close.',
      metadata: {
        checkId: 'expired_discount_active',
        accountKey: 'acct_expired_discount',
        discountPercent: 15,
        discountAmount: 3000,
        expiredAt: '2026-04-30',
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('uses approved mappings when matching expired discounts to Stripe invoice lines', () => {
    const discountInvoice = invoiceLineRecord({
      externalCustomerId: 'cus_stripe_discount',
      description: 'May promotional discount',
      amount: -3000,
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Expired Discount Ltd.',
      stripeCustomerId: 'cus_stripe_discount',
      contractCustomerId: 'contract_discount',
      reviewerId: 'internal_admin',
    })

    const findings = generateExpiredDiscountActiveFindings(
      [discountInvoice],
      [
        contractTerm({
          customerId: 'contract_discount',
          type: 'discount',
          discountPercent: 15,
          effectiveTo: '2026-04-30',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
      [mapping],
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      category: 'expired_discount_active',
      expectedAmount: 3000,
      actualAmount: 0,
    })
  })

  it('does not generate an expired discount finding while the discount is still effective', () => {
    const discountInvoice = invoiceLineRecord({
      externalCustomerId: 'acct_active_discount',
      description: 'May promotional discount',
      amount: -3000,
    })

    const findings = generateExpiredDiscountActiveFindings(
      [discountInvoice],
      [
        contractTerm({
          customerId: 'acct_active_discount',
          type: 'discount',
          discountPercent: 15,
          effectiveTo: '2026-05-31',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings).toEqual([])
  })

  it('includes expired active discounts in aggregate operator runs', () => {
    const discountInvoice = invoiceLineRecord({
      externalCustomerId: 'acct_expired_discount',
      description: 'May promotional discount',
      amount: -3000,
    })

    const findings = generateReconciliationFindings(
      [discountInvoice],
      [
        contractTerm({
          customerId: 'acct_expired_discount',
          type: 'discount',
          discountPercent: 15,
          effectiveTo: '2026-04-30',
        }),
      ],
      new Date('2026-06-01T12:00:00.000Z'),
    )

    expect(findings.map((finding) => finding.category)).toEqual(['expired_discount_active'])
  })

  it('generates a draft finding when provider cost exceeds same-period invoice revenue', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_margin_leak',
      description: 'May platform and usage revenue',
      amount: 20000,
    })
    const cost = costRecord({
      id: 'parsed_cost_margin_leak',
      normalizedId: 'cost_margin_leak',
      accountId: 'acct_margin_leak',
      customerName: 'Margin Leak Ltd.',
      provider: 'OpenAI',
      product: 'Responses API',
      model: 'gpt-4.1',
      costAmount: 27500,
    })

    const findings = generateCostExceedsRevenueFindings([invoice, cost], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_cost_exceeds_revenue_acct_margin_leak_openai_gpt_4_1_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'cost_exceeds_revenue',
      severity: 'critical',
      status: 'draft',
      title: 'Provider cost exceeds invoiced revenue for account',
      expectedAmount: 27500,
      actualAmount: 20000,
      varianceAmount: 7500,
      currency: 'eur',
      confidence: 0.82,
      evidenceRefs: [
        { type: 'cost_record', sourceId: 'cost_margin_leak' },
        { type: 'invoice_line', sourceId: 'line_001' },
      ],
      metadata: {
        checkId: 'cost_exceeds_revenue',
        accountKey: 'acct_margin_leak',
        customerName: 'Margin Leak Ltd.',
        provider: 'OpenAI',
        product: 'Responses API',
        model: 'gpt-4.1',
        costAmount: 27500,
        revenueAmount: 20000,
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a cost finding when invoice revenue covers provider cost', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_profitable',
      description: 'May platform and usage revenue',
      amount: 50000,
    })
    const cost = costRecord({
      accountId: 'acct_profitable',
      customerName: 'Profitable Ltd.',
      costAmount: 27500,
    })

    const findings = generateCostExceedsRevenueFindings([invoice, cost], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved mappings when matching provider cost to Stripe revenue', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'cus_stripe_margin',
      description: 'May platform and usage revenue',
      amount: 20000,
    })
    const cost = costRecord({
      accountId: 'cost_acct_margin',
      customerName: 'Margin Leak Ltd.',
      costAmount: 27500,
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Margin Leak Ltd.',
      stripeCustomerId: 'cus_stripe_margin',
      costAccountId: 'cost_acct_margin',
      reviewerId: 'internal_admin',
    })

    const findings = generateCostExceedsRevenueFindings([invoice, cost], new Date('2026-06-01T12:00:00.000Z'), [mapping])

    expect(findings).toHaveLength(1)
    expect(findings[0].category).toBe('cost_exceeds_revenue')
  })

  it('includes cost greater than revenue in aggregate operator runs', () => {
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_margin_leak',
      description: 'May platform and usage revenue',
      amount: 20000,
    })
    const cost = costRecord({
      accountId: 'acct_margin_leak',
      customerName: 'Margin Leak Ltd.',
      provider: 'OpenAI',
      model: 'gpt-4.1',
      costAmount: 27500,
    })

    const findings = generateReconciliationFindings([invoice, cost], [], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['cost_exceeds_revenue'])
  })

  it('generates a draft finding when usage continues after subscription cancellation', () => {
    const usage = usageRecord({
      id: 'parsed_usage_cancelled',
      normalizedId: 'usage_cancelled',
      accountId: 'acct_cancelled',
      customerName: 'Cancelled Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const subscription = subscriptionRecord({
      id: 'parsed_subscription_cancelled',
      normalizedId: 'sub_cancelled',
      externalCustomerId: 'acct_cancelled',
      status: 'canceled',
      canceledAt: '2026-05-15T00:00:00.000Z',
    })

    const findings = generateCancelledAccountUsageFindings([usage, subscription], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      id: 'finding_workspace_001_cancelled_account_usage_acct_cancelled_llm_tokens_2026_05_01',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'cancelled_account_usage',
      severity: 'high',
      status: 'draft',
      title: 'Usage continued after subscription cancellation',
      expectedAmount: 0,
      actualAmount: 0,
      varianceAmount: 0,
      currency: 'eur',
      confidence: 0.78,
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_cancelled' },
        { type: 'subscription', sourceId: 'sub_cancelled' },
      ],
      metadata: {
        checkId: 'cancelled_account_usage',
        accountKey: 'acct_cancelled',
        customerName: 'Cancelled Ltd.',
        meter: 'llm_tokens',
        quantity: 5000,
        subscriptionStatus: 'canceled',
        cancellationEffectiveAt: '2026-05-15T00:00:00.000Z',
        ranAt: '2026-06-01T12:00:00.000Z',
      },
    })
  })

  it('does not generate a cancelled-usage finding for active subscriptions', () => {
    const usage = usageRecord({
      accountId: 'acct_active',
      customerName: 'Active Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const subscription = subscriptionRecord({
      externalCustomerId: 'acct_active',
      status: 'active',
    })

    const findings = generateCancelledAccountUsageFindings([usage, subscription], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('does not generate a cancelled-usage finding when usage ended before cancellation', () => {
    const usage = usageRecord({
      accountId: 'acct_cancelled',
      customerName: 'Cancelled Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
      periodEnd: '2026-05-10T00:00:00.000Z',
    })
    const subscription = subscriptionRecord({
      externalCustomerId: 'acct_cancelled',
      status: 'canceled',
      canceledAt: '2026-05-15T00:00:00.000Z',
    })

    const findings = generateCancelledAccountUsageFindings([usage, subscription], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings).toEqual([])
  })

  it('uses approved mappings when matching cancelled Stripe subscriptions to usage accounts', () => {
    const usage = usageRecord({
      accountId: 'acct_usage_cancelled',
      customerName: 'Cancelled Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const subscription = subscriptionRecord({
      externalCustomerId: 'cus_stripe_cancelled',
      status: 'canceled',
      canceledAt: '2026-05-15T00:00:00.000Z',
    })
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Cancelled Ltd.',
      usageAccountId: 'acct_usage_cancelled',
      stripeCustomerId: 'cus_stripe_cancelled',
      reviewerId: 'internal_admin',
    })

    const findings = generateCancelledAccountUsageFindings([usage, subscription], new Date('2026-06-01T12:00:00.000Z'), [mapping])

    expect(findings).toHaveLength(1)
    expect(findings[0].category).toBe('cancelled_account_usage')
  })

  it('includes cancelled account usage in aggregate operator runs', () => {
    const usage = usageRecord({
      id: 'parsed_usage_cancelled',
      normalizedId: 'usage_cancelled',
      accountId: 'acct_cancelled',
      customerName: 'Cancelled Ltd.',
      meter: 'llm_tokens',
      quantity: 5000,
    })
    const subscription = subscriptionRecord({
      id: 'parsed_subscription_cancelled',
      normalizedId: 'sub_cancelled',
      externalCustomerId: 'acct_cancelled',
      status: 'canceled',
      canceledAt: '2026-05-15T00:00:00.000Z',
    })

    const findings = generateReconciliationFindings([usage, subscription], [], new Date('2026-06-01T12:00:00.000Z'))

    expect(findings.map((finding) => finding.category)).toEqual(['cancelled_account_usage'])
  })

  it('persists findings and reloads them by workspace', async () => {
    const store = new JsonFindingStore(join(tempDir, 'findings.json'))
    const findings = generateUsageWithoutInvoiceFindings([
      usageRecord({
        id: 'parsed_usage_001',
        normalizedId: 'usage_001',
        accountId: 'acct_001',
        meter: 'llm_tokens',
      }),
    ])

    await store.saveMany(findings)

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual(findings)
    await expect(store.listByWorkspace('other_workspace')).resolves.toEqual([])
  })

  it('approves a draft finding with reviewer and separate customer note', () => {
    const [finding] = generateUsageWithoutInvoiceFindings([
      usageRecord({
        id: 'parsed_usage_001',
        normalizedId: 'usage_001',
        accountId: 'acct_001',
        meter: 'llm_tokens',
      }),
    ])

    const reviewed = reviewFinding(
      finding,
      {
        status: 'approved_internal',
        reviewerId: 'internal_admin',
        internalNote: 'Confirmed the usage row has no corresponding usage invoice line.',
        customerNote: 'We found usage that may not have been included on the May invoice.',
      },
      new Date('2026-06-01T13:00:00.000Z'),
    )

    expect(reviewed).toMatchObject({
      status: 'approved_internal',
      reviewerId: 'internal_admin',
      customerNote: 'We found usage that may not have been included on the May invoice.',
      metadata: expect.objectContaining({
        reviewedAt: '2026-06-01T13:00:00.000Z',
      }),
    })
    expect(reviewed.internalNote).toContain('Generated from parsed record parsed_usage_001.')
    expect(reviewed.internalNote).toContain('Confirmed the usage row has no corresponding usage invoice line.')
  })

  it('rejects a draft finding without making it customer visible', () => {
    const [finding] = generateUsageWithoutInvoiceFindings([
      usageRecord({
        id: 'parsed_usage_001',
        normalizedId: 'usage_001',
        accountId: 'acct_001',
        meter: 'llm_tokens',
      }),
    ])

    const reviewed = reviewFinding(
      finding,
      {
        status: 'rejected',
        reviewerId: 'internal_admin',
        internalNote: 'False positive: this customer is invoiced through a manual enterprise invoice.',
      },
      new Date('2026-06-01T13:30:00.000Z'),
    )

    expect(reviewed).toMatchObject({
      status: 'rejected',
      reviewerId: 'internal_admin',
      customerNote: undefined,
      metadata: expect.objectContaining({
        reviewedAt: '2026-06-01T13:30:00.000Z',
      }),
    })
    expect(reviewed.internalNote).toContain('False positive')
  })

  it('marks a finding as needing customer input without making it customer visible', () => {
    const [finding] = generateUsageWithoutInvoiceFindings([
      usageRecord({
        id: 'parsed_usage_001',
        normalizedId: 'usage_001',
        accountId: 'acct_001',
        meter: 'llm_tokens',
      }),
    ])

    const reviewed = reviewFinding(
      finding,
      {
        status: 'needs_customer_input' as never,
        reviewerId: 'internal_admin',
        internalNote: 'Need the customer to send the June committed-usage amendment before approval.',
        customerNote: 'Please send the signed June committed-usage amendment.',
      },
      new Date('2026-06-01T14:00:00.000Z'),
    )

    expect(reviewed).toMatchObject({
      status: 'needs_customer_input',
      reviewerId: 'internal_admin',
      customerNote: 'Please send the signed June committed-usage amendment.',
      metadata: expect.objectContaining({
        reviewedAt: '2026-06-01T14:00:00.000Z',
      }),
    })
    expect(reviewed.internalNote).toContain('Need the customer to send the June committed-usage amendment before approval.')
    expect(isCustomerVisibleFinding(reviewed)).toBe(false)
  })

  it('updates a persisted finding when review is saved', async () => {
    const store = new JsonFindingStore(join(tempDir, 'findings.json'))
    const [finding] = generateUsageWithoutInvoiceFindings([
      usageRecord({
        id: 'parsed_usage_001',
        normalizedId: 'usage_001',
        accountId: 'acct_001',
        meter: 'llm_tokens',
      }),
    ])
    await store.saveMany([finding])

    const reviewed = reviewFinding(finding, {
      status: 'approved_internal',
      reviewerId: 'internal_admin',
      internalNote: 'Approved after invoice spot check.',
    })
    await store.saveMany([reviewed])

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([reviewed])
  })
})

function usageRecord(overrides: {
  id?: string
  normalizedId?: string
  accountId?: string
  customerName?: string
  meter?: string
  quantity?: number
  periodStart?: string
  periodEnd?: string
  metadata?: Record<string, unknown>
}): ParsedRecord {
  const normalizedId = overrides.normalizedId ?? 'usage_001'

  return {
    id: overrides.id ?? 'parsed_usage_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_usage',
    uploadId: 'upl_usage',
    sourceFileId: 'src_usage',
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id: normalizedId,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      accountId: overrides.accountId,
      customerName: overrides.customerName,
      meter: overrides.meter ?? 'llm_tokens',
      quantity: overrides.quantity ?? 1000,
      unit: 'tokens',
      periodStart: overrides.periodStart ?? '2026-05-01T00:00:00.000Z',
      periodEnd: overrides.periodEnd ?? '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_usage', rowNumber: 2 }],
      metadata: overrides.metadata ?? {},
    },
  }
}

function invoiceLineRecord(overrides: {
  id?: string
  normalizedId?: string
  externalCustomerId?: string
  customerEmail?: string
  description?: string
  amount?: number
  metadata?: Record<string, unknown>
}): ParsedRecord {
  const normalizedId = overrides.normalizedId ?? 'line_001'

  return {
    id: overrides.id ?? 'parsed_invoice_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_invoice',
    uploadId: 'upl_invoice',
    sourceFileId: 'src_invoice',
    recordType: 'invoice_line',
    sourceRowNumber: 2,
    data: {
      id: normalizedId,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      invoiceId: 'in_001',
      externalCustomerId: overrides.externalCustomerId,
      customerEmail: overrides.customerEmail,
      description: overrides.description ?? 'May usage overage',
      amount: overrides.amount ?? 19950,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_invoice', rowNumber: 2 }],
      metadata: overrides.metadata ?? {},
    },
  }
}

function costRecord(overrides: {
  id?: string
  normalizedId?: string
  accountId?: string
  customerName?: string
  provider?: string
  product?: string
  model?: string
  costAmount?: number
}): ParsedRecord {
  const normalizedId = overrides.normalizedId ?? 'cost_001'

  return {
    id: overrides.id ?? 'parsed_cost_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_cost',
    uploadId: 'upl_cost',
    sourceFileId: 'src_cost',
    recordType: 'cost',
    sourceRowNumber: 2,
    data: {
      id: normalizedId,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      accountId: overrides.accountId,
      customerName: overrides.customerName,
      provider: overrides.provider ?? 'OpenAI',
      product: overrides.product ?? 'Responses API',
      model: overrides.model ?? 'gpt-4.1',
      costAmount: overrides.costAmount ?? 27500,
      currency: 'eur',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_cost', rowNumber: 2 }],
      metadata: {},
    },
  }
}

function subscriptionRecord(overrides: {
  id?: string
  normalizedId?: string
  externalCustomerId?: string
  status?: string
  canceledAt?: string
}): ParsedRecord {
  const normalizedId = overrides.normalizedId ?? 'sub_001'

  return {
    id: overrides.id ?? 'parsed_subscription_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_subscription',
    uploadId: 'upl_subscription',
    sourceFileId: 'src_subscription',
    recordType: 'subscription',
    sourceRowNumber: 2,
    data: {
      id: normalizedId,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      subscriptionId: 'stripe_sub_001',
      externalCustomerId: overrides.externalCustomerId,
      status: overrides.status ?? 'canceled',
      product: 'API Platform',
      plan: 'enterprise',
      currentPeriodStart: '2026-05-01T00:00:00.000Z',
      currentPeriodEnd: '2026-05-31T00:00:00.000Z',
      canceledAt: overrides.canceledAt,
      sourceRefs: [{ sourceFileId: 'src_subscription', rowNumber: 2 }],
      metadata: {},
    },
  }
}

function contractTerm(overrides: Partial<ContractTerm> & Pick<ContractTerm, 'type'>): ContractTerm {
  return {
    id: overrides.id ?? `term_${overrides.type}_001`,
    organizationId: overrides.organizationId ?? 'org_001',
    workspaceId: overrides.workspaceId ?? 'workspace_001',
    customerId: overrides.customerId,
    type: overrides.type,
    meter: overrides.meter,
    unit: overrides.unit,
    rate: overrides.rate,
    allowance: overrides.allowance,
    creditAmount: overrides.creditAmount,
    minimumAmount: overrides.minimumAmount,
    discountPercent: overrides.discountPercent,
    currency: overrides.currency,
    effectiveFrom: overrides.effectiveFrom,
    effectiveTo: overrides.effectiveTo,
    status: overrides.status ?? 'approved',
    evidence: overrides.evidence ?? {
      sourceFileId: 'src_contract',
      page: 2,
      snippet: `${overrides.type} term`,
    },
    metadata: overrides.metadata ?? {},
  }
}
