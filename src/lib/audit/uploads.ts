import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir as fsMkdir, readFile as fsReadFile, rm, writeFile as fsWriteFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

import {
  deleteSupabaseUploadWorkspace,
  mkdir as persistenceMkdir,
  readJsonFile,
  readSupabaseUploadBytes,
  writeJsonFile,
  writeSupabaseUploadBytes,
} from './persistence'

export const uploadCategorySchema = z.enum([
  'contracts_order_forms',
  'pricing_docs',
  'stripe_invoices_export',
  'stripe_customers_export',
  'stripe_subscriptions_export',
  'usage_csv',
  'account_mapping_csv',
  'credits_allowances_csv',
  'provider_cost_csv',
  'other_supporting_docs',
])

export const uploadStatusSchema = z.enum([
  'missing',
  'needs_review',
  'accepted',
  'rejected',
  'duplicate',
  'needs_clarification',
])

export type UploadCategory = z.infer<typeof uploadCategorySchema>
export type UploadStatus = z.infer<typeof uploadStatusSchema>

export type RequiredUploadCategory = {
  category: UploadCategory
  label: string
  owner: string
  required: boolean
}

export const REQUIRED_UPLOAD_CATEGORIES: RequiredUploadCategory[] = [
  { category: 'contracts_order_forms', label: 'Contracts/order forms', owner: 'Finance', required: true },
  { category: 'pricing_docs', label: 'Pricing docs', owner: 'Revenue Ops', required: true },
  { category: 'stripe_invoices_export', label: 'Stripe invoices export', owner: 'Finance', required: true },
  { category: 'stripe_customers_export', label: 'Stripe customers export', owner: 'Finance', required: true },
  { category: 'stripe_subscriptions_export', label: 'Stripe subscriptions export', owner: 'Finance', required: true },
  { category: 'usage_csv', label: 'Product usage CSV', owner: 'Engineering', required: true },
  { category: 'account_mapping_csv', label: 'Customer/account mapping CSV', owner: 'Engineering', required: true },
  { category: 'credits_allowances_csv', label: 'Credits/allowances CSV', owner: 'Finance', required: false },
  { category: 'provider_cost_csv', label: 'Provider cost CSV', owner: 'Finance', required: false },
  { category: 'other_supporting_docs', label: 'Other supporting docs', owner: 'Operator', required: false },
]

export const DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS: UploadCategory[] = REQUIRED_UPLOAD_CATEGORIES.filter((item) => item.required).map(
  (item) => item.category,
)

export const uploadRecordSchema = z.object({
  id: z.string().min(1),
  sourceFileId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  category: uploadCategorySchema,
  filename: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  storageKey: z.string().min(1),
  checksum: z.string().min(1).optional(),
  uploadedBy: z.string().min(1),
  uploadedAt: z.string().datetime(),
  status: uploadStatusSchema.exclude(['missing']).default('needs_review'),
  reviewedBy: z.string().min(1).optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewNote: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type UploadRecord = z.infer<typeof uploadRecordSchema>

export const uploadTaskCommentSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  category: uploadCategorySchema,
  body: z.string().trim().min(1),
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  authorRole: z.enum(['customer_admin', 'customer_member', 'internal_admin']),
  createdAt: z.string().datetime(),
})

export type UploadTaskComment = z.infer<typeof uploadTaskCommentSchema>

export type CreateUploadRecordInput = {
  organizationId: string
  workspaceId: string
  category: UploadCategory
  filename: string
  byteSize: number
  contentType: string
  storageKey: string
  checksum?: string
  uploadedBy: string
  metadata?: Record<string, unknown>
}

export type CreateUploadTaskCommentInput = {
  organizationId: string
  workspaceId: string
  category: UploadCategory
  body: string
  authorId: string
  authorName: string
  authorRole: UploadTaskComment['authorRole']
}

export type UploadChecklistItem = RequiredUploadCategory & {
  files: number
  status: UploadStatus
  latestUpload?: UploadRecord
  versions: UploadVersion[]
  periodId?: string
  periodLabel?: string
  periodScope?: 'workspace' | 'current_period' | 'rolled_forward'
  rollsForward?: boolean
}

