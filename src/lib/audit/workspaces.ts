import { dirname } from 'node:path'
import { z } from 'zod'

import { DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS, uploadCategorySchema, type UploadCategory } from './uploads'
import { type Session } from '../auth/access'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'

export const auditWorkspaceStatusSchema = z.enum(['intake', 'uploads', 'review', 'evidence_review', 'complete'])
export const auditWorkspacePeriodStatusSchema = z.enum(['planned', 'active', 'closed'])

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const auditWorkspacePeriodSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    status: auditWorkspacePeriodStatusSchema,
  })
  .refine((period) => period.periodStart <= period.periodEnd, {
    message: 'Period end must be on or after period start',
    path: ['periodEnd'],
  })

export const auditWorkspaceSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  name: z.string().min(1),
  auditPeriod: z.string().min(1),
  billingSystem: z.string().min(1),
  usageSource: z.string().min(1),
  currency: z.string().trim().min(3).max(3).transform((value) => value.toLowerCase()).default('eur'),
  requiredUploadCategories: z.array(uploadCategorySchema).min(1).default(DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS),
  monitoringPeriods: z.array(auditWorkspacePeriodSchema).default([]),
  status: auditWorkspaceStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
})

export type AuditWorkspace = z.infer<typeof auditWorkspaceSchema>
export type AuditWorkspacePeriod = z.infer<typeof auditWorkspacePeriodSchema>
export type AuditWorkspacePeriodStatus = z.infer<typeof auditWorkspacePeriodStatusSchema>

export type CreateAuditWorkspaceInput = {
  id?: string
  organizationId: string
  organizationName: string
  name: string
  auditPeriod: string
  billingSystem: string
  usageSource: string
  currency?: string
  requiredUploadCategories?: UploadCategory[]
  monitoringPeriods?: AuditWorkspacePeriod[]
  status?: z.infer<typeof auditWorkspaceStatusSchema>
  createdBy: string
}

export type CreateAuditWorkspacePeriodInput = {
  id?: string
  label: string
  periodStart?: string
  periodEnd?: string
  status?: AuditWorkspacePeriodStatus
}

const monthNames = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

export const defaultAuditWorkspace = createAuditWorkspace(
  {
    id: 'workspace_acme_may_2026',
    organizationId: 'org_acme',
    organizationName: 'Acme AI',
    name: 'May 2026 audit',
    auditPeriod: 'May 2026',
    billingSystem: 'Stripe',
    usageSource: 'Warehouse CSV',
    currency: 'eur',
    requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
    status: 'evidence_review',
    createdBy: 'internal_admin',
  },
  new Date('2026-06-01T09:00:00.000Z'),
)

export function createAuditWorkspace(input: CreateAuditWorkspaceInput, now = new Date()): AuditWorkspace {
  const auditPeriod = input.auditPeriod.trim()

  return auditWorkspaceSchema.parse({
    id: input.id ?? `workspace_${slug(input.organizationName)}_${slug(auditPeriod)}`,
    organizationId: input.organizationId.trim(),
    organizationName: input.organizationName.trim(),
    name: input.name.trim(),
    auditPeriod,
    billingSystem: input.billingSystem.trim(),
    usageSource: input.usageSource.trim(),
    currency: input.currency ?? 'eur',
    requiredUploadCategories: input.requiredUploadCategories ?? DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
    monitoringPeriods: input.monitoringPeriods ?? [createAuditWorkspacePeriod({ label: auditPeriod, status: 'active' })],
    status: input.status ?? 'intake',
    createdBy: input.createdBy,
    createdAt: now.toISOString(),
  })
}

export function createAuditWorkspacePeriod(input: CreateAuditWorkspacePeriodInput): AuditWorkspacePeriod {
  const label = input.label.trim()
  const range =
    input.periodStart && input.periodEnd
      ? {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        }
      : inferMonthlyDateRange(label)

  return auditWorkspacePeriodSchema.parse({
    id: input.id ?? `period_${slug(label)}`,
    label,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    status: input.status ?? 'planned',
  })
}

export function addMonitoringPeriodToWorkspace(
  workspace: AuditWorkspace,
  input: CreateAuditWorkspacePeriodInput,
): AuditWorkspace {
  const period = createAuditWorkspacePeriod(input)
  const existingIndex = workspace.monitoringPeriods.findIndex((candidate) => candidate.id === period.id)
  const monitoringPeriods =
    existingIndex >= 0
      ? workspace.monitoringPeriods.map((candidate) => (candidate.id === period.id ? period : candidate))
      : [...workspace.monitoringPeriods, period]

  return auditWorkspaceSchema.parse({
    ...workspace,
    monitoringPeriods: sortPeriods(monitoringPeriods),
  })
}

