import { notFound } from 'next/navigation'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { IntakePageContent } from '../../../intake/intake-page-content'

export const dynamic = 'force-dynamic'

export default async function WorkspaceIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSession()
  const { workspaceId } = await params
  const workspace = listSessionWorkspaces(session, await getWorkspaceStore().list()).find((candidate) => candidate.id === workspaceId)

  if (!workspace) {
    notFound()
  }

  return IntakePageContent({
    scoped: true,
    searchParams: searchParams ? await searchParams : {},
    workspace,
  })
}
