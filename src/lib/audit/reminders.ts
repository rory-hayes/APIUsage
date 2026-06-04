import { dirname } from 'node:path'
import { z } from 'zod'

import { type InviteRecord } from '../auth/invites'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import {
  getWorkspaceRecurringUploadChecklist,
  getWorkspaceRequiredUploadCategories,
  type UploadRecord,
} from './uploads'
import { type Finding } from './schemas'
import { type AuditWorkspace } from './workspaces'

export const reminderEmailTypeSchema = z.enum(['missing_uploads', 'readout', 'high_severity_findings', 'failed_sync'])
export const reminderEmailStatusSchema = z.enum(['sent'])

export const reminderEmailSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  type: reminderEmailTypeSchema,
  recipientEmail: z.string().email(),
  recipientName: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  sentBy: z.string().min(1),
  sentAt: z.string().datetime(),
  status: reminderEmailStatusSchema.default('sent'),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type ReminderEmail = z.infer<typeof reminderEmailSchema>
export type ReminderEmailType = z.infer<typeof reminderEmailTypeSchema>
export type AlertRecipient = {
  email: string
  name: string
}

export function buildMissingUploadReminderEmails({
  workspace,
  uploads,
  invites,
  sentBy,
  now = new Date(),
}: {
  workspace: AuditWorkspace
  uploads: UploadRecord[]
  invites: InviteRecord[]
  sentBy: string
  now?: Date
}): ReminderEmail[] {
  const missingItems = getMissingUploadReminderItems(workspace, uploads)
  const sentAt = now.toISOString()

  if (missingItems.length === 0) {
    return []
  }

  return activeWorkspaceInvites(invites, workspace.id).map((invite) =>
    reminderEmailSchema.parse({
      id: reminderId(workspace.id, 'missing_uploads', invite.id, sentAt),
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      type: 'missing_uploads',
      recipientEmail: invite.email,
      recipientName: invite.name,
      subject: `${workspace.organizationName} ${workspace.auditPeriod} audit: ${missingItems.length} upload${missingItems.length === 1 ? '' : 's'} still needed`,
      body: [
        `Hi ${invite.name},`,
        '',
        `We still need the following source file${missingItems.length === 1 ? '' : 's'} for ${workspace.organizationName} - ${workspace.auditPeriod}:`,
        ...missingItems.map((item) => `- ${item.label}`),
        '',
        'Please upload them in the workspace so we can keep the audit moving.',
      ].join('\n'),
      sentBy,
      sentAt,
      status: 'sent',
      metadata: {
        missingUploadCategories: missingItems.map((item) => item.category),
        missingUploadLabels: missingItems.map((item) => item.label),
      },
    }),
  )
}

export function buildReadoutReminderEmails({
  workspace,
  invites,
  readoutDate,
  sentBy,
  now = new Date(),
}: {
  workspace: AuditWorkspace
  invites: InviteRecord[]
  readoutDate: string
  sentBy: string
  now?: Date
}): ReminderEmail[] {
  const sentAt = now.toISOString()
  const formattedReadoutDate = formatDate(readoutDate)

  return activeWorkspaceInvites(invites, workspace.id).map((invite) =>
    reminderEmailSchema.parse({
      id: reminderId(workspace.id, 'readout', invite.id, sentAt),
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      type: 'readout',
      recipientEmail: invite.email,
      recipientName: invite.name,
      subject: `${workspace.organizationName} ${workspace.auditPeriod} audit: readout on ${formattedReadoutDate}`,
      body: [
        `Hi ${invite.name},`,
        '',
        `Reminder: the ${workspace.organizationName} ${workspace.auditPeriod} audit readout is scheduled for ${formattedReadoutDate}.`,
        'We will review the key findings, money at risk, and recommended next actions.',
      ].join('\n'),
      sentBy,
      sentAt,
      status: 'sent',
      metadata: {
        readoutDate,
      },
    }),
  )
}

export function buildHighSeverityFindingAlertEmails({
  workspace,
  findings,
  invites,
  internalRecipients,
  sentBy,
  now = new Date(),
}: {
  workspace: AuditWorkspace
  findings: Finding[]
  invites: InviteRecord[]
  internalRecipients: AlertRecipient[]
  sentBy: string
  now?: Date
}): ReminderEmail[] {
  const highSeverityFindings = findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
  const sentAt = now.toISOString()

  if (highSeverityFindings.length === 0) {
    return []
  }

  const totalVarianceAmount = highSeverityFindings.reduce((total, finding) => total + finding.varianceAmount, 0)
  const metadata = {
    findingIds: highSeverityFindings.map((finding) => finding.id),
    highSeverityCount: highSeverityFindings.length,
    totalVarianceAmount,
  }

  return alertRecipients(invites, workspace.id, internalRecipients).map((recipient) =>
    reminderEmailSchema.parse({
      id: reminderId(workspace.id, 'high_severity_findings', recipient.id, sentAt),
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      type: 'high_severity_findings',
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: `${workspace.organizationName} ${workspace.auditPeriod} audit: ${highSeverityFindings.length} high-severity finding${
        highSeverityFindings.length === 1 ? '' : 's'
      } need${highSeverityFindings.length === 1 ? 's' : ''} review`,
      body: [
        `Hi ${recipient.name},`,
        '',
        `${workspace.organizationName} has ${highSeverityFindings.length} high-severity finding${
          highSeverityFindings.length === 1 ? '' : 's'
        } from the latest reconciliation run:`,
        ...highSeverityFindings.map((finding) => `- ${finding.title} (${finding.severity}, ${formatCurrency(finding.varianceAmount, finding.currency)})`),
        '',
        'Please review these before close.',
      ].join('\n'),
      sentBy,
      sentAt,
      status: 'sent',
      metadata,
    }),
  )
}