export type UploadVersion = {
  version: number
  uploadId: string
  sourceFileId: string
  filename: string
  byteSize: number
  checksum?: string
  uploadedAt: string
  uploadedBy: string
  status: Exclude<UploadStatus, 'missing'>
  isLatest: boolean
  changedFromPrevious: boolean | null
  byteDeltaFromPrevious: number | null
  previousUploadId?: string
}

export type LocalUploadInput = {
  workspaceId: string
  category: UploadCategory
  filename: string
  bytes: Buffer | Uint8Array
  contentType?: string
}

export type SavedLocalUpload = {
  storageKey: string
  byteSize: number
  checksum: string
  contentType: string
}

export type UploadStorage = {
  save(input: LocalUploadInput): Promise<SavedLocalUpload>
  readText(storageKey: string): Promise<string>
  readBytes(storageKey: string): Promise<Buffer>
  deleteWorkspace(workspaceId: string): Promise<boolean>
}

export type UploadChecklistWorkspace = {
  id: string
  requiredUploadCategories?: UploadCategory[]
  monitoringPeriods?: UploadChecklistPeriod[]
}

export type UploadChecklistPeriod = {
  id: string
  label: string
  periodStart: string
  periodEnd: string
  status: 'planned' | 'active' | 'closed'
}

export const uploadDownloadTokenPayloadSchema = z.object({
  uploadId: z.string().min(1),
  workspaceId: z.string().min(1),
  expiresAt: z.string().datetime(),
})

export type UploadDownloadTokenPayload = z.infer<typeof uploadDownloadTokenPayloadSchema>

export function createUploadRecord(input: CreateUploadRecordInput, now = new Date()): UploadRecord {
  const checksumSuffix = input.checksum ? `_${input.checksum.slice(0, 12)}` : ''
  const id = `upl_${slug(input.workspaceId)}_${input.category}_${slug(input.filename)}${checksumSuffix}`

  return uploadRecordSchema.parse({
    ...input,
    id,
    sourceFileId: `src_${id}`,
    uploadedAt: now.toISOString(),
    status: 'needs_review',
  })
}

export function createUploadTaskComment(input: CreateUploadTaskCommentInput, now = new Date()): UploadTaskComment {
  const createdAt = now.toISOString()
  const fingerprint = createHash('sha256')
    .update(`${input.workspaceId}:${input.category}:${input.authorId}:${input.body}:${createdAt}`)
    .digest('hex')
    .slice(0, 12)

  return uploadTaskCommentSchema.parse({
    ...input,
    body: input.body.trim(),
    id: `utask_${slug(input.workspaceId)}_${input.category}_${slugTimestamp(createdAt)}_${fingerprint}`,
    createdAt,
  })
}

export function reviewUploadRecord(
  record: UploadRecord,
  review: {
    status: Exclude<UploadStatus, 'missing' | 'needs_review'>
    reviewedBy: string
    reviewNote?: string
  },
  now = new Date(),
): UploadRecord {
  return uploadRecordSchema.parse({
    ...record,
    status: review.status,
    reviewedBy: review.reviewedBy,
    reviewedAt: now.toISOString(),
    reviewNote: review.reviewNote,
  })
}

export function createUploadDownloadToken(
  input: {
    uploadId: string
    workspaceId: string
    expiresInSeconds: number
  },
  secret: string,
  now = new Date(),
): string {
  const payload = uploadDownloadTokenPayloadSchema.parse({
    uploadId: input.uploadId,
    workspaceId: input.workspaceId,
    expiresAt: new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
  })
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signDownloadPayload(encodedPayload, secret)

  return `${encodedPayload}.${signature}`
}

export function verifyUploadDownloadToken(token: string, secret: string, now = new Date()): UploadDownloadTokenPayload {
  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    throw new Error('Malformed download token')
  }

  const expectedSignature = signDownloadPayload(encodedPayload, secret)

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid download token signature')
  }

  const payload = uploadDownloadTokenPayloadSchema.parse(JSON.parse(base64UrlDecode(encodedPayload)))

  if (new Date(payload.expiresAt).getTime() < now.getTime()) {
    throw new Error('Download token has expired')
  }

  return payload
}

