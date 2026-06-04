import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { pricingRuleVersionSnapshotSchema } from './pricing-rules'

export const RECONCILIATION_RULE_VERSION = 'reconciliation_rules_v1'

export const ruleRunStatusSchema = z.enum(['complete', 'reviewing', 'failed'])

export const ruleRunInputSchema = z.object({
  ruleTemplateIds: z.array(z.string().min(1)),
  parsedRecordCount: z.number().int().nonnegative(),
  contractTermCount: z.number().int().nonnegative(),
  accountMappingCount: z.number().int().nonnegative(),
  lateUsageGracePeriodDays: z.number().int().nonnegative().optional(),
  pricingRuleVersions: z.array(pricingRuleVersionSnapshotSchema).optional(),
})

export const ruleRunOutputSchema = z.object({
  findingCount: z.number().int().nonnegative(),
  findingIds: z.array(z.string().min(1)),
  findingCategories: z.array(z.string().min(1)),
  suppressedFindingCount: z.number().int().nonnegative().default(0),
})

export const ruleRunErrorSchema = z.object({
  message: z.string().min(1),
})

export const ruleRunSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  actorId: z.string().min(1),
  status: ruleRunStatusSchema,
  ruleVersion: z.string().min(1),
  inputs: ruleRunInputSchema,
  output: ruleRunOutputSchema,
  errors: z.array(ruleRunErrorSchema).default([]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
})

export type RuleRun = z.infer<typeof ruleRunSchema>
export type RuleRunInput = Omit<RuleRun, 'id' | 'startedAt' | 'completedAt' | 'output'> & {
  output: z.input<typeof ruleRunOutputSchema>
  startedAt: Date
  completedAt: Date
}

export function createRuleRunRecord(input: RuleRunInput): RuleRun {
  const startedAt = input.startedAt.toISOString()
  const completedAt = input.completedAt.toISOString()

  return ruleRunSchema.parse({
    ...input,
    id: `rule_run_${input.workspaceId}_${slugTimestamp(startedAt)}`,
    startedAt,
    completedAt,
  })
}

export class JsonRuleRunStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<RuleRun[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z
        .array(ruleRunSchema)
        .parse(JSON.parse(raw))
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<RuleRun[]> {
    const runs = await this.list()

    return runs.filter((run) => run.workspaceId === workspaceId)
  }

  async save(run: RuleRun): Promise<void> {
    const runs = await this.list()
    const nextById = new Map(runs.map((existing) => [existing.id, existing]))
    nextById.set(run.id, run)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const runs = await this.list()
    const next = runs.filter((run) => run.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return runs.length - next.length
  }
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
