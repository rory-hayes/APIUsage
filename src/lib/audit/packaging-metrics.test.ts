import { describe, expect, it } from 'vitest'

import { createAuditWorkspace } from './workspaces'
import { createUploadRecord } from './uploads'
import { parsedRecordSchema, type ParsedRecord } from './parse-jobs'
import { contractTermSchema } from './schemas'
import { createStripeConnection } from './stripe-connector'
import { createWarehouseCsvConnection } from './warehouse-connector'
import { buildWorkspacePackagingMetrics } from './packaging-metrics'

describe('packaging metrics', () => {
  it('counts invoices, usage rows, contracts, and connected systems for a workspace', () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_july_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'July 2026 audit',
        auditPeriod: 'July 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    const otherWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_july_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'July 2026 audit',
        auditPeriod: 'July 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    const northstarStripe = createStripeConnection(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        accountLabel: 'Northstar Stripe live',
        secretKey: 'sk_live_northstar',
        connectedBy: 'internal_admin',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )
    const northstarWarehouse = createWarehouseCsvConnection(
      {
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        sourceLabel: 'Northstar usage warehouse',
        exportUrl: 'https://warehouse.example.com/northstar.csv',
        schedule: 'daily',
        connectedBy: 'internal_admin',
        usageCsvMapping: {
          accountId: 'account_id',
          meter: 'meter_name',
          quantity: 'total',
          unit: 'unit',
          periodStart: 'start',
          periodEnd: 'end',
        },
      },
      new Date('2026-06-03T10:05:00.000Z'),
    )

    const metrics = buildWorkspacePackagingMetrics({
      workspace,
      parsedRecords: [
        invoiceRecord(workspace.id, 'parsed_invoice_1', 'in_001'),
        invoiceRecord(workspace.id, 'parsed_invoice_1_line_2', 'in_001'),
        invoiceRecord(workspace.id, 'parsed_invoice_2', 'in_002'),
        usageRecord(workspace.id, 'parsed_usage_1'),
        usageRecord(workspace.id, 'parsed_usage_2'),
        usageRecord(workspace.id, 'parsed_usage_3'),
        invoiceRecord(otherWorkspace.id, 'parsed_other_invoice', 'in_other'),
        usageRecord(otherWorkspace.id, 'parsed_other_usage'),
      ],
      uploads: [
        uploadRecord(workspace.id, 'northstar-order-form.pdf', '2026-06-03T10:00:00.000Z'),
        uploadRecord(workspace.id, 'northstar-amendment.pdf', '2026-06-03T10:10:00.000Z'),
        uploadRecord(otherWorkspace.id, 'acme-order-form.pdf', '2026-06-03T10:15:00.000Z'),
      ],
      contractTerms: [
        contractTerm(workspace.id, 'term_contract_1', 'src_orphan_contract'),
        contractTerm(workspace.id, 'term_contract_2', 'src_orphan_contract'),
        contractTerm(otherWorkspace.id, 'term_other_contract', 'src_other_contract'),
      ],
      stripeConnections: [northstarStripe, createAttentionStripeConnection(otherWorkspace.id)],
      warehouseConnections: [northstarWarehouse],
    })

    expect(metrics).toEqual({
      workspaceId: 'workspace_northstar_july_2026',
      invoiceCount: 2,
      usageRowCount: 3,
      contractCount: 3,
      connectedSystemCount: 2,
      connectedSystems: ['Stripe', 'Warehouse CSV'],
    })
  })

  it('returns zero counts before packaging inputs are present', () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_july_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'July 2026 audit',
        auditPeriod: 'July 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    expect(
      buildWorkspacePackagingMetrics({
        workspace,
        parsedRecords: [],
        uploads: [],
        contractTerms: [],
        stripeConnections: [],
        warehouseConnections: [],
      }),
    ).toEqual({
      workspaceId: 'workspace_northstar_july_2026',
      invoiceCount: 0,
      usageRowCount: 0,
      contractCount: 0,
      connectedSystemCount: 0,
      connectedSystems: [],
    })
  })
})

function invoiceRecord(workspaceId: string, id: string, invoiceId: string): ParsedRecord {
  return parsedRecordSchema.parse({
    id,
    organizationId: workspaceId.includes('acme') ? 'org_acme' : 'org_northstar',
    workspaceId,
    jobId: `parse_${workspaceId}`,
    uploadId: `upload_${workspaceId}`,
    sourceFileId: `src_invoice_${workspaceId}`,
    recordType: 'invoice_line',
    data: {
      id: `${invoiceId}:line`,
      invoiceId,
    },
  })
}

function usageRecord(workspaceId: string, id: string): ParsedRecord {
  return parsedRecordSchema.parse({
    id,
    organizationId: workspaceId.includes('acme') ? 'org_acme' : 'org_northstar',
    workspaceId,
    jobId: `parse_${workspaceId}`,
    uploadId: `upload_${workspaceId}`,
    sourceFileId: `src_usage_${workspaceId}`,
    recordType: 'usage',
    data: {
      id,
      meter: 'api_calls',
    },
  })
}

function uploadRecord(workspaceId: string, filename: string, uploadedAt: string) {
  return createUploadRecord(
    {
      organizationId: workspaceId.includes('acme') ? 'org_acme' : 'org_northstar',
      workspaceId,
      category: 'contracts_order_forms',
      filename,
      byteSize: 256,
      contentType: 'application/pdf',
      storageKey: `workspaces/${workspaceId}/${filename}`,
      uploadedBy: 'user_customer',
    },
    new Date(uploadedAt),
  )
}

function contractTerm(workspaceId: string, id: string, sourceFileId: string) {
  return contractTermSchema.parse({
    id,
    organizationId: workspaceId.includes('acme') ? 'org_acme' : 'org_northstar',
    workspaceId,
    type: 'minimum',
    minimumAmount: 500000,
    currency: 'eur',
    evidence: {
      sourceFileId,
      page: 1,
      snippet: 'Minimum monthly commit: EUR 5,000.',
    },
  })
}

function createAttentionStripeConnection(workspaceId: string) {
  const connection = createStripeConnection(
    {
      organizationId: 'org_acme',
      workspaceId,
      accountLabel: 'Acme Stripe needs attention',
      secretKey: 'sk_live_acme',
      connectedBy: 'internal_admin',
    },
    new Date('2026-06-03T10:00:00.000Z'),
  )

  return {
    ...connection,
    status: 'needs_attention' as const,
  }
}
