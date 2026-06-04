'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { isCustomerVisibleFinding } from '@/lib/audit/evidence-pack'
import { createFindingComment } from '@/lib/audit/finding-comments'
import { assignFinding } from '@/lib/audit/finding-assignment'
import { applyFindingWorkflowStatus, findingWorkflowStatusSchema } from '@/lib/audit/finding-workflow'
import { findingAssignmentOwnerSchema } from '@/lib/audit/schemas'
import { getAuditLogStore, getFindingCommentStore, getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces, requireCurrentWorkspace, type AuditWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'
import { type Session } from '@/lib/auth/access'

const assignmentFormSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  findingId: z.string().trim().min(1),
  assignmentOwner: findingAssignmentOwnerSchema,
  assignmentNote: z.string().trim().optional(),
})

const commentFormSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  findingId: z.string().trim().min(1),
  body: z.string().trim().min(1),
})

const workflowStatusFormSchema = z.object({
  workspaceId: z.string().trim().min(1).optional(),
  findingId: z.string().trim().min(1),
  workflowStatus: findingWorkflowStatusSchema,
  workflowStatusNote: z.string().trim().optional(),
})

export async function updateFindingAssignmentAction(formData: FormData) {
  const session = await requireSession()
  const input = assignmentFormSchema.parse({
    workspaceId: optionalString(formData.get('workspaceId')),
    findingId: formData.get('findingId'),
    assignmentOwner: formData.get('assignmentOwner'),
    assignmentNote: optionalString(formData.get('assignmentNote')),
  })
  const workspace = await resolveAccessibleWorkspace(session, input.workspaceId)
  const findingStore = getFindingStore()
  const findings = await findingStore.listByWorkspace(workspace.id)
  const finding = findings.find((candidate) => candidate.id === input.findingId)

  if (!finding) {
    throw new Error(`Finding not found: ${input.findingId}`)
  }

  if (!isCustomerVisibleFinding(finding)) {
    throw new Error(`Finding is not assignable: ${input.findingId}`)
  }

  const previousOwner = finding.assignment?.owner ?? null
  const assignedFinding = assignFinding(finding, {
    owner: input.assignmentOwner,
    assignedBy: session.userId,
    note: input.assignmentNote,
  })

  await findingStore.saveMany([assignedFinding])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'finding_assigned',
      targetType: 'finding',
      targetId: finding.id,
      metadata: {
        owner: assignedFinding.assignment?.owner,
        previousOwner,
        hasNote: Boolean(assignedFinding.assignment?.note),
      },
    }),
  )

  revalidateFindingPaths(workspace.id, finding.id)
  redirect(`/workspaces/${encodeURIComponent(workspace.id)}/findings/${encodeURIComponent(finding.id)}`)
}

export async function addFindingCommentAction(formData: FormData) {
  const session = await requireSession()
  const input = commentFormSchema.parse({
    workspaceId: optionalString(formData.get('workspaceId')),
    findingId: formData.get('findingId'),
    body: formData.get('body'),
  })
  const workspace = await resolveAccessibleWorkspace(session, input.workspaceId)
  const findingStore = getFindingStore()
  const findings = await findingStore.listByWorkspace(workspace.id)
  const finding = findings.find((candidate) => candidate.id === input.findingId)

  if (!finding) {
    throw new Error(`Finding not found: ${input.findingId}`)
  }

  if (!isCustomerVisibleFinding(finding)) {
    throw new Error(`Finding is not commentable: ${input.findingId}`)
  }

  const comment = createFindingComment({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    findingId: finding.id,
    body: input.body,
    authorId: session.userId,
    authorName: session.name,
    authorRole: session.role,
  })

  await getFindingCommentStore().save(comment)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'finding_commented',
      targetType: 'finding',
      targetId: finding.id,
      metadata: {
        authorRole: session.role,
        bodyLength: comment.body.length,
      },
    }),
  )

  revalidateFindingPaths(workspace.id, finding.id)
  redirect(`/workspaces/${encodeURIComponent(workspace.id)}/findings/${encodeURIComponent(finding.id)}`)
}

export async function updateFindingWorkflowStatusAction(formData: FormData) {
  const session = await requireSession()
  const input = workflowStatusFormSchema.parse({
    workspaceId: optionalString(formData.get('workspaceId')),
    findingId: formData.get('findingId'),
    workflowStatus: formData.get('workflowStatus'),
    workflowStatusNote: optionalString(formData.get('workflowStatusNote')),
  })
  const workspace = await resolveAccessibleWorkspace(session, input.workspaceId)
  const findingStore = getFindingStore()
  const findings = await findingStore.listByWorkspace(workspace.id)
  const finding = findings.find((candidate) => candidate.id === input.findingId)

  if (!finding) {
    throw new Error(`Finding not found: ${input.findingId}`)
  }

  if (!isCustomerVisibleFinding(finding)) {
    throw new Error(`Finding is not ready for workflow tracking: ${input.findingId}`)
  }

  const updatedFinding = applyFindingWorkflowStatus(finding, {
    status: input.workflowStatus,
    actorId: session.userId,
    note: input.workflowStatusNote,
  })

  await findingStore.saveMany([updatedFinding])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'finding_issue_status_changed',
      targetType: 'finding',
      targetId: finding.id,
      metadata: {
        fromStatus: finding.status,
        status: updatedFinding.status,
        hasNote: Boolean(input.workflowStatusNote),
      },
    }),
  )

  revalidateFindingPaths(workspace.id, finding.id)
  const redirectPath = isCustomerVisibleFinding(updatedFinding)
    ? `/workspaces/${encodeURIComponent(workspace.id)}/findings/${encodeURIComponent(finding.id)}`
    : `/workspaces/${encodeURIComponent(workspace.id)}/findings`

  redirect(redirectPath)
}

async function resolveAccessibleWorkspace(session: Session, workspaceId: string | undefined): Promise<AuditWorkspace> {
  const workspaces = await getWorkspaceStore().list()

  if (!workspaceId) {
    return requireCurrentWorkspace(session, workspaces)
  }

  const workspace = listSessionWorkspaces(session, workspaces).find((candidate) => candidate.id === workspaceId)

  if (!workspace) {
    throw new Error(`Workspace access denied: ${workspaceId}`)
  }

  return workspace
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function revalidateFindingPaths(workspaceId: string, findingId: string) {
  revalidatePath('/findings')
  revalidatePath(`/findings/${findingId}`)
  revalidatePath('/status')
  revalidatePath(`/workspaces/${workspaceId}/findings`)
  revalidatePath(`/workspaces/${workspaceId}/findings/${findingId}`)
  revalidatePath(`/admin/workspaces/${workspaceId}/findings`)
}
