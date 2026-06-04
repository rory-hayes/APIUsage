import { describe, expect, it } from 'vitest'

import { applyFindingWorkflowStatus, findingWorkflowStatusOptions } from './finding-workflow'
import { findingSchema, type Finding } from './schemas'

describe('finding workflow', () => {
  it('supports the customer issue workflow statuses from open through closure', () => {
    expect(findingWorkflowStatusOptions.map((option) => option.value)).toEqual([
      'open',
      'investigating',
      'accepted',
      'fixed',
      'ignored',
      'closed',
    ])
  })

  it('records audited status history when a finding changes workflow state', () => {
    const updated = applyFindingWorkflowStatus(
      finding({ status: 'open' }),
      {
        status: 'investigating',
        actorId: 'user_customer',
        note: 'Engineering is checking the usage feed.',
      },
      new Date('2026-06-05T14:00:00.000Z'),
    )

    expect(updated).toMatchObject({
      status: 'investigating',
      reviewerId: 'user_customer',
      metadata: {
        issueStatusChangedAt: '2026-06-05T14:00:00.000Z',
        issueStatusChangedBy: 'user_customer',
        issueStatusHistory: [
          {
            fromStatus: 'open',
            toStatus: 'investigating',
            note: 'Engineering is checking the usage feed.',
            actorId: 'user_customer',
            changedAt: '2026-06-05T14:00:00.000Z',
          },
        ],
      },
    })
  })
})

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_northstar_usage_gap',
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    customerId: 'contract_northstar',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Northstar usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'open',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_northstar' }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: { customerName: 'Northstar AI' },
    ...overrides,
  })
}
