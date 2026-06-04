import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'

export const auditActionSchema = z.enum([
  'file_uploaded',
  'file_reviewed',
  'file_downloaded',
  'intake_saved',
  'contract_terms_extracted',
  'contract_term_reviewed',
  'account_mapping_saved',
  'parse_run',
  'check_run',
  'finding_reviewed',
  'finding_published',
  'finding_issue_status_changed',
  'finding_assigned',
  'finding_commented',
  'evidence_pack_generated',
  'evidence_pack_downloaded',
  'report_builder_saved',
  'findings_csv_downloaded',
  'user_login',
  'workspace_created',
  'workspace_period_added',
  'invite_created',
  'upload_task_commented',
  'data_dictionary_entry_saved',
  'workspace_data_deleted',
  'pilot_conversion_saved',
  'app_billing_saved',
  'reminder_email_sent',
  'stripe_connection_saved',
  'stripe_sync_run',
  'warehouse_connection_saved',
  'warehouse_sync_run',
  'reconciliation_schedule_saved',
  'scheduled_reconciliation_run',
  'pricing_rule_saved',
  'pricing_rule_approval_changed',
])

export const auditTargetTypeSchema = z.enum([
  'upload',
  'parse_job',
  'workspace',
  'finding',
  'findings_export',
  'evidence_pack',
  'intake',
  'contract_term',
  'account_mapping',
  'upload_task',
  'data_dictionary_entry',
  'customer',
  'reminder_email',
  'connector',
  'reconciliation_schedule',
  'pricing_rule',
])

export const auditLogEventSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  actorId: z.string().min(1),
  action: auditActionSchema,
  targetType: auditTargetTypeSchema,
  targetId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
})

export type AuditLogEvent = z.infer<typeof auditLogEventSchema>

export type AuditLogEventInput = Omit<AuditLogEvent, 'id' | 'createdAt' | 'metadata'> & {
  metadata?: Record<string, unknown>
}

export function createAuditLogEvent(input: AuditLogEventInput, now = new Date()): AuditLogEvent {
  const createdAt = now.toISOString()

  return auditLogEventSchema.parse({
    ...input,
    id: `audit_${input.workspaceId}_${input.action}_${input.targetType}_${input.targetId}_${slugTimestamp(createdAt)}`,
    metadata: input.metadata ?? {},
    createdAt,
  })
}

export class JsonAuditLogStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AuditLogEvent[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(auditLogEventSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<AuditLogEvent[]> {
    const events = await this.list()

    return events
      .filter((event) => event.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async append(event: AuditLogEvent): Promise<void> {
    const events = await this.list()
    const next = [...events, uniqueEventForAppend(event, events)]

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const events = await this.list()
    const next = events.filter((event) => event.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return events.length - next.length
  }
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function uniqueEventForAppend(event: AuditLogEvent, existingEvents: AuditLogEvent[]): AuditLogEvent {
  const existingIds = new Set(existingEvents.map((existing) => existing.id))

  if (!existingIds.has(event.id)) {
    return event
  }

  return auditLogEventSchema.parse({
    ...event,
    id: nextEventId(event.id, existingIds),
  })
}

function nextEventId(id: string, existingIds: Set<string>): string {
  let suffix = 2
  let candidate = `${id}_${suffix}`

  while (existingIds.has(candidate)) {
    suffix += 1
    candidate = `${id}_${suffix}`
  }

  return candidate
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