export function getUploadChecklist(
  records: UploadRecord[],
  categories: RequiredUploadCategory[] = REQUIRED_UPLOAD_CATEGORIES,
): UploadChecklistItem[] {
  return categories.map((definition) => {
    const categoryRecords = records.filter((record) => record.category === definition.category)
    const latestUpload = latest(categoryRecords)

    return {
      ...definition,
      files: categoryRecords.length,
      status: resolveChecklistStatus(categoryRecords),
      latestUpload,
      versions: uploadVersions(categoryRecords),
    }
  })
}

export function getWorkspaceUploadChecklist(
  records: UploadRecord[],
  workspaceId: string,
  categories: RequiredUploadCategory[] = REQUIRED_UPLOAD_CATEGORIES,
): UploadChecklistItem[] {
  return getUploadChecklist(
    records.filter((record) => record.workspaceId === workspaceId),
    categories,
  )
}

export function getWorkspaceRecurringUploadChecklist(
  records: UploadRecord[],
  workspace: UploadChecklistWorkspace,
  categories: RequiredUploadCategory[] = getWorkspaceRequiredUploadCategories(workspace),
): UploadChecklistItem[] {
  const currentPeriod = currentUploadPeriod(workspace)

  if (!currentPeriod) {
    return getWorkspaceUploadChecklist(records, workspace.id, categories)
  }

  const workspaceRecords = records.filter((record) => record.workspaceId === workspace.id)

  return categories.map((definition) => {
    const categoryRecords = workspaceRecords.filter((record) => record.category === definition.category)
    const currentRecords = categoryRecords.filter((record) => uploadBelongsToPeriod(record, currentPeriod, workspace))
    const rollsForward = rollForwardUploadCategories.has(definition.category)
    const rolledForwardRecords =
      rollsForward && currentRecords.length === 0
        ? categoryRecords.filter((record) => record.status === 'accepted' && uploadCanRollForward(record, currentPeriod, workspace))
        : []
    const checklistRecords = currentRecords.length > 0 ? currentRecords : rolledForwardRecords
    const periodScope = rolledForwardRecords.length > 0 ? 'rolled_forward' : 'current_period'

    return {
      ...definition,
      files: checklistRecords.length,
      status: resolveChecklistStatus(checklistRecords),
      latestUpload: latest(checklistRecords),
      versions: uploadVersions(checklistRecords),
      periodId: currentPeriod.id,
      periodLabel: currentPeriod.label,
      periodScope,
      rollsForward,
    }
  })
}

export function getWorkspaceRequiredUploadCategories(workspace: { requiredUploadCategories?: UploadCategory[] }): RequiredUploadCategory[] {
  return requiredUploadDefinitions(workspace.requiredUploadCategories ?? DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS)
}

export function uploadPeriodMetadata(workspace: UploadChecklistWorkspace): Record<string, string> {
  const period = currentUploadPeriod(workspace)

  if (!period) {
    return {}
  }

  return {
    monitoringPeriodId: period.id,
    periodLabel: period.label,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  }
}

