import { describe, expect, it } from 'vitest'

import { buildLatestRuleRunComparison } from './run-comparison'
import { createRuleRunRecord, type RuleRun } from './rule-runs'

describe('rule run comparison', () => {
  it('compares the latest successful reconciliation run to the previous successful run', () => {
    const previousRun = ruleRun({
      completedAt: new Date('2026-06-02T08:00:01.000Z'),
      findingIds: ['finding_recurring_usage', 'finding_resolved_rate'],
      findingCategories: ['usage_exists_no_invoice', 'wrong_overage_rate'],
    })
    const currentRun = ruleRun({
      completedAt: new Date('2026-06-03T08:00:01.000Z'),
      findingIds: ['finding_recurring_usage', 'finding_new_cost'],
      findingCategories: ['usage_exists_no_invoice', 'cost_exceeds_revenue'],
    })
    const failedRun = ruleRun({
      status: 'failed',
      completedAt: new Date('2026-06-04T08:00:01.000Z'),
      findingIds: [],
      findingCategories: [],
    })

    expect(buildLatestRuleRunComparison([previousRun, failedRun, currentRun])).toEqual({
      currentRunId: currentRun.id,
      previousRunId: previousRun.id,
      newFindingIds: ['finding_new_cost'],
      recurringFindingIds: ['finding_recurring_usage'],
      resolvedFindingIds: ['finding_resolved_rate'],
      counts: {
        new: 1,
        recurring: 1,
        resolved: 1,
      },
    })
  })

  it('returns null when there are fewer than two successful reconciliation runs', () => {
    expect(buildLatestRuleRunComparison([ruleRun({ completedAt: new Date('2026-06-03T08:00:01.000Z') })])).toBeNull()
    expect(
      buildLatestRuleRunComparison([
        ruleRun({
          status: 'failed',
          completedAt: new Date('2026-06-03T08:00:01.000Z'),
          findingIds: ['finding_failed'],
        }),
      ]),
    ).toBeNull()
  })
})

function ruleRun(input: {
  status?: RuleRun['status']
  completedAt: Date
  findingIds?: string[]
  findingCategories?: string[]
}): RuleRun {
  return createRuleRunRecord({
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    actorId: 'internal_admin',
    ruleVersion: 'reconciliation_rules_v1',
    status: input.status ?? 'reviewing',
    inputs: {
      ruleTemplateIds: ['usage_without_invoice', 'wrong_overage_rate', 'cost_exceeds_revenue'],
      parsedRecordCount: 24,
      contractTermCount: 2,
      accountMappingCount: 1,
    },
    output: {
      findingCount: input.findingIds?.length ?? 0,
      findingIds: input.findingIds ?? [],
      findingCategories: input.findingCategories ?? [],
    },
    errors: [],
    startedAt: new Date(input.completedAt.getTime() - 1000),
    completedAt: input.completedAt,
  })
}
