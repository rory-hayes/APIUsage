import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { type Finding } from './schemas'

const suppressionStatusSchema = z.enum(['active', 'disabled'])

const suppressionFingerprintSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    accountKey: z.string().min(1).optional(),
    customerName: z.string().min(1).optional(),
    meter: z.string().min(1).optional(),
  })
  .refine((fingerprint) => Object.values(fingerprint).some((value) => typeof value === 'string' && value.length > 0), {
    message: 'A suppression fingerprint needs at least one matching field',
  })

export const findingSuppressionSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  category: z.string().min(1),
  status: suppressionStatusSchema,
  fingerprint: suppressionFingerprintSchema,
  reason: z.string().min(1),
  createdFromFindingId: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
})

export type FindingSuppression = z.infer<typeof findingSuppressionSchema>

export function createFindingSuppressionFromRejectedFinding(
  finding: Finding,
  input: {
    createdBy: string
    reason?: string
    createdAt?: Date
  },
): FindingSuppression {
  const createdAt = input.createdAt ?? new Date()
  const fingerprint = suppressionFingerprintForFinding(finding)

  return findingSuppressionSchema.parse({
    id: `suppression_${finding.workspaceId}_${finding.category}_${slug(Object.values(fingerprint).join('_'))}_${slugTimestamp(createdAt.toISOString())}`,
    organizationId: finding.organizationId,
    workspaceId: finding.workspaceId,
    category: finding.category,
    status: 'active',
    fingerprint,
    reason: input.reason ?? 'Rejected as a false positive.',
    createdFromFindingId: finding.id,
    createdBy: input.createdBy,
    createdAt: createdAt.toISOString(),
  })
}

export function applyFindingSuppressions(findings: Finding[], suppressions: FindingSuppression[]): Finding[] {
  return findings.filter((finding) => !suppressions.some((suppression) => suppressionMatchesFinding(suppression, finding)))
}

export function suppressionMatchesFinding(suppression: FindingSuppression, finding: Finding): boolean {
  if (suppression.status !== 'active' || suppression.workspaceId !== finding.workspaceId || suppression.category !== finding.category) {
    return false
  }

  const findingFingerprint = suppressionFingerprintForFinding(finding)

  return Object.entries(suppression.fingerprint).every(([field, value]) => {
    const findingValue = findingFingerprint[field as keyof typeof findingFingerprint]

    return typeof findingValue === 'string' && normalize(findingValue) === normalize(value)
  })
}

export class JsonFindingSuppressionStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<FindingSuppression[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')

      return z
        .array(findingSuppressionSchema)
        .parse(JSON.parse(raw))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<FindingSuppression[]> {
    const suppressions = await this.list()

    return suppressions.filter((suppression) => suppression.workspaceId === workspaceId)
  }

  async save(suppression: FindingSuppression): Promise<void> {
    const suppressions = await this.list()
    const nextById = new Map(suppressions.map((existing) => [existing.id, existing]))
    nextById.set(suppression.id, suppression)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const suppressions = await this.list()
    const next = suppressions.filter((suppression) => suppression.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return suppressions.length - next.length
  }
}

function suppressionFingerprintForFinding(finding: Finding): z.infer<typeof suppressionFingerprintSchema> {
  return suppressionFingerprintSchema.parse(
    stripUndefined({
      customerId: finding.customerId,
      accountKey: readString(finding.metadata.accountKey),
      customerName: readString(finding.metadata.customerName),
      meter: readString(finding.metadata.meter),
    }),
  )
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function stripUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
