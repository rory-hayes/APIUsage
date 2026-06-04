import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { StatusPageContent } from './status-page-content'

export const dynamic = 'force-dynamic'

export default async function StatusPage() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())

  return StatusPageContent({ workspace })
}