export function buildFailedSyncAlertEmails({
  workspace,
  connectorLabel,
  provider,
  status,
  errorSummary,
  invites,
  internalRecipients,
  sentBy,
  now = new Date(),
}: {
  workspace: AuditWorkspace
  connectorLabel: string
  provider: string
  status: string
  errorSummary: string
  invites: InviteRecord[]
  internalRecipients: AlertRecipient[]
  sentBy: string
  now?: Date
}): ReminderEmail[] {
  const sentAt = now.toISOString()
  const providerLabel = formatProvider(provider)

  return alertRecipients(invites, workspace.id, internalRecipients).map((recipient) =>
    reminderEmailSchema.parse({
      id: reminderId(workspace.id, 'failed_sync', recipient.id, sentAt),
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      type: 'failed_sync',
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: `${workspace.organizationName} ${workspace.auditPeriod} audit: ${providerLabel} sync needs attention`,
      body: [
        `Hi ${recipient.name},`,
        '',
        `${connectorLabel} reported a ${status.replaceAll('_', ' ')} sync for ${workspace.organizationName} - ${workspace.auditPeriod}.`,
        errorSummary,
        '',
        'Please refresh credentials or rerun the connector sync before close.',
      ].join('\n'),
      sentBy,
      sentAt,
      status: 'sent',
      metadata: {
        provider,
        connectorLabel,
        status,
        errorSummary,
      },
    }),
  )
}

export function getMissingUploadReminderItems(workspace: AuditWorkspace, uploads: UploadRecord[]) {
  return getWorkspaceRecurringUploadChecklist(uploads, workspace, getWorkspaceRequiredUploadCategories(workspace))
    .filter((item) => item.required && item.status !== 'accepted')
    .map((item) => ({
      category: item.category,
      label: item.label,
      status: item.status,
    }))
}

export class JsonReminderEmailStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ReminderEmail[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortReminders(z.array(reminderEmailSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<ReminderEmail[]> {
    const reminders = await this.list()

    return reminders.filter((reminder) => reminder.workspaceId === workspaceId)
  }

  async saveMany(reminders: ReminderEmail[]): Promise<void> {
    const existing = await this.list()
    const nextById = new Map(existing.map((reminder) => [reminder.id, reminder]))

    for (const reminder of reminders) {
      nextById.set(reminder.id, reminder)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortReminders([...nextById.values()]), null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const reminders = await this.list()
    const next = reminders.filter((reminder) => reminder.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return reminders.length - next.length
  }
}

function activeWorkspaceInvites(invites: InviteRecord[], workspaceId: string): InviteRecord[] {
  return invites.filter((invite) => invite.status === 'active' && invite.workspaceIds.includes(workspaceId))
}

function alertRecipients(invites: InviteRecord[], workspaceId: string, internalRecipients: AlertRecipient[]) {
  const recipients = [
    ...activeWorkspaceInvites(invites, workspaceId).map((invite) => ({
      id: invite.id,
      email: invite.email,
      name: invite.name,
    })),
    ...internalRecipients.map((recipient) => ({
      id: `recipient_${slug(recipient.email)}`,
      email: recipient.email.trim().toLowerCase(),
      name: recipient.name.trim(),
    })),
  ]
  const seenEmails = new Set<string>()

  return recipients.filter((recipient) => {
    if (seenEmails.has(recipient.email)) {
      return false
    }

    seenEmails.add(recipient.email)
    return true
  })
}

function reminderId(workspaceId: string, type: ReminderEmailType, inviteId: string, sentAt: string): string {
  return `reminder_${slug(workspaceId)}_${type}_${slug(inviteId)}_${sentAt.replace(/[-:.]/g, '_')}`
}

function sortReminders(reminders: ReminderEmail[]): ReminderEmail[] {
  return [...reminders].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function formatProvider(provider: string): string {
  return provider
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace('Csv', 'CSV')
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', {
    currency: currency.toUpperCase(),
    style: 'currency',
  }).format(amount / 100)
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
