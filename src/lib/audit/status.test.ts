import { describe, expect, it } from 'vitest'

import { createManualAccountMapping } from './account-mapping'
import { createIntakeResponse } from './intake'
import { type ParsedRecord, type ParseJob } from './parse-jobs'
import { buildCustomerAuditStatusRows, buildWorkspaceStatusView } from './status'
import { DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS, createUploadRecord, reviewUploadRecord } from './uploads'
import { findingSchema, type Finding } from './schemas'
import { createAuditWorkspacePeriod, type AuditWorkspace } from './workspaces'

describe('workspace status view', () => {
  it('builds status rows from only the selected workspace data', () => {
    const workspace: AuditWorkspace = {
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      currency: 'eur',
      requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
      monitoringPeriods: [
        {
          id: 'period_june_2026',
          label: 'June 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          status: 'active',
        },
      ],
      status: 'review',
      createdBy: 'internal_admin',
      createdAt: '2026-06-02T09:00:00.000Z',
    }
    const intakeResponse = createIntakeResponse({
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      answers: {
        billing_model: 'Enterprise subscription plus API overages',
        billing_systems: 'Stripe',
        usage_units: 'API calls',
        credits_overages: 'Included allowance then overage',
        custom_contracts: 'Some enterprise amendments',
        close_process: 'Finance reviews previews monthly',
        cost_tracking: 'Provider cost CSV',
      },
      updatedBy: 'billing_northstar',
    })
    const view = buildWorkspaceStatusView({
      workspace,
      intakeResponse,
      parseJobs: [
        parseJob({
          id: 'parse_acme_usage',
          organizationId: 'org_acme',
          workspaceId: 'workspace_acme_may_2026',
          filename: 'acme-usage.csv',
          errors: [{ rowNumber: 2, message: 'Acme-only parse error' }],
        }),
        parseJob({
          id: 'parse_northstar_usage',
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_june_2026',
          filename: 'northstar-usage.csv',
          status: 'completed_with_errors',
          recordCount: 12,
          errorCount: 1,
          errors: [{ rowNumber: 4, message: 'Missing meter name' }],
        }),
      ],
      parsedRecords: [
        usageRecord({
          id: 'parsed_acme_usage',
          organizationId: 'org_acme',
          workspaceId: 'workspace_acme_may_2026',
          jobId: 'parse_acme_usage',
          data: { customerName: 'Acme AI', meter: 'tokens', quantity: 1, unit: 'tokens' },
        }),
        usageRecord({
          id: 'parsed_northstar_usage',
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_june_2026',
          jobId: 'parse_northstar_usage',
          sourceRowNumber: 3,
          data: { customerName: 'Northstar AI', meter: 'api_calls', quantity: 2500, unit: 'calls' },
        }),
      ],
    })

    expect(view.workspace).toEqual({
      id: 'workspace_northstar_june_2026',
      name: 'Northstar AI',
      auditPeriod: 'June 2026',
      status: 'review',
      statusLabel: 'review',
      readinessPercent: 90,
    })
    expect(view.intakeCompleteness.status).toBe('complete')
    expect(view.parseRows).toEqual([
      {
        id: 'parse_northstar_usage',
        filename: 'northstar-usage.csv',
        parser: 'usage csv',
        status: 'completed_with_errors',
        recordCount: 12,
        errorCount: 1,
        ranAt: '2026-06-02T11:00:00.000Z',
      },
    ])
    expect(view.normalizedRecordRows).toEqual([
      {
        id: 'parsed_northstar_usage',
        file: 'northstar-usage.csv',
        recordType: 'usage',
        sourceRowNumber: 3,
        summary: 'Northstar AI · api_calls · 2,500 calls',
      },
    ])
    expect(view.parseErrors).toEqual([
      {
        id: 'parse_northstar_usage-4-Missing meter name',
        filename: 'northstar-usage.csv',
        rowNumber: 4,
        message: 'Missing meter name',
      },
    ])
    expect(JSON.stringify(view)).not.toContain('Acme')
  })

  it('summarizes upload readiness and readout progress for the selected workspace', () => {
    const workspace: AuditWorkspace = {
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      currency: 'eur',
      requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
      monitoringPeriods: [
        {
          id: 'period_june_2026',
          label: 'June 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          status: 'active',
        },
      ],
      status: 'review',
      createdBy: 'internal_admin',
      createdAt: '2026-06-02T09:00:00.000Z',
    }
    const acceptedContract = reviewUploadRecord(
      uploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'contracts_order_forms',
        filename: 'northstar-order-form.pdf',
      }),
      {
        status: 'accepted',
        reviewedBy: 'internal_admin',
      },
    )
    const pendingInvoice = uploadRecord({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      category: 'stripe_invoices_export',
      filename: 'northstar-invoices.csv',
    })
    const acmeUpload = uploadRecord({
      organizationId: 'org_acme',
      workspaceId: 'workspace_acme_may_2026',
      category: 'usage_csv',
      filename: 'acme-usage.csv',
    })

    const view = buildWorkspaceStatusView({
      workspace,
      intakeResponse: null,
      parseJobs: [],
      parsedRecords: [],
      uploads: [acceptedContract, pendingInvoice, acmeUpload],
      findings: [
        finding({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          status: 'approved_internal',
          title: 'Published Northstar issue',
        }),
        finding({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          status: 'draft',
          title: 'Draft Northstar issue',
        }),
        finding({
          organizationId: 'org_acme',
          workspaceId: 'workspace_acme_may_2026',
          status: 'approved_internal',
          title: 'Acme issue',
        }),
      ],
    })

    expect(view.uploadSummary).toEqual({
      acceptedRequired: 1,
      missingRequired: 5,
      needsReviewRequired: 1,
      requiredTotal: 7,
    })
    expect(view.uploadRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'contracts_order_forms',
          label: 'Contracts/order forms',
          required: true,
          status: 'accepted',
          files: 1,
          latestFilename: 'northstar-order-form.pdf',
        }),
        expect.objectContaining({
          category: 'stripe_invoices_export',
          status: 'needs_review',
          files: 1,
          latestFilename: 'northstar-invoices.csv',
        }),
        expect.objectContaining({
          category: 'usage_csv',
          status: 'missing',
          files: 0,
        }),
      ]),
    )
    expect(view.findingSummary).toEqual({
      customerVisibleCount: 1,
      draftReviewCount: 1,
      evidencePackReady: true,
      rejectedCount: 0,
    })
    expect(JSON.stringify(view)).not.toContain('Acme')
  })

  it('resets recurring upload readiness for the active monitoring period', () => {
    const workspace: AuditWorkspace = {
      id: 'workspace_northstar_monitoring',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'Revenue monitoring',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      currency: 'eur',
      requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
      monitoringPeriods: [
        createAuditWorkspacePeriod({
          label: 'May 2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          status: 'closed',
        }),
        createAuditWorkspacePeriod({
          label: 'June 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          status: 'active',
        }),
      ],
      status: 'review',
      createdBy: 'internal_admin',
      createdAt: '2026-06-02T09:00:00.000Z',
    }
    const acceptedMayContract = reviewUploadRecord(
      uploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'contracts_order_forms',
        filename: 'northstar-order-form-may.pdf',
        metadata: {
          monitoringPeriodId: 'period_may_2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          periodLabel: 'May 2026',
        },
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )
    const acceptedMayUsage = reviewUploadRecord(
      uploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'usage_csv',
        filename: 'northstar-usage-may.csv',
        metadata: {
          monitoringPeriodId: 'period_may_2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          periodLabel: 'May 2026',
        },
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )

    const view = buildWorkspaceStatusView({
      workspace,
      intakeResponse: null,
      parseJobs: [],
      parsedRecords: [],
      uploads: [acceptedMayContract, acceptedMayUsage],
    })

    expect(view.uploadSummary).toEqual({
      acceptedRequired: 1,
      missingRequired: 6,
      needsReviewRequired: 0,
      requiredTotal: 7,
    })
    expect(view.uploadRows.find((row) => row.category === 'contracts_order_forms')).toMatchObject({
      status: 'accepted',
      files: 1,
      latestFilename: 'northstar-order-form-may.pdf',
      periodScope: 'rolled_forward',
    })
    expect(view.uploadRows.find((row) => row.category === 'usage_csv')).toMatchObject({
      status: 'missing',
      files: 0,
      latestFilename: undefined,
      periodScope: 'current_period',
    })
  })

  it('calculates a V1 data quality score from completeness, parse success, mapping coverage, and confidence', () => {
    const workspace: AuditWorkspace = {
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      currency: 'eur',
      requiredUploadCategories: ['contracts_order_forms', 'usage_csv', 'stripe_invoices_export', 'account_mapping_csv'],
      monitoringPeriods: [
        {
          id: 'period_june_2026',
          label: 'June 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          status: 'active',
        },
      ],
      status: 'review',
      createdBy: 'internal_admin',
      createdAt: '2026-06-02T09:00:00.000Z',
    }
    const acceptedContract = reviewUploadRecord(
      uploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'contracts_order_forms',
        filename: 'northstar-order-form.pdf',
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )
    const acceptedUsage = reviewUploadRecord(
      uploadRecord({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        category: 'usage_csv',
        filename: 'northstar-usage.csv',
      }),
      { status: 'accepted', reviewedBy: 'internal_admin' },
    )
    const pendingInvoices = uploadRecord({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      category: 'stripe_invoices_export',
      filename: 'northstar-invoices.csv',
    })
    const usage = usageRecord({
      id: 'parsed_usage_northstar',
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      jobId: 'parse_usage',
      data: { accountId: 'acct_northstar', customerName: 'Northstar AI', meter: 'api_calls', quantity: 1000, unit: 'calls' },
    })
    const invoice = usageRecord({
      id: 'parsed_invoice_northstar',
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      jobId: 'parse_invoice',
      recordType: 'invoice_line',
      data: {
        id: 'line_northstar',
        externalCustomerId: 'cus_northstar',
        description: 'API usage',
        amount: 50000,
        currency: 'eur',
      },
    })
    const cost = usageRecord({
      id: 'parsed_cost_northstar',
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      jobId: 'parse_cost',
      recordType: 'cost',
      data: {
        id: 'cost_northstar',
        accountId: 'cost_northstar',
        provider: 'OpenAI',
        costAmount: 25000,
        currency: 'eur',
      },
    })
    const mapping = createManualAccountMapping({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      displayName: 'Northstar AI',
      usageAccountId: 'acct_northstar',
      stripeCustomerId: 'cus_northstar',
      reviewerId: 'internal_admin',
    })

    const view = buildWorkspaceStatusView({
      workspace,
      intakeResponse: null,
      parseJobs: [
        parseJob({
          id: 'parse_usage',
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          status: 'complete',
          recordCount: 1,
          errorCount: 0,
        }),
        parseJob({
          id: 'parse_invoice',
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          status: 'completed_with_errors',
          recordCount: 10,
          errorCount: 2,
        }),
      ],
      parsedRecords: [usage, invoice, cost],
      uploads: [acceptedContract, acceptedUsage, pendingInvoices],
      findings: [
        finding({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          status: 'approved_internal',
          title: 'High confidence issue',
          confidence: 0.8,
        }),
        finding({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          status: 'draft',
          title: 'Lower confidence issue',
          confidence: 0.6,
        }),
      ],
      accountMappings: [mapping],
    })

    expect(view.dataQuality).toEqual({
      score: 66,
      level: 'needs_attention',
      completenessPercent: 50,
      parseSuccessPercent: 83,
      mappingCoveragePercent: 50,
      confidencePercent: 80,
    })
  })

  it('builds customer audit status rows from each customer latest workspace', () => {
    const northstarMay = auditWorkspace({
      id: 'workspace_northstar_may_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'May 2026 audit',
      auditPeriod: 'May 2026',
      status: 'complete',
      createdAt: '2026-06-01T09:00:00.000Z',
    })
    const northstarJune = auditWorkspace({
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      requiredUploadCategories: ['contracts_order_forms', 'usage_csv'],
      status: 'review',
      createdAt: '2026-06-03T09:00:00.000Z',
    })
    const acmeJune = auditWorkspace({
      id: 'workspace_acme_june_2026',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      requiredUploadCategories: ['contracts_order_forms', 'usage_csv'],
      status: 'uploads',
      createdAt: '2026-06-02T09:00:00.000Z',
    })

    const rows = buildCustomerAuditStatusRows({
      workspaces: [northstarMay, northstarJune, acmeJune],
      uploads: [
        reviewUploadRecord(
          uploadRecord({
            organizationId: northstarJune.organizationId,
            workspaceId: northstarJune.id,
            category: 'contracts_order_forms',
            filename: 'northstar-order-form.pdf',
          }),
          { status: 'accepted', reviewedBy: 'internal_admin' },
        ),
        uploadRecord({
          organizationId: northstarJune.organizationId,
          workspaceId: northstarJune.id,
          category: 'usage_csv',
          filename: 'northstar-usage.csv',
        }),
        reviewUploadRecord(
          uploadRecord({
            organizationId: acmeJune.organizationId,
            workspaceId: acmeJune.id,
            category: 'contracts_order_forms',
            filename: 'acme-order-form.pdf',
          }),
          { status: 'accepted', reviewedBy: 'internal_admin' },
        ),
      ],
      findings: [
        finding({
          organizationId: northstarJune.organizationId,
          workspaceId: northstarJune.id,
          status: 'approved_internal',
          severity: 'high',
          title: 'High value usage variance',
          expectedAmount: 900000,
          actualAmount: 100000,
        }),
        finding({
          organizationId: acmeJune.organizationId,
          workspaceId: acmeJune.id,
          status: 'needs_customer_input',
          severity: 'medium',
          title: 'Usage file needs customer explanation',
        }),
      ],
      intakeResponses: [],
      parseJobs: [],
      parsedRecords: [],
      accountMappings: [],
    })

    const northstar = rows.find((row) => row.organizationId === 'org_northstar')
    const acme = rows.find((row) => row.organizationId === 'org_acme')

    expect(rows.map((row) => row.organizationName)).toEqual(['Acme AI', 'Northstar AI'])
    expect(northstar).toMatchObject({
      organizationName: 'Northstar AI',
      workspaceCount: 2,
      health: 'needs_attention',
      healthLabel: 'Needs attention',
      statusReason: '1 required upload awaiting internal review',
      latestWorkspace: {
        id: 'workspace_northstar_june_2026',
        auditPeriod: 'June 2026',
        status: 'review',
        statusLabel: 'review',
      },
      uploadSummary: {
        acceptedRequired: 1,
        missingRequired: 0,
        needsReviewRequired: 1,
        requiredTotal: 2,
      },
      findingSummary: {
        customerInputCount: 0,
        customerVisibleCount: 1,
        highRiskOpenCount: 1,
        internalReviewCount: 0,
        openCount: 1,
      },
    })
    expect(acme).toMatchObject({
      organizationName: 'Acme AI',
      workspaceCount: 1,
      health: 'blocked',
      healthLabel: 'Blocked',
      statusReason: '1 required upload missing',
      latestWorkspace: {
        id: 'workspace_acme_june_2026',
        auditPeriod: 'June 2026',
        status: 'uploads',
        statusLabel: 'uploads',
      },
      uploadSummary: {
        acceptedRequired: 1,
        missingRequired: 1,
        needsReviewRequired: 0,
        requiredTotal: 2,
      },
      findingSummary: {
        customerInputCount: 1,
        customerVisibleCount: 0,
        highRiskOpenCount: 0,
        internalReviewCount: 0,
        openCount: 1,
      },
    })
  })
})

