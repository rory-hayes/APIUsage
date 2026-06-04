import { dirname } from 'node:path'
import { z } from 'zod'

import { type AccountMapping } from './account-mapping'
import { applyFindingSuppressions, type FindingSuppression } from './finding-suppressions'
import { type ParsedRecord } from './parse-jobs'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { snapshotActivePricingRuleVersions, type PricingRule } from './pricing-rules'
import { generateReconciliationFindings, type JsonFindingStore } from './reconciliation'
import { createRuleRunRecord, RECONCILIATION_RULE_VERSION, type JsonRuleRunStore, type RuleRun } from './rule-runs'
import { resolveRuleTemplateSelection, ruleTemplateIdSchema, type RuleTemplateId } from './rule-templates'
import { type ContractTerm, type Finding } from './schemas'

export const reconciliationScheduleCadenceSchema = z.enum(['monthly'])
export const reconciliationScheduleStatusSchema = z.enum(['active', 'paused'])

export const reconciliationScheduleSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  cadence: reconciliationScheduleCadenceSchema,
  status: reconciliationScheduleStatusSchema,
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  runAt: z.string().datetime(),
  timezone: z.string().min(1),
  lateUsageGracePeriodDays: z.number().int().nonnegative().default(0),
  ruleTemplateIds: z.array(ruleTemplateIdSchema).min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastRunAt: z.string().datetime().optional(),
  lastRunId: z.string().min(1).optional(),
})

export type ReconciliationSchedule = z.infer<typeof reconciliationScheduleSchema>

export type ReconciliationScheduleInput = {
  organizationId: string
  workspaceId: string
  name: string
  periodStart: string
  periodEnd: string
  runAt: string
  timezone: string
  lateUsageGracePeriodDays?: number
  ruleTemplateIds?: RuleTemplateId[]
  createdBy: string
}

export type ScheduledReconciliationRunResult = {
  schedule: ReconciliationSchedule
  ruleRun: RuleRun
  findings: Finding[]
  suppressedFindingCount: number
}

export function createReconciliationSchedule(input: ReconciliationScheduleInput, now = new Date()): ReconciliationSchedule {
  const createdAt = now.toISOString()
  const ruleTemplateIds = resolveRuleTemplateSelection(input.ruleTemplateIds).map((template) => template.id)

  return reconciliationScheduleSchema.parse({
    id: `reconciliation_schedule_${input.workspaceId}_${slug(input.name)}`,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    cadence: 'monthly',
    status: 'active',
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    runAt: input.runAt,
    timezone: input.timezone.trim(),
    lateUsageGracePeriodDays: input.lateUsageGracePeriodDays ?? 0,
    ruleTemplateIds,
    createdBy: input.createdBy,
    createdAt,
    updatedAt: createdAt,
  })
}

export function listDueReconciliationSchedules(schedules: ReconciliationSchedule[], now = new Date()): ReconciliationSchedule[] {
  const dueAt = now.getTime()

  return schedules.filter((schedule) => schedule.status === 'active' && new Date(schedule.runAt).getTime() <= dueAt)
}

