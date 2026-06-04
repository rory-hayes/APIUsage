import { describe, expect, it } from 'vitest'

import { summarizeParsedRecord } from './parsed-record-display'
import { type ParsedRecord } from './parse-jobs'

describe('parsed record display', () => {
  it('summarizes usage records with customer, meter, and quantity', () => {
    const record: ParsedRecord = {
      id: 'parsed_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: 'parse_001',
      uploadId: 'upl_001',
      sourceFileId: 'file_001',
      recordType: 'usage',
      sourceRowNumber: 2,
      data: {
        customerName: 'Acme AI',
        meter: 'llm_tokens',
        quantity: 250000,
        unit: 'tokens',
      },
    }

    expect(summarizeParsedRecord(record)).toBe('Acme AI · llm_tokens · 250,000 tokens')
  })

  it('summarizes invoice line records with invoice, customer, amount, and status', () => {
    const record: ParsedRecord = {
      id: 'parsed_002',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: 'parse_002',
      uploadId: 'upl_002',
      sourceFileId: 'file_002',
      recordType: 'invoice_line',
      sourceRowNumber: 2,
      data: {
        invoiceId: 'in_001',
        externalCustomerId: 'cus_123',
        amount: 19950,
        currency: 'eur',
        status: 'paid',
      },
    }

    expect(summarizeParsedRecord(record)).toBe('in_001 · cus_123 · €199.50 · paid')
  })

  it('summarizes customer records with display name, email, and Stripe ID', () => {
    const record: ParsedRecord = {
      id: 'parsed_customer',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: 'parse_customer',
      uploadId: 'upl_customer',
      sourceFileId: 'file_customer',
      recordType: 'customer',
      sourceRowNumber: 2,
      data: {
        displayName: 'Acme AI',
        primaryEmail: 'finance@acme.ai',
        externalIds: {
          stripeCustomerId: 'cus_123',
        },
      },
    }

    expect(summarizeParsedRecord(record)).toBe('Acme AI · finance@acme.ai · cus_123')
  })

  it('summarizes subscription records with subscription, customer, status, and plan', () => {
    const record: ParsedRecord = {
      id: 'parsed_003',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: 'parse_003',
      uploadId: 'upl_003',
      sourceFileId: 'file_003',
      recordType: 'subscription',
      sourceRowNumber: 2,
      data: {
        subscriptionId: 'sub_001',
        externalCustomerId: 'cus_123',
        status: 'canceled',
        product: 'API Platform',
        plan: 'enterprise',
      },
    }

    expect(summarizeParsedRecord(record)).toBe('sub_001 · cus_123 · canceled · API Platform / enterprise')
  })

  it('summarizes account mapping records with usage and billing identifiers', () => {
    const record: ParsedRecord = {
      id: 'parsed_mapping',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: 'parse_mapping',
      uploadId: 'upl_mapping',
      sourceFileId: 'file_mapping',
      recordType: 'mapping',
      sourceRowNumber: 2,
      data: {
        displayName: 'Northstar AI',
        usageAccountId: 'acct_northstar',
        stripeCustomerId: 'cus_northstar',
      },
    }

    expect(summarizeParsedRecord(record)).toBe('Northstar AI · acct_northstar -> cus_northstar')
  })

  it('summarizes contract term records with type, customer, and value', () => {
    const record: ParsedRecord = {
      id: 'parsed_contract_term',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: 'parse_contract_terms',
      uploadId: 'upl_contract_terms',
      sourceFileId: 'file_contract_terms',
      recordType: 'contract_term',
      data: {
        customerId: 'acct_northstar',
        type: 'allowance',
        meter: 'api_calls',
        unit: 'calls',
        allowance: 100000,
      },
    }

    expect(summarizeParsedRecord(record)).toBe('allowance · acct_northstar · 100,000 calls')
  })
})
