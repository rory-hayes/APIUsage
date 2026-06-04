import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { FindingsPageContent } from './findings-page-content'

export const dynamic = 'force-dynamic'

export default async function FindingsPage() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())

  return FindingsPageContent({
    canGenerateEvidencePack: session.role === 'internal_admin',
    workspace,
  })
}
