import { describe, expect, it } from 'vitest'

import { buildCustomerFindingDetail } from './finding-detail'
import { type ParsedRecord } from './parse-jobs'
import { findingSchema, type Finding } from './schemas'

describe('customer finding detail', () => {
  it('builds a customer-visible finding detail with sanitized evidence summaries', () => {
    const finding = findingRecord({
      status: 'approved_internal',
      evidenceRefs: [
        { type: 'usage_record', sourceId: 'usage_001' },
        { type: 'invoice_line', sourceId: 'line_001' },
        { type: 'contract_clause', sourceId: 'term_001' },
      ],
      internalNote: 'Internal parser note with sensitive context.',
    })
    const detail = buildCustomerFindingDetail({
      finding,
      parsedRecords: [
        usageParsedRecord({
          metadata: {
            secretInternalJoinKey: 'should-not-leak',
          },
        }),
        invoiceParsedRecord(),
      ],
    })

    expect(detail).toMatchObject({
      id: 'finding_001',
      title: 'Billable usage has no matching invoice line',
      customer: 'Acme AI',
      severity: 'high',
      status: 'approved_internal',
      expectedAmount: 500000,
      actualAmount: 0,
      varianceAmount: 500000,
      currency: 'eur',
      confidence: 0.91,
      customerNote: 'We found May usage that may not have been included on your invoice.',
      recommendedAction: 'Review billing configuration before the May close.',
      evidence: [
        {
          type: 'usage_record',
          sourceId: 'usage_001',
          summary: 'Acme AI · llm_tokens · 250,000 tokens',
          sourceFileId: 'src_usage',
          rowNumber: 2,
        },
        {
          type: 'invoice_line',
          sourceId: 'line_001',
          summary: 'in_001 · cus_123 · €1,995.00 · open',
          sourceFileId: 'src_invoice',
          rowNumber: 7,
        },
        {
          type: 'contract_clause',
          sourceId: 'term_001',
          summary: 'contract_clause term_001',
        },
      ],
    })
    expect(JSON.stringify(detail)).not.toContain('Internal parser note')
    expect(JSON.stringify(detail)).not.toContain('should-not-leak')
  })

  it('does not build detail for draft findings', () => {
    const detail = buildCustomerFindingDetail({
      finding: findingRecord({ status: 'draft' }),
      parsedRecords: [usageParsedRecord()],
    })

    expect(detail).toBeNull()
  })
})

function findingRecord(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    id: 'finding_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    varianceAmount: 500000,
    currency: 'eur',
    confidence: 0.91,
    status: 'approved_internal',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before the May close.',
    customerNote: 'We found May usage that may not have been included on your invoice.',
    internalNote: 'Internal parser note.',
    metadata: {
      customerName: 'Acme AI',
    },
    ...overrides,
  })
}

function usageParsedRecord(overrides: { metadata?: Record<string, unknown> } = {}): ParsedRecord {
  return {
    id: 'parsed_usage_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_usage',
    uploadId: 'upl_usage',
    sourceFileId: 'src_usage',
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id: 'usage_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      accountId: 'acct_001',
      customerName: 'Acme AI',
      meter: 'llm_tokens',
      quantity: 250000,
      unit: 'tokens',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_usage', rowNumber: 2 }],
      metadata: overrides.metadata ?? {},
    },
  }
}

function invoiceParsedRecord(): ParsedRecord {
  return {
    id: 'parsed_invoice_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_invoice',
    uploadId: 'upl_invoice',
    sourceFileId: 'src_invoice',
    recordType: 'invoice_line',
    sourceRowNumber: 7,
    data: {
      id: 'line_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      invoiceId: 'in_001',
      externalCustomerId: 'cus_123',
      description: 'May token overage',
      amount: 199500,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_invoice', rowNumber: 7 }],
      metadata: {},
    },
  }
}
