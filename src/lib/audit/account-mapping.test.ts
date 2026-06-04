import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  JsonAccountMappingStore,
  approveAccountMapping,
  buildAccountMappingSuggestions,
  createManualAccountMapping,
  getUnmappedAccountReport,
} from './account-mapping'
import { type ParsedRecord } from './parse-jobs'

describe('account mapping workflow', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-account-mapping-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('suggests account mappings between usage and Stripe invoice records using IDs, names, and email domains', () => {
    const suggestions = buildAccountMappingSuggestions([
      usageRecord({
        id: 'usage_acme',
        accountId: 'acct_acme_usage',
        customerName: 'Acme AI',
        metadata: { domain: 'acme.ai' },
      }),
      invoiceRecord({
        id: 'invoice_acme',
        externalCustomerId: 'cus_acme_stripe',
        customerEmail: 'billing@acme.ai',
      }),
    ])

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: 'map_workspace_001_acct_acme_usage_cus_acme_stripe',
        workspaceId: 'workspace_001',
        organizationId: 'org_001',
        displayName: 'Acme AI',
        status: 'suggested',
        source: 'system',
        confidence: 0.9,
        usageAccountId: 'acct_acme_usage',
        usageCustomerName: 'Acme AI',
        stripeCustomerId: 'cus_acme_stripe',
        stripeCustomerEmail: 'billing@acme.ai',
        evidence: expect.arrayContaining([
          { type: 'usage_record', sourceId: 'usage_acme' },
          { type: 'invoice_line', sourceId: 'invoice_acme' },
        ]),
        matchReasons: expect.arrayContaining(['domain_match']),
      }),
    ])
  })

  it('suggests account mappings from Stripe customer records when invoice lines are not available', () => {
    const suggestions = buildAccountMappingSuggestions([
      usageRecord({
        id: 'usage_northstar',
        accountId: 'acct_northstar_usage',
        customerName: 'Northstar AI',
        metadata: { domain: 'northstar.ai' },
      }),
      customerRecord({
        id: 'customer_northstar',
        stripeCustomerId: 'cus_northstar_stripe',
        primaryEmail: 'finance@northstar.ai',
      }),
    ])

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: 'map_workspace_001_acct_northstar_usage_cus_northstar_stripe',
        workspaceId: 'workspace_001',
        organizationId: 'org_001',
        displayName: 'Northstar AI',
        status: 'suggested',
        source: 'system',
        confidence: 0.9,
        usageAccountId: 'acct_northstar_usage',
        usageCustomerName: 'Northstar AI',
        stripeCustomerId: 'cus_northstar_stripe',
        stripeCustomerEmail: 'finance@northstar.ai',
        evidence: expect.arrayContaining([
          { type: 'usage_record', sourceId: 'usage_northstar' },
          { type: 'customer_record', sourceId: 'customer_northstar' },
        ]),
        matchReasons: expect.arrayContaining(['domain_match']),
      }),
    ])
  })

  it('approves suggested mappings and creates manual overrides with reviewer metadata', () => {
    const [suggested] = buildAccountMappingSuggestions([
      usageRecord({ accountId: 'acct_acme_usage', customerName: 'Acme AI', metadata: { domain: 'acme.ai' } }),
      invoiceRecord({ externalCustomerId: 'cus_acme_stripe', customerEmail: 'billing@acme.ai' }),
    ])

    const approved = approveAccountMapping(
      suggested,
      {
        reviewerId: 'internal_admin',
        note: 'Confirmed in Stripe customer export.',
      },
      new Date('2026-06-02T10:00:00.000Z'),
    )
    const manual = createManualAccountMapping(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        displayName: 'Beta Labs',
        usageAccountId: 'acct_beta_usage',
        stripeCustomerId: 'cus_beta_stripe',
        stripeCustomerEmail: 'ap@betalabs.com',
        reviewerId: 'internal_admin',
        note: 'Manual mapping from customer-supplied CSV.',
      },
      new Date('2026-06-02T10:30:00.000Z'),
    )

    expect(approved).toMatchObject({
      status: 'approved',
      source: 'system',
      reviewerId: 'internal_admin',
      reviewedAt: '2026-06-02T10:00:00.000Z',
      note: 'Confirmed in Stripe customer export.',
    })
    expect(manual).toMatchObject({
      id: 'map_workspace_001_acct_beta_usage_cus_beta_stripe',
      status: 'manual_override',
      source: 'manual',
      reviewerId: 'internal_admin',
      reviewedAt: '2026-06-02T10:30:00.000Z',
    })
  })

  it('uses contract and cost identifiers in manual mapping IDs when Stripe identifiers are absent', () => {
    const contractOnly = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Northstar AI',
      usageAccountId: 'acct_northstar_usage',
      contractCustomerId: 'contract_northstar',
      reviewerId: 'internal_admin',
    })
    const costOnly = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Northstar AI',
      usageAccountId: 'acct_northstar_usage',
      costAccountId: 'cost_northstar',
      reviewerId: 'internal_admin',
    })

    expect(contractOnly.id).toBe('map_workspace_001_acct_northstar_usage_contract_northstar')
    expect(costOnly.id).toBe('map_workspace_001_acct_northstar_usage_cost_northstar')
  })

  it('persists mappings and reports unmapped usage, Stripe, contract, and cost identifiers', async () => {
    const store = new JsonAccountMappingStore(join(tempDir, 'account-mappings.json'))
    const mapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      usageAccountId: 'acct_acme_usage',
      stripeCustomerId: 'cus_acme_stripe',
      contractCustomerId: 'cus_acme_contract',
      costAccountId: 'cost_acme',
      reviewerId: 'internal_admin',
    })

    await store.saveMany([mapping])

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([mapping])
    await expect(store.listByWorkspace('workspace_002')).resolves.toEqual([])

    const report = getUnmappedAccountReport(
      [
        usageRecord({ accountId: 'acct_acme_usage', customerName: 'Acme AI' }),
        usageRecord({ accountId: 'acct_unmapped_usage', customerName: 'Unmapped Usage Co' }),
        invoiceRecord({ externalCustomerId: 'cus_acme_stripe', customerEmail: 'billing@acme.ai' }),
        invoiceRecord({ externalCustomerId: 'cus_unmapped_stripe', customerEmail: 'ap@unmapped.com' }),
        customerRecord({ stripeCustomerId: 'cus_unmapped_customer_export', primaryEmail: 'finance@customer-export.ai' }),
        contractTermRecord({ customerId: 'cus_unmapped_contract' }),
        costRecord({ accountId: 'cost_unmapped' }),
      ],
      [mapping],
    )

    expect(report).toEqual({
      usageAccountIds: ['acct_unmapped_usage'],
      stripeCustomerIds: ['cus_unmapped_customer_export', 'cus_unmapped_stripe'],
      contractCustomerIds: ['cus_unmapped_contract'],
      costAccountIds: ['cost_unmapped'],
    })
  })
})

