import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { uploadCategorySchema, type UploadCategory } from './uploads'

export const dataDictionaryDataTypeSchema = z.enum(['string', 'number', 'date', 'boolean', 'currency', 'json', 'unknown'])

export const dataDictionaryEntrySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  sourceCategory: uploadCategorySchema,
  sourceField: z.string().trim().min(1),
  normalizedField: z.string().trim().min(1).optional(),
  dataType: dataDictionaryDataTypeSchema.default('unknown'),
  meaning: z.string().trim().min(1),
  exampleValue: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type DataDictionaryDataType = z.infer<typeof dataDictionaryDataTypeSchema>
export type DataDictionaryEntry = z.infer<typeof dataDictionaryEntrySchema>

export type CreateDataDictionaryEntryInput = {
  organizationId: string
  workspaceId: string
  sourceCategory: UploadCategory
  sourceField: string
  normalizedField?: string
  dataType?: DataDictionaryDataType
  meaning: string
  exampleValue?: string
  notes?: string
  createdBy: string
}

export function createDataDictionaryEntry(input: CreateDataDictionaryEntryInput, now = new Date()): DataDictionaryEntry {
  const timestamp = now.toISOString()
  const sourceField = input.sourceField.trim()

  return dataDictionaryEntrySchema.parse({
    ...input,
    id: dataDictionaryEntryId(input.workspaceId, input.sourceCategory, sourceField),
    sourceField,
    normalizedField: trimToUndefined(input.normalizedField),
    dataType: input.dataType ?? 'unknown',
    meaning: input.meaning.trim(),
    exampleValue: trimToUndefined(input.exampleValue),
    notes: trimToUndefined(input.notes),
    createdBy: input.createdBy,
    updatedBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

export class JsonDataDictionaryStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<DataDictionaryEntry[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortEntries(z.array(dataDictionaryEntrySchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<DataDictionaryEntry[]> {
    const entries = await this.list()

    return entries.filter((entry) => entry.workspaceId === workspaceId)
  }

  async saveMany(entries: DataDictionaryEntry[]): Promise<void> {
    const existing = await this.list()
    const nextById = new Map(existing.map((entry) => [entry.id, entry]))

    for (const entry of entries) {
      nextById.set(entry.id, entry)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortEntries([...nextById.values()]), null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const entries = await this.list()
    const next = entries.filter((entry) => entry.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return entries.length - next.length
  }
}

function dataDictionaryEntryId(workspaceId: string, sourceCategory: UploadCategory, sourceField: string): string {
  return `dict_${slug(workspaceId)}_${sourceCategory}_${slug(sourceField)}`
}

function sortEntries(entries: DataDictionaryEntry[]): DataDictionaryEntry[] {
  return [...entries].sort((a, b) =>
    [a.workspaceId, a.sourceCategory, a.sourceField].join(':').localeCompare([b.workspaceId, b.sourceCategory, b.sourceField].join(':')),
  )
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed ? trimmed : undefined
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