export class JsonUploadStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<UploadRecord[]> {
    try {
      const raw = await readJsonFile(this.filePath, 'utf8')
      return z.array(uploadRecordSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<UploadRecord[]> {
    const records = await this.list()

    return records.filter((record) => record.workspaceId === workspaceId)
  }

  async save(record: UploadRecord): Promise<void> {
    const records = await this.list()
    const next = [...records.filter((existing) => existing.id !== record.id), record]

    await persistenceMkdir(dirname(this.filePath), { recursive: true })
    await writeJsonFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const records = await this.list()
    const next = records.filter((record) => record.workspaceId !== workspaceId)

    await persistenceMkdir(dirname(this.filePath), { recursive: true })
    await writeJsonFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return records.length - next.length
  }
}

export class JsonUploadTaskCommentStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<UploadTaskComment[]> {
    try {
      const raw = await readJsonFile(this.filePath, 'utf8')
      return sortCommentsOldestFirst(z.array(uploadTaskCommentSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<UploadTaskComment[]> {
    const comments = await this.list()

    return comments.filter((comment) => comment.workspaceId === workspaceId)
  }

  async listByCategory(workspaceId: string, category: UploadCategory): Promise<UploadTaskComment[]> {
    const comments = await this.listByWorkspace(workspaceId)

    return comments.filter((comment) => comment.category === category)
  }

  async save(comment: UploadTaskComment): Promise<void> {
    const comments = await this.list()
    const next = sortCommentsOldestFirst([...comments.filter((existing) => existing.id !== comment.id), comment])

    await persistenceMkdir(dirname(this.filePath), { recursive: true })
    await writeJsonFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const comments = await this.list()
    const next = comments.filter((comment) => comment.workspaceId !== workspaceId)

    await persistenceMkdir(dirname(this.filePath), { recursive: true })
    await writeJsonFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return comments.length - next.length
  }
}

export function buildStorageKey({
  workspaceId,
  category,
  filename,
  version,
}: {
  workspaceId: string
  category: UploadCategory
  filename: string
  version?: string
}): string {
  return join('workspaces', slug(workspaceId), category, safeFilename(filename, version))
}

export class LocalUploadStorage implements UploadStorage {
  constructor(private readonly rootDir: string) {}

  async save(input: LocalUploadInput): Promise<SavedLocalUpload> {
    const bytes = Buffer.from(input.bytes)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const storageKey = buildStorageKey({ ...input, version: checksum.slice(0, 12) })
    const targetPath = this.resolveStoragePath(storageKey)

    await fsMkdir(dirname(targetPath), { recursive: true })
    await fsWriteFile(targetPath, bytes)

    return {
      storageKey,
      byteSize: bytes.byteLength,
      checksum,
      contentType: input.contentType ?? inferContentType(input.filename),
    }
  }

  async readText(storageKey: string): Promise<string> {
    return fsReadFile(this.resolveStoragePath(storageKey), 'utf8')
  }

  async readBytes(storageKey: string): Promise<Buffer> {
    return fsReadFile(this.resolveStoragePath(storageKey))
  }

  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    await rm(this.resolveStoragePath(join('workspaces', slug(workspaceId))), { force: true, recursive: true })

    return true
  }

  private resolveStoragePath(storageKey: string): string {
    const root = resolve(this.rootDir)
    const target = resolve(root, storageKey)
    const pathFromRoot = relative(root, target)

    if (pathFromRoot.startsWith('..') || pathFromRoot === '' || pathFromRoot.includes(`..${sep}`)) {
      throw new Error('Storage key resolves outside upload root')
    }

    return target
  }
}

export class SupabaseUploadStorage implements UploadStorage {
  async save(input: LocalUploadInput): Promise<SavedLocalUpload> {
    const bytes = Buffer.from(input.bytes)
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const storageKey = buildStorageKey({ ...input, version: checksum.slice(0, 12) })
    const contentType = input.contentType ?? inferContentType(input.filename)

    await writeSupabaseUploadBytes({
      storageKey,
      bytes,
      contentType,
    })

    return {
      storageKey,
      byteSize: bytes.byteLength,
      checksum,
      contentType,
    }
  }

  async readText(storageKey: string): Promise<string> {
    return (await this.readBytes(storageKey)).toString('utf8')
  }

  async readBytes(storageKey: string): Promise<Buffer> {
    return readSupabaseUploadBytes(storageKey)
  }

  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    await deleteSupabaseUploadWorkspace(workspaceId)

    return true
  }
}

function latest(records: UploadRecord[]): UploadRecord | undefined {
  return records
    .slice()
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0]
}

const rollForwardUploadCategories = new Set<UploadCategory>(['contracts_order_forms', 'pricing_docs', 'account_mapping_csv'])

function currentUploadPeriod(workspace: UploadChecklistWorkspace): UploadChecklistPeriod | undefined {
  const periods = [...(workspace.monitoringPeriods ?? [])].sort((left, right) => left.periodStart.localeCompare(right.periodStart))
  const activePeriods = periods.filter((period) => period.status === 'active')

  return activePeriods[activePeriods.length - 1] ?? periods[periods.length - 1]
}

function uploadBelongsToPeriod(record: UploadRecord, period: UploadChecklistPeriod, workspace: UploadChecklistWorkspace): boolean {
  const periodId = metadataString(record.metadata, ['monitoringPeriodId', 'periodId'])

  if (periodId) {
    return periodId === period.id
  }

  const periodStart = metadataDate(record.metadata, ['periodStart', 'billingPeriodStart'])
  const periodEnd = metadataDate(record.metadata, ['periodEnd', 'billingPeriodEnd'])

  if (periodStart) {
    return periodsOverlap(periodStart, periodEnd ?? periodStart, period.periodStart, period.periodEnd)
  }

  return (workspace.monitoringPeriods ?? []).length <= 1
}

function uploadCanRollForward(record: UploadRecord, period: UploadChecklistPeriod, workspace: UploadChecklistWorkspace): boolean {
  if (uploadBelongsToPeriod(record, period, workspace)) {
    return false
  }

  const periodEnd = metadataDate(record.metadata, ['periodEnd', 'billingPeriodEnd'])

  return !periodEnd || periodEnd < period.periodStart
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key]

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

function metadataDate(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  const value = metadataString(metadata, keys)

  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined
}

function periodsOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return leftStart <= rightEnd && leftEnd >= rightStart
}

function uploadVersions(records: UploadRecord[]): UploadVersion[] {
  const chronological = records.slice().sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime())

