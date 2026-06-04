'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { createIntakeResponse, extractIntakeAnswersFromFormData } from '@/lib/audit/intake'
import { getAuditLogStore, getIntakeStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces, requireCurrentWorkspace, type AuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'
import { requireSession } from '@/lib/auth/server'

export async function saveIntakeAction(formData: FormData) {
  const session = await requireSession()
  const { scoped, workspace } = await resolveCustomerIntakeWorkspaceFromForm(session, formData)

  const response = createIntakeResponse({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    answers: extractIntakeAnswersFromFormData(formData),
    updatedBy: session.userId,
  })

  await getIntakeStore().save(response)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'intake_saved',
      targetType: 'intake',
      targetId: response.id,
      metadata: {
        status: response.status,
        percentComplete: response.completeness.percentComplete,
        answeredRequired: response.completeness.answeredRequired,
      },
    }),
  )

  revalidateIntakeRoutes(workspace.id)
  redirect(intakeRedirectPath(workspace, scoped))
}

async function resolveCustomerIntakeWorkspaceFromForm(session: Session, formData: FormData): Promise<{ scoped: boolean; workspace: AuditWorkspace }> {
  const requestedWorkspaceId = emptyToUndefined(formData.get('workspaceId'))
  const workspaces = await getWorkspaceStore().list()

  if (!requestedWorkspaceId) {
    return {
      scoped: false,
      workspace: requireCurrentWorkspace(session, workspaces),
    }
  }

  const workspace = listSessionWorkspaces(session, workspaces).find((candidate) => candidate.id === requestedWorkspaceId)

  if (!workspace) {
    throw new Error('Workspace access denied')
  }

  return { scoped: true, workspace }
}

function intakeRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/workspaces/${encodeURIComponent(workspace.id)}/intake?saved=1` : '/intake?saved=1'
}

function revalidateIntakeRoutes(workspaceId: string) {
  revalidatePath('/intake')
  revalidatePath('/status')
  revalidatePath('/admin')
  revalidatePath('/evidence-pack')
  revalidatePath(`/workspaces/${workspaceId}/intake`)
  revalidatePath(`/workspaces/${workspaceId}/status`)
  revalidatePath(`/workspaces/${workspaceId}/evidence-pack`)
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}
