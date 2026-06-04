import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFindingSuppressionFromRejectedFinding } from './finding-suppressions'
import { type ParsedRecord } from './parse-jobs'
import { createPricingRule, updatePricingRule } from './pricing-rules'
import { generateUsageWithoutInvoiceFindings, JsonFindingStore } from './reconciliation'
import {
  createReconciliationSchedule,
  JsonReconciliationScheduleStore,
  listDueReconciliationSchedules,
  runAndPersistScheduledReconciliation,
} from './reconciliation-schedules'
import { JsonRuleRunStore } from './rule-runs'

describe('scheduled reconciliation runs', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-reconciliation-schedules-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('persists monthly pre-close schedules and lists only active due schedules', async () => {
    const store = new JsonReconciliationScheduleStore(join(tempDir, 'reconciliation-schedules.json'))
    const dueSchedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'May close pre-check',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        runAt: '2026-06-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        lateUsageGracePeriodDays: 3,
        ruleTemplateIds: ['usage_without_invoice'],
        createdBy: 'user_finance',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const futureSchedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        name: 'June close pre-check',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        runAt: '2026-07-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        ruleTemplateIds: ['usage_without_invoice'],
        createdBy: 'user_finance',
      },
      new Date('2026-06-01T09:05:00.000Z'),
    )
    const pausedSchedule = {
      ...createReconciliationSchedule(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_003',
          name: 'Paused pre-check',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          runAt: '2026-06-03T08:00:00.000Z',
          timezone: 'Europe/Dublin',
          ruleTemplateIds: ['usage_without_invoice'],
          createdBy: 'user_finance',
        },
        new Date('2026-06-01T09:10:00.000Z'),
      ),
      status: 'paused' as const,
    }

    await store.save(dueSchedule)
    await store.save(futureSchedule)
    await store.save(pausedSchedule)

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([dueSchedule])
    expect(listDueReconciliationSchedules(await store.list(), new Date('2026-06-03T07:59:59.000Z'))).toEqual([])
    expect(listDueReconciliationSchedules(await store.list(), new Date('2026-06-03T08:00:00.000Z'))).toEqual([dueSchedule])
  })

  it('passes the configured late-usage grace period into scheduled reconciliation checks', async () => {
    const scheduleStore = new JsonReconciliationScheduleStore(join(tempDir, 'reconciliation-schedules.json'))
    const findingStore = new JsonFindingStore(join(tempDir, 'findings.json'))
    const ruleRunStore = new JsonRuleRunStore(join(tempDir, 'rule-runs.json'))
    const schedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'May close pre-check',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        runAt: '2026-06-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        lateUsageGracePeriodDays: 3,
        ruleTemplateIds: ['late_usage_after_invoice_finalization'],
        createdBy: 'user_finance',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const usageInsideGraceWindow = usageRecord({
      id: 'parsed_usage_grace_period',
      normalizedId: 'usage_grace_period',
      accountId: 'acct_late_usage',
      customerName: 'Late Usage Ltd.',
      metadata: { ingestedAt: '2026-06-03T09:00:00.000Z' },
    })
    const invoice = invoiceLineRecord({
      externalCustomerId: 'acct_late_usage',
      description: 'May llm_tokens usage',
      metadata: { finalizedAt: '2026-06-01T10:00:00.000Z' },
    })

    await scheduleStore.save(schedule)

    const result = await runAndPersistScheduledReconciliation({
      schedule,
      actorId: 'system_scheduler',
      parsedRecords: [usageInsideGraceWindow, invoice],
      contractTerms: [],
      accountMappings: [],
      findingStore,
      ruleRunStore,
      scheduleStore,
      now: new Date('2026-06-04T12:00:00.000Z'),
    })

    expect(result.findings).toEqual([])
    await expect(ruleRunStore.listByWorkspace('workspace_001')).resolves.toEqual([
      expect.objectContaining({
        status: 'complete',
        inputs: expect.objectContaining({
          lateUsageGracePeriodDays: 3,
        }),
        output: expect.objectContaining({
          findingCount: 0,
        }),
      }),
    ])
  })

  it('captures active pricing rule versions used by scheduled reconciliation checks', async () => {
    const scheduleStore = new JsonReconciliationScheduleStore(join(tempDir, 'reconciliation-schedules.json'))
    const findingStore = new JsonFindingStore(join(tempDir, 'findings.json'))
    const ruleRunStore = new JsonRuleRunStore(join(tempDir, 'rule-runs.json'))
    const schedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'May close pre-check',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        runAt: '2026-06-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        ruleTemplateIds: ['usage_without_invoice'],
        createdBy: 'user_finance',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const activePricingRule = updatePricingRule(
      createPricingRule(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_001',
          name: 'API overage rate',
          type: 'overage_rate',
          rate: 1.25,
          currency: 'EUR',
          createdBy: 'user_finance',
        },
        new Date('2026-06-01T10:00:00.000Z'),
      ),
      {
        name: 'API overage rate',
        type: 'overage_rate',
        rate: 1.5,
        currency: 'EUR',
        updatedBy: 'user_finance',
      },
      new Date('2026-06-02T10:00:00.000Z'),
    )
    const rejectedPricingRule = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'Rejected discount',
        type: 'discount',
        discountPercent: 10,
        status: 'rejected',
        createdBy: 'user_finance',
      },
      new Date('2026-06-01T11:00:00.000Z'),
    )

    await scheduleStore.save(schedule)

    const result = await runAndPersistScheduledReconciliation({
      schedule,
      actorId: 'system_scheduler',
      parsedRecords: [],
      contractTerms: [],
      accountMappings: [],
      pricingRules: [activePricingRule, rejectedPricingRule],
      findingStore,
      ruleRunStore,
      scheduleStore,
      now: new Date('2026-06-03T08:30:00.000Z'),
    })

    expect(result.ruleRun.inputs.pricingRuleVersions).toEqual([
      {
        pricingRuleId: activePricingRule.id,
        name: 'API overage rate',
        version: 2,
        status: 'active',
      },
    ])
    await expect(ruleRunStore.listByWorkspace('workspace_001')).resolves.toEqual([
      expect.objectContaining({
        inputs: expect.objectContaining({
          pricingRuleVersions: [
            {
              pricingRuleId: activePricingRule.id,
              name: 'API overage rate',
              version: 2,
              status: 'active',
            },
          ],
        }),
      }),
    ])
  })

  it('runs a due pre-close schedule, suppresses known false positives, and advances the next monthly period', async () => {
    const scheduleStore = new JsonReconciliationScheduleStore(join(tempDir, 'reconciliation-schedules.json'))
    const findingStore = new JsonFindingStore(join(tempDir, 'findings.json'))
    const ruleRunStore = new JsonRuleRunStore(join(tempDir, 'rule-runs.json'))
    const schedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'May close pre-check',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        runAt: '2026-06-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        ruleTemplateIds: ['usage_without_invoice'],
        createdBy: 'user_finance',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const suppressedUsage = usageRecord({
      id: 'parsed_usage_suppressed',
      normalizedId: 'usage_suppressed',
      accountId: 'acct_suppressed',
      customerName: 'Suppressed AI',
    })
    const activeUsage = usageRecord({
      id: 'parsed_usage_active',
      normalizedId: 'usage_active',
      accountId: 'acct_active',
      customerName: 'Active AI',
    })
    const [suppressedFinding] = generateUsageWithoutInvoiceFindings(
      [suppressedUsage],
      new Date('2026-06-03T08:30:00.000Z'),
    )
    const suppression = createFindingSuppressionFromRejectedFinding(suppressedFinding, {
      createdBy: 'internal_admin',
      createdAt: new Date('2026-06-02T10:00:00.000Z'),
      reason: 'Expected sandbox account usage.',
    })

    await scheduleStore.save(schedule)

    const result = await runAndPersistScheduledReconciliation({
      schedule,
      actorId: 'system_scheduler',
      parsedRecords: [suppressedUsage, activeUsage],
      contractTerms: [],
      accountMappings: [],
      findingSuppressions: [suppression],
      findingStore,
      ruleRunStore,
      scheduleStore,
      now: new Date('2026-06-03T08:30:00.000Z'),
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      category: 'usage_exists_no_invoice',
      metadata: expect.objectContaining({
        accountKey: 'acct_active',
        checkId: 'usage_without_invoice',
      }),
    })
    await expect(findingStore.listByWorkspace('workspace_001')).resolves.toEqual(result.findings)
    await expect(ruleRunStore.listByWorkspace('workspace_001')).resolves.toEqual([
      expect.objectContaining({
        actorId: 'system_scheduler',
        status: 'reviewing',
        inputs: {
          ruleTemplateIds: ['usage_without_invoice'],
          parsedRecordCount: 2,
          contractTermCount: 0,
          accountMappingCount: 0,
        },
        output: {
          findingCount: 1,
          findingIds: [result.findings[0].id],
          findingCategories: ['usage_exists_no_invoice'],
          suppressedFindingCount: 1,
        },
      }),
    ])
    await expect(scheduleStore.listByWorkspace('workspace_001')).resolves.toEqual([
      expect.objectContaining({
        id: schedule.id,
        status: 'active',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        runAt: '2026-07-03T08:00:00.000Z',
        lastRunAt: '2026-06-03T08:30:00.000Z',
        lastRunId: result.ruleRun.id,
      }),
    ])
  })
})

function usageRecord(overrides: {
  id: string
  normalizedId: string
  accountId: string
  customerName: string
  metadata?: Record<string, unknown>
}): ParsedRecord {
  return {
    id: overrides.id,
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_usage',
    uploadId: 'upl_usage',
    sourceFileId: 'src_usage',
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id: overrides.normalizedId,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      accountId: overrides.accountId,
      customerName: overrides.customerName,
      meter: 'llm_tokens',
      quantity: 1000,
      unit: 'tokens',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_usage', rowNumber: 2 }],
      metadata: overrides.metadata ?? {},
    },
  }
}

function invoiceLineRecord(overrides: {
  externalCustomerId: string
  description: string
  metadata?: Record<string, unknown>
}): ParsedRecord {
  return {
    id: 'parsed_invoice_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    jobId: 'parse_invoice',
    uploadId: 'upl_invoice',
    sourceFileId: 'src_invoice',
    recordType: 'invoice_line',
    sourceRowNumber: 2,
    data: {
      id: 'line_001',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      invoiceId: 'in_001',
      externalCustomerId: overrides.externalCustomerId,
      description: overrides.description,
      amount: 19950,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'src_invoice', rowNumber: 2 }],
      metadata: overrides.metadata ?? {},
    },
  }
}
