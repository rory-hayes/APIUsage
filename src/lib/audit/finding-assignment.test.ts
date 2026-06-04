import { describe, expect, it } from 'vitest'

import { assignFinding, findingAssignmentOwnerLabel } from './finding-assignment'
import { findingSchema, type Finding } from './schemas'

describe('finding assignment', () => {
  it('assigns a customer-visible finding to an owner team with audit metadata', () => {
    const finding = baseFinding({ status: 'open' })

    const assigned = assignFinding(
      finding,
      {
        owner: 'engineering',
        assignedBy: 'user_northstar_finance',
        note: 'Engineering should confirm the usage event feed.',
      },
      new Date('2026-06-05T10:30:00.000Z'),
    )

    expect(assigned.assignment).toEqual({
      owner: 'engineering',
      assignedBy: 'user_northstar_finance',
      assignedAt: '2026-06-05T10:30:00.000Z',
      note: 'Engineering should confirm the usage event feed.',
    })
    expect(assigned.status).toBe('open')
    expect(findingAssignmentOwnerLabel(assigned.assignment?.owner)).toBe('Engineering')
  })
})

function baseFinding(overrides: Partial<Finding>): Finding {
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