  return chronological
    .map((record, index) => {
      const previous = chronological[index - 1]

      return {
        version: index + 1,
        uploadId: record.id,
        sourceFileId: record.sourceFileId,
        filename: record.filename,
        byteSize: record.byteSize,
        checksum: record.checksum,
        uploadedAt: record.uploadedAt,
        uploadedBy: record.uploadedBy,
        status: record.status,
        isLatest: index === chronological.length - 1,
        changedFromPrevious: previous ? uploadsDiffer(record, previous) : null,
        byteDeltaFromPrevious: previous ? record.byteSize - previous.byteSize : null,
        previousUploadId: previous?.id,
      }
    })
    .reverse()
}

function uploadsDiffer(record: UploadRecord, previous: UploadRecord): boolean {
  if (record.checksum && previous.checksum) {
    return record.checksum !== previous.checksum
  }

  return record.byteSize !== previous.byteSize || record.filename !== previous.filename
}

function requiredUploadDefinitions(categories: UploadCategory[]): RequiredUploadCategory[] {
  const definitionByCategory = new Map(REQUIRED_UPLOAD_CATEGORIES.map((definition) => [definition.category, definition]))

  return categories.flatMap((category) => {
    const definition = definitionByCategory.get(category)

    return definition ? [{ ...definition, required: true }] : []
  })
}

function resolveChecklistStatus(records: UploadRecord[]): UploadStatus {
  if (records.length === 0) {
    return 'missing'
  }

  if (records.some((record) => record.status === 'needs_review')) {
    return 'needs_review'
  }

  if (records.some((record) => record.status === 'needs_clarification')) {
    return 'needs_clarification'
  }

  if (records.some((record) => record.status === 'accepted')) {
    return 'accepted'
  }

  if (records.every((record) => record.status === 'duplicate')) {
    return 'duplicate'
  }

  return 'rejected'
}

function sortCommentsOldestFirst(comments: UploadTaskComment[]): UploadTaskComment[] {
  return [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function safeFilename(filename: string, version?: string): string {
  const name = basename(filename)
  const extension = extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  const safeStem = slug(stem) || 'file'
  const versionSuffix = version ? `_${slug(version)}` : ''
  const safeExtension = extension ? `.${slug(extension.slice(1))}` : ''

  return `${safeStem}${versionSuffix}${safeExtension}`
}

function inferContentType(filename: string): string {
  const extension = extname(filename).toLowerCase()

  if (extension === '.csv') return 'text/csv'
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.json') return 'application/json'
  if (extension === '.zip') return 'application/zip'

  return 'application/octet-stream'
}

function signDownloadPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)

  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false
  }

  return timingSafeEqual(leftBytes, rightBytes)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