function auditWorkspace(overrides: Partial<AuditWorkspace> = {}): AuditWorkspace {
  return {
    id: 'workspace_001',
    organizationId: 'org_001',
    organizationName: 'Customer Co',
    name: 'June 2026 audit',
    auditPeriod: 'June 2026',
    billingSystem: 'Stripe',
    usageSource: 'Warehouse CSV',
    currency: 'eur',
    requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
    monitoringPeriods: [
      {
        id: 'period_june_2026',
        label: 'June 2026',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        status: 'active',
      },
    ],
    status: 'review',
    createdBy: 'internal_admin',
    createdAt: '2026-06-02T09:00:00.000Z',
    ...overrides,
  }
}

function parseJob(overrides: Partial<ParseJob> = {}): ParseJob {
  return {
    id: 'parse_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    uploadId: 'upl_001',
    sourceFileId: 'src_001',
    filename: 'usage.csv',
    category: 'usage_csv',
    parser: 'usage_csv',
    status: 'complete',
    recordCount: 1,
    errorCount: 0,
    errors: [],
    ranAt: '2026-06-02T11:00:00.000Z',
    ...overrides,
  }
}

function usageRecord(overrides: Partial<ParsedRecord> = {}): ParsedRecord {
  return {
    id: 'parsed_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_001',
    uploadId: 'upl_001',
    sourceFileId: 'src_001',
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      customerName: 'Customer',
      meter: 'tokens',
      quantity: 1,
      unit: 'tokens',
    },
    ...overrides,
  }
}

function uploadRecord(input: {
  organizationId: string
  workspaceId: string
  category: Parameters<typeof createUploadRecord>[0]['category']
  filename: string
  metadata?: Record<string, unknown>
}) {
  return createUploadRecord(
    {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      category: input.category,
      filename: input.filename,
      byteSize: 256,
      contentType: input.filename.endsWith('.csv') ? 'text/csv' : 'application/pdf',
      storageKey: `workspaces/${input.workspaceId}/${input.filename}`,
      uploadedBy: 'user_customer',
      metadata: input.metadata,
    },
    new Date('2026-06-02T10:00:00.000Z'),
  )
}

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: `finding_${overrides.workspaceId}_${overrides.status}_${overrides.title?.replaceAll(' ', '_')}`,
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'draft',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: {
      customerName: 'Northstar Customer',
    },
    ...overrides,
  })
}
