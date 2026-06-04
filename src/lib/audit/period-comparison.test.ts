import { describe, expect, it } from 'vitest'

import { findingSchema, type Finding } from './schemas'
import { createAuditWorkspace, createAuditWorkspacePeriod } from './workspaces'
import { buildPeriodFindingComparison } from './period-comparison'

describe('period finding comparison', () => {
  it('compares customer-visible current-period findings to the previous period', () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_monitoring',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'Revenue monitoring',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
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
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )

    const comparison = buildPeriodFindingComparison({
      workspace,
      findings: [
        finding({
          id: 'finding_june_visible',
          category: 'wrong_overage_rate',
          status: 'approved_internal',
          expectedAmount: 700000,
          actualAmount: 200000,
          varianceAmount: 500000,
          metadata: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        }),
        finding({
          id: 'finding_june_draft',
          status: 'draft',
          expectedAmount: 100000,
          actualAmount: 0,
          varianceAmount: 100000,
          metadata: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        }),
        finding({
          id: 'finding_may_visible',
          category: 'usage_exists_no_invoice',
          status: 'published',
          expectedAmount: 300000,
          actualAmount: 100000,
          varianceAmount: 200000,
          metadata: { periodStart: '2026-05-01', periodEnd: '2026-05-31' },
        }),
      ],
    })

    expect(comparison).toEqual({
      currentPeriod: {
        id: 'period_june_2026',
        label: 'June 2026',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        status: 'active',
      },
      previousPeriod: {
        id: 'period_may_2026',
        label: 'May 2026',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        status: 'closed',
      },
      current: {
        findingCount: 1,
        totalVarianceAmount: 500000,
        highSeverityCount: 1,
      },
      previous: {
        findingCount: 1,
        totalVarianceAmount: 200000,
        highSeverityCount: 1,
      },
      delta: {
        findingCount: 0,
        totalVarianceAmount: 300000,
        highSeverityCount: 0,
      },
      categoryRows: [
        {
          category: 'usage_exists_no_invoice',
          label: 'Usage exists no invoice',
          currentCount: 0,
          previousCount: 1,
          delta: -1,
        },
        {
          category: 'wrong_overage_rate',
          label: 'Wrong overage rate',
          currentCount: 1,
          previousCount: 0,
          delta: 1,
        },
      ],
    })
  })
})

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_001',
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_monitoring',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Northstar usage leak',
    expectedAmount: 500000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'approved_internal',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_northstar' }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: {},
    ...overrides,
  })
}
