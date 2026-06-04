import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { FindingDetailPageContent } from '../finding-detail-page-content'

export const dynamic = 'force-dynamic'

export default async function FindingDetailPage({ params }: { params: Promise<{ findingId: string }> }) {
  const { findingId } = await params
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())

  return FindingDetailPageContent({
    backHref: '/findings',
    findingId,
    workspace,
  })
}
