import { notFound } from 'next/navigation'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { FindingsPageContent } from '../../../findings/findings-page-content'

export const dynamic = 'force-dynamic'

export default async function WorkspaceFindingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireSession()
  const { workspaceId } = await params
  const workspace = listSessionWorkspaces(session, await getWorkspaceStore().list()).find((candidate) => candidate.id === workspaceId)

  if (!workspace) {
    notFound()
  }

  return FindingsPageContent({
    canGenerateEvidencePack: session.role === 'internal_admin',
    scoped: true,
    workspace,
  })
}
