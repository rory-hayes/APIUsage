import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { type Finding } from './schemas'

export const reportBuilderConfigSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  selectedFindingIds: z.array(z.string().min(1)).default([]),
  noteFindingIds: z.array(z.string().min(1)).default([]),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type ReportBuilderConfig = z.infer<typeof reportBuilderConfigSchema>

export type CreateReportBuilderConfigInput = {
  workspaceId: string
  selectedFindingIds: string[]
  noteFindingIds: string[]
  updatedBy: string
  metadata?: Record<string, unknown>
}

export function createReportBuilderConfig(input: CreateReportBuilderConfigInput, now = new Date()): ReportBuilderConfig {
  const selectedFindingIds = uniqueNonEmptyStrings(input.selectedFindingIds)
  const selectedFindingIdSet = new Set(selectedFindingIds)

  return reportBuilderConfigSchema.parse({
    id: `report_builder_${slug(input.workspaceId)}`,
    workspaceId: input.workspaceId,
    selectedFindingIds,
    noteFindingIds: uniqueNonEmptyStrings(input.noteFindingIds).filter((id) => selectedFindingIdSet.has(id)),
    updatedBy: input.updatedBy,
    updatedAt: now.toISOString(),
    metadata: input.metadata ?? {},
  })
}

export function applyReportBuilderConfig(findings: Finding[], config: ReportBuilderConfig | null | undefined): Finding[] {
  if (!config) {
    return findings
  }

  const selectedFindingIds = new Set(config.selectedFindingIds)
  const noteFindingIds = new Set(config.noteFindingIds)

  return findings
    .filter((finding) => selectedFindingIds.has(finding.id))
    .map((finding) => (noteFindingIds.has(finding.id) ? finding : { ...finding, customerNote: undefined }))
}

export class JsonReportBuilderConfigStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReportBuilderConfig[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z
        .array(reportBuilderConfigSchema)
        .parse(JSON.parse(raw))
        .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async getByWorkspace(workspaceId: string): Promise<ReportBuilderConfig | null> {
    const configs = await this.list()

    return configs.find((config) => config.workspaceId === workspaceId) ?? null
  }

  async save(config: ReportBuilderConfig): Promise<void> {
    const configs = await this.list()
    const next = [...configs.filter((existing) => existing.workspaceId !== config.workspaceId), config]

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const configs = await this.list()
    const next = configs.filter((config) => config.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return configs.length - next.length
  }
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const value of values) {
    const trimmed = value.trim()

    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed)
      unique.push(trimmed)
    }
  }

  return unique
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
