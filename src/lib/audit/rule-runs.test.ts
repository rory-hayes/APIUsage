import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JsonRuleRunStore, createRuleRunRecord } from './rule-runs'

describe('rule run history', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-rule-runs-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('persists reconciliation run inputs, version, output, and errors by workspace', async () => {
    const store = new JsonRuleRunStore(join(tempDir, 'rule-runs.json'))
    const run = createRuleRunRecord({
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      actorId: 'internal_admin',
      status: 'reviewing',
      ruleVersion: 'reconciliation_rules_v1',
      inputs: {
        ruleTemplateIds: ['usage_without_invoice', 'cost_exceeds_revenue'],
        parsedRecordCount: 24,
        contractTermCount: 2,
        accountMappingCount: 1,
        pricingRuleVersions: [
          {
            pricingRuleId: 'pricing_rule_api_overage',
            name: 'API overage rate',
            version: 2,
            status: 'active',
          },
        ],
      },
      output: {
        findingCount: 1,
        findingIds: ['finding_usage_without_invoice'],
        findingCategories: ['usage_exists_no_invoice'],
      },
      errors: [],
      startedAt: new Date('2026-06-03T10:00:00.000Z'),
      completedAt: new Date('2026-06-03T10:00:02.000Z'),
    })
    const failedRun = createRuleRunRecord({
      organizationId: 'org_acme',
      workspaceId: 'workspace_acme_may_2026',
      actorId: 'internal_admin',
      status: 'failed',
      ruleVersion: 'reconciliation_rules_v1',
      inputs: {
        ruleTemplateIds: ['wrong_overage_rate'],
        parsedRecordCount: 12,
        contractTermCount: 1,
        accountMappingCount: 0,
      },
      output: {
        findingCount: 0,
        findingIds: [],
        findingCategories: [],
      },
      errors: [{ message: 'Contract terms could not be loaded' }],
      startedAt: new Date('2026-06-03T11:00:00.000Z'),
      completedAt: new Date('2026-06-03T11:00:01.000Z'),
    })

    await store.save(run)
    await store.save(failedRun)

    expect(run.inputs.pricingRuleVersions).toEqual([
      {
        pricingRuleId: 'pricing_rule_api_overage',
        name: 'API overage rate',
        version: 2,
        status: 'active',
      },
    ])
    await expect(store.listByWorkspace('workspace_northstar_june_2026')).resolves.toEqual([run])
    await expect(store.listByWorkspace('workspace_acme_may_2026')).resolves.toEqual([failedRun])
    await expect(store.list()).resolves.toEqual([failedRun, run])
  })
})
