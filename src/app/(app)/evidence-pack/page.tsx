import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { EvidencePackPageContent } from './evidence-pack-page-content'

export const dynamic = 'force-dynamic'

export default async function EvidencePackPage() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())

  return EvidencePackPageContent({ workspace })
}