function usageRecord(
  overrides: {
    id?: string
    accountId?: string
    customerName?: string
    metadata?: Record<string, unknown>
  } = {},
): ParsedRecord {
  return parsedRecord('usage', {
    id: overrides.id ?? 'usage_001',
    data: {
      id: overrides.id ?? 'usage_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      accountId: overrides.accountId,
      customerName: overrides.customerName,
      meter: 'api_calls',
      quantity: 1000,
      unit: 'calls',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_usage', rowNumber: 2 }],
      metadata: overrides.metadata ?? {},
    },
  })
}

function invoiceRecord(
  overrides: {
    id?: string
    externalCustomerId?: string
    customerEmail?: string
  } = {},
): ParsedRecord {
  return parsedRecord('invoice_line', {
    id: overrides.id ?? 'invoice_001',
    data: {
      id: overrides.id ?? 'invoice_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      invoiceId: 'in_001',
      externalCustomerId: overrides.externalCustomerId,
      customerEmail: overrides.customerEmail,
      description: 'May API overage',
      amount: 10000,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_invoice', rowNumber: 2 }],
      metadata: {},
    },
  })
}

function customerRecord(
  overrides: {
    id?: string
    stripeCustomerId?: string
    primaryEmail?: string
  } = {},
): ParsedRecord {
  const id = overrides.id ?? 'customer_001'

  return parsedRecord('customer', {
    id,
    data: {
      id,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Northstar AI',
      primaryEmail: overrides.primaryEmail,
      externalIds: {
        stripeCustomerId: overrides.stripeCustomerId,
      },
      sourceRefs: [{ sourceFileId: 'src_customer', rowNumber: 2 }],
      metadata: {},
    },
  })
}

function contractTermRecord(overrides: { customerId: string }): ParsedRecord {
  return parsedRecord('contract_term', {
    id: `contract_${overrides.customerId}`,
    data: {
      id: `term_${overrides.customerId}`,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      customerId: overrides.customerId,
      type: 'overage_rate',
      rate: 2.5,
      currency: 'eur',
      status: 'approved',
    },
  })
}

function costRecord(overrides: { accountId: string }): ParsedRecord {
  return parsedRecord('cost', {
    id: `cost_${overrides.accountId}`,
    data: {
      id: `cost_${overrides.accountId}`,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      accountId: overrides.accountId,
      amount: 5000,
      currency: 'eur',
    },
  })
}

function parsedRecord(recordType: string, input: { id: string; data: Record<string, unknown> }): ParsedRecord {
  return {
    id: input.id,
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'job_001',
    uploadId: 'upl_001',
    sourceFileId: 'src_001',
    recordType: recordType as ParsedRecord['recordType'],
    data: input.data,
  }
}
