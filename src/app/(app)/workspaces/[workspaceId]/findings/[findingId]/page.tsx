import { notFound } from 'next/navigation'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { FindingDetailPageContent } from '../../../../findings/finding-detail-page-content'

export const dynamic = 'force-dynamic'

export default async function WorkspaceFindingDetailPage({
  params,
}: {
  params: Promise<{ findingId: string; workspaceId: string }>
}) {
  const session = await requireSession()
  const { findingId, workspaceId } = await params
  const workspace = listSessionWorkspaces(session, await getWorkspaceStore().list()).find((candidate) => candidate.id === workspaceId)

  if (!workspace) {
    notFound()
  }

  return FindingDetailPageContent({
    backHref: `/workspaces/${encodeURIComponent(workspace.id)}/findings`,
    findingId,
    workspace,
  })
}