export async function runAndPersistScheduledReconciliation(
  input: {
    schedule: ReconciliationSchedule
    actorId: string
    parsedRecords: ParsedRecord[]
    contractTerms: ContractTerm[]
    accountMappings: AccountMapping[]
    pricingRules?: PricingRule[]
    findingSuppressions?: FindingSuppression[]
    findingStore: JsonFindingStore
    ruleRunStore: JsonRuleRunStore
    scheduleStore: JsonReconciliationScheduleStore
    now?: Date
  },
): Promise<ScheduledReconciliationRunResult> {
  const startedAt = input.now ?? new Date()
  const checkIds = resolveRuleTemplateSelection(input.schedule.ruleTemplateIds).map((template) => template.id)
  const generatedFindings = generateReconciliationFindings(
    input.parsedRecords,
    input.contractTerms,
      startedAt,
      input.accountMappings,
      checkIds,
      { lateUsageGracePeriodDays: input.schedule.lateUsageGracePeriodDays },
    )
  const findings = applyFindingSuppressions(generatedFindings, input.findingSuppressions ?? [])
  const suppressedFindingCount = generatedFindings.length - findings.length
  const completedAt = input.now ?? new Date()
  const pricingRuleVersions = snapshotActivePricingRuleVersions(input.pricingRules ?? [])
  const ruleRun = createRuleRunRecord({
    organizationId: input.schedule.organizationId,
    workspaceId: input.schedule.workspaceId,
    actorId: input.actorId,
    status: findings.length > 0 ? 'reviewing' : 'complete',
    ruleVersion: RECONCILIATION_RULE_VERSION,
    inputs: {
      ruleTemplateIds: checkIds,
      parsedRecordCount: input.parsedRecords.length,
      contractTermCount: input.contractTerms.length,
      accountMappingCount: input.accountMappings.length,
      ...(pricingRuleVersions.length > 0 ? { pricingRuleVersions } : {}),
      ...(input.schedule.lateUsageGracePeriodDays > 0 ? { lateUsageGracePeriodDays: input.schedule.lateUsageGracePeriodDays } : {}),
    },
    output: {
      findingCount: findings.length,
      findingIds: findings.map((finding) => finding.id),
      findingCategories: uniqueStrings(findings.map((finding) => finding.category)),
      suppressedFindingCount,
    },
    errors: [],
    startedAt,
    completedAt,
  })
  const schedule = advanceMonthlySchedule(input.schedule, ruleRun, completedAt)

  await input.findingStore.replaceDraftsForWorkspace(input.schedule.workspaceId, findings)
  await input.ruleRunStore.save(ruleRun)
  await input.scheduleStore.save(schedule)

  return {
    schedule,
    ruleRun,
    findings,
    suppressedFindingCount,
  }
}

export class JsonReconciliationScheduleStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReconciliationSchedule[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')

      return z
        .array(reconciliationScheduleSchema)
        .parse(JSON.parse(raw))
        .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime())
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<ReconciliationSchedule[]> {
    const schedules = await this.list()

    return schedules.filter((schedule) => schedule.workspaceId === workspaceId)
  }

  async save(schedule: ReconciliationSchedule): Promise<void> {
    const schedules = await this.list()
    const nextById = new Map(schedules.map((existing) => [existing.id, existing]))
    nextById.set(schedule.id, schedule)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const schedules = await this.list()
    const next = schedules.filter((schedule) => schedule.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return schedules.length - next.length
  }
}

function advanceMonthlySchedule(schedule: ReconciliationSchedule, ruleRun: RuleRun, completedAt: Date): ReconciliationSchedule {
  const periodStart = addMonthsToDateString(schedule.periodStart, 1)

  return reconciliationScheduleSchema.parse({
    ...schedule,
    periodStart,
    periodEnd: endOfMonthDateString(periodStart),
    runAt: addMonthsToIsoDateTime(schedule.runAt, 1),
    lastRunAt: completedAt.toISOString(),
    lastRunId: ruleRun.id,
    updatedAt: completedAt.toISOString(),
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function addMonthsToIsoDateTime(value: string, months: number): string {
  const date = new Date(value)
  const { year, monthIndex } = addMonths(date.getUTCFullYear(), date.getUTCMonth(), months)
  const day = Math.min(date.getUTCDate(), daysInMonth(year, monthIndex))

  return new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  ).toISOString()
}

function addMonthsToDateString(value: string, months: number): string {
  const [yearPart, monthPart, dayPart] = value.split('-').map(Number)
  const { year, monthIndex } = addMonths(yearPart, monthPart - 1, months)
  const day = Math.min(dayPart, daysInMonth(year, monthIndex))

  return formatDate(year, monthIndex, day)
}

function endOfMonthDateString(value: string): string {
  const [year, month] = value.split('-').map(Number)

  return formatDate(year, month - 1, daysInMonth(year, month - 1))
}

function addMonths(year: number, monthIndex: number, months: number) {
  const nextMonthIndex = monthIndex + months

  return {
    year: year + Math.floor(nextMonthIndex / 12),
    monthIndex: ((nextMonthIndex % 12) + 12) % 12,
  }
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function formatDate(year: number, monthIndex: number, day: number): string {
  return [year, monthIndex + 1, day].map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0'))).join('-')
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