export function createAuditWorkspaceFromFormData(formData: FormData, createdBy: string, now = new Date()): AuditWorkspace {
  return createAuditWorkspace(
    {
      organizationId: requiredString(formData, 'organizationId'),
      organizationName: requiredString(formData, 'organizationName'),
      name: requiredString(formData, 'name'),
      auditPeriod: requiredString(formData, 'auditPeriod'),
      billingSystem: requiredString(formData, 'billingSystem'),
      usageSource: requiredString(formData, 'usageSource'),
      currency: optionalString(formData, 'currency') ?? 'eur',
      requiredUploadCategories: parseRequiredUploadCategories(formData),
      createdBy,
    },
    now,
  )
}

export function listSessionWorkspaces(session: Session, workspaces: AuditWorkspace[]): AuditWorkspace[] {
  if (session.role === 'internal_admin') {
    return workspaces
  }

  const allowedWorkspaceIds = new Set(session.workspaceIds)

  return workspaces.filter((workspace) => allowedWorkspaceIds.has(workspace.id))
}

export function resolveCurrentWorkspace(session: Session, workspaces: AuditWorkspace[]): AuditWorkspace | null {
  const accessibleWorkspaces = listSessionWorkspaces(session, workspaces)
  const accessibleById = new Map(accessibleWorkspaces.map((workspace) => [workspace.id, workspace]))
  const pinnedWorkspace = session.workspaceIds.map((workspaceId) => accessibleById.get(workspaceId)).find((workspace) => workspace !== undefined)

  return pinnedWorkspace ?? accessibleWorkspaces[0] ?? null
}

export function requireCurrentWorkspace(session: Session, workspaces: AuditWorkspace[]): AuditWorkspace {
  const workspace = resolveCurrentWorkspace(session, workspaces)

  if (!workspace) {
    throw new Error('Workspace access denied')
  }

  return workspace
}

export class JsonAuditWorkspaceStore {
  constructor(
    private readonly filePath: string,
    private readonly seeds: AuditWorkspace[] = [],
  ) {}

  async list(): Promise<AuditWorkspace[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortByNewest(z.array(auditWorkspaceSchema).parse(JSON.parse(raw)).map(ensureWorkspaceHasMonitoringPeriod))
    } catch (error) {
      if (isMissingFileError(error)) {
        return sortByNewest(this.seeds.map(ensureWorkspaceHasMonitoringPeriod))
      }

      throw error
    }
  }

  async listByOrganization(organizationId: string): Promise<AuditWorkspace[]> {
    const workspaces = await this.list()

    return workspaces.filter((workspace) => workspace.organizationId === organizationId)
  }

  async getById(workspaceId: string): Promise<AuditWorkspace | null> {
    const workspaces = await this.list()

    return workspaces.find((workspace) => workspace.id === workspaceId) ?? null
  }

  async save(workspace: AuditWorkspace): Promise<void> {
    const workspaces = await this.list()
    const nextById = new Map(workspaces.map((existing) => [existing.id, existing]))
    nextById.set(workspace.id, workspace)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortByNewest([...nextById.values()]), null, 2), 'utf8')
  }
}

function sortByNewest(workspaces: AuditWorkspace[]): AuditWorkspace[] {
  return [...workspaces].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function sortPeriods(periods: AuditWorkspacePeriod[]): AuditWorkspacePeriod[] {
  return [...periods].sort((a, b) => a.periodStart.localeCompare(b.periodStart))
}

function ensureWorkspaceHasMonitoringPeriod(workspace: AuditWorkspace): AuditWorkspace {
  if (workspace.monitoringPeriods.length > 0) {
    return workspace
  }

  return auditWorkspaceSchema.parse({
    ...workspace,
    monitoringPeriods: [createAuditWorkspacePeriod({ label: workspace.auditPeriod, status: 'active' })],
  })
}

function inferMonthlyDateRange(label: string): { periodStart: string; periodEnd: string } {
  const match = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i.exec(label)

  if (!match) {
    throw new Error(`Period dates are required for non-monthly period: ${label}`)
  }

  const monthIndex = monthNames.indexOf(match[1].toLowerCase())
  const year = Number.parseInt(match[2], 10)
  const periodStart = new Date(Date.UTC(year, monthIndex, 1))
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0))

  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  }
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key)

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required workspace field: ${key}`)
  }

  return value
}

function optionalString(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)

  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

function parseRequiredUploadCategories(formData: FormData): UploadCategory[] {
  const selected = formData.getAll('requiredUploadCategories').filter((value): value is string => typeof value === 'string')

  if (selected.length === 0) {
    return DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS
  }

  return z.array(uploadCategorySchema).min(1).parse(selected)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
