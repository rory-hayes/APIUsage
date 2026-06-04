import { describe, expect, it } from 'vitest'

import { createRuleRunRecord, RECONCILIATION_RULE_VERSION, type RuleRun } from './rule-runs'
import { findingSchema, type Finding } from './schemas'
import { createUploadRecord, type UploadRecord } from './uploads'
import { createAuditWorkspace, type AuditWorkspace } from './workspaces'
import { buildWorkspaceUsageMetrics } from './usage-metrics'

describe('usage metrics', () => {
  it('tracks time to upload, time to first finding, accepted findings, and money at risk for a workspace', () => {
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
    const acmeWorkspace = createAuditWorkspace(
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

    const metrics = buildWorkspaceUsageMetrics({
      workspace,
      uploads: [
        uploadRecord(workspace, 'usage_csv', 'northstar-usage.csv', '2026-06-03T10:15:00.000Z'),
        uploadRecord(workspace, 'contracts_order_forms', 'northstar-order-form.pdf', '2026-06-03T10:00:00.000Z'),
        uploadRecord(acmeWorkspace, 'usage_csv', 'acme-usage.csv', '2026-06-03T09:10:00.000Z'),
      ],
      ruleRuns: [
        ruleRun(workspace, '2026-06-03T11:45:00.000Z', 0, []),
        ruleRun(workspace, '2026-06-03T12:30:00.000Z', 2, ['finding_accepted', 'finding_open']),
        ruleRun(acmeWorkspace, '2026-06-03T09:30:00.000Z', 1, ['finding_acme']),
      ],
      findings: [
        finding(workspace, {
          id: 'finding_accepted',
          status: 'accepted',
          severity: 'high',
          expectedAmount: 900000,
          actualAmount: 100000,
        }),
        finding(workspace, {
          id: 'finding_open',
          status: 'open',
          severity: 'medium',
          expectedAmount: 150000,
          actualAmount: 0,
        }),
        finding(workspace, {
          id: 'finding_rejected',
          status: 'rejected',
          expectedAmount: 500000,
          actualAmount: 0,
        }),
        finding(workspace, {
          id: 'finding_fixed',
          status: 'fixed',
          expectedAmount: 250000,
          actualAmount: 0,
        }),
        finding(workspace, {
          id: 'finding_overbilling',
          status: 'open',
          expectedAmount: 100000,
          actualAmount: 300000,
        }),
        finding(acmeWorkspace, {
          id: 'finding_acme',
          status: 'accepted',
          expectedAmount: 999999,
          actualAmount: 0,
        }),
      ],
    })

    expect(metrics).toEqual({
      workspaceId: 'workspace_northstar_july_2026',
      timeToFirstUploadMinutes: 60,
      timeToFirstFindingMinutes: 210,
      acceptedFindingCount: 1,
      moneyAtRiskAmount: 950000,
      currency: 'eur',
    })
  })

  it('returns null timing metrics and zero commercial metrics before activity starts', () => {
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

    expect(buildWorkspaceUsageMetrics({ workspace, uploads: [], ruleRuns: [], findings: [] })).toEqual({
      workspaceId: 'workspace_northstar_july_2026',
      timeToFirstUploadMinutes: null,
      timeToFirstFindingMinutes: null,
      acceptedFindingCount: 0,
      moneyAtRiskAmount: 0,
      currency: 'eur',
    })
  })
})

function uploadRecord(
  workspace: AuditWorkspace,
  category: Parameters<typeof createUploadRecord>[0]['category'],
  filename: string,
  uploadedAt: string,
): UploadRecord {
  return createUploadRecord(
    {
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      category,
      filename,
      byteSize: 256,
      contentType: filename.endsWith('.csv') ? 'text/csv' : 'application/pdf',
      storageKey: `workspaces/${workspace.id}/${filename}`,
      uploadedBy: 'user_customer',
    },
    new Date(uploadedAt),
  )
}

function ruleRun(workspace: AuditWorkspace, completedAt: string, findingCount: number, findingIds: string[]): RuleRun {
  return createRuleRunRecord({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    actorId: 'internal_admin',
    status: findingCount > 0 ? 'reviewing' : 'complete',
    ruleVersion: RECONCILIATION_RULE_VERSION,
    inputs: {
      ruleTemplateIds: ['usage_without_invoice'],
      parsedRecordCount: 10,
      contractTermCount: 1,
      accountMappingCount: 1,
    },
    output: {
      findingCount,
      findingIds,
      findingCategories: findingCount > 0 ? ['usage_exists_no_invoice'] : [],
      suppressedFindingCount: 0,
    },
    errors: [],
    startedAt: new Date(new Date(completedAt).getTime() - 5 * 60_000),
    completedAt: new Date(completedAt),
  })
}

function finding(workspace: AuditWorkspace, overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_001',
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    currency: workspace.currency,
    confidence: 0.91,
    status: 'draft',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before close.',
    ...overrides,
  })
}
