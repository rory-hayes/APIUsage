import { z } from 'zod'

import { findingSchema, type Finding } from './schemas'

export const findingWorkflowStatusSchema = z.enum(['open', 'investigating', 'accepted', 'fixed', 'ignored', 'closed'])
export const findingIssueStatusSchema = z.enum([...findingWorkflowStatusSchema.options, 'monitoring'])

export type FindingWorkflowStatus = z.infer<typeof findingWorkflowStatusSchema>
export type FindingIssueStatus = z.infer<typeof findingIssueStatusSchema>

export const findingWorkflowStatusOptions: Array<{ value: FindingWorkflowStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'closed', label: 'Closed' },
]

const issueTrackableStatuses = [
  'approved_internal',
  'published',
  'customer_reviewing',
  'open',
  'investigating',
  'accepted',
  'fixed',
  'ignored',
  'monitoring',
  'closed',
] as const satisfies readonly Finding['status'][]

export function applyFindingWorkflowStatus(
  finding: Finding,
  input: {
    status: FindingIssueStatus
    actorId: string
    note?: string
    noteField?: 'internalNote'
  },
  now = new Date(),
): Finding {
  const changedAt = now.toISOString()

  return findingSchema.parse({
    ...finding,
    status: input.status,
    reviewerId: input.actorId,
    internalNote: input.note && input.noteField === 'internalNote' ? appendActionNote(finding.internalNote, input.note) : finding.internalNote,
    metadata: {
      ...finding.metadata,
      issueStatusChangedAt: changedAt,
      issueStatusChangedBy: input.actorId,
      issueStatusHistory: [
        ...readIssueStatusHistory(finding.metadata.issueStatusHistory),
        {
          fromStatus: finding.status,
          toStatus: input.status,
          note: input.note,
          actorId: input.actorId,
          changedAt,
        },
      ],
    },
  })
}

export function isFindingIssueTrackable(finding: Finding): boolean {
  return (issueTrackableStatuses as readonly string[]).includes(finding.status)
}

function appendActionNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note
}

function readIssueStatusHistory(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []
}
