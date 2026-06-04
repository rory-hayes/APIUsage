import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { IntakePageContent } from './intake-page-content'

export const dynamic = 'force-dynamic'

export default async function IntakePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const params = searchParams ? await searchParams : {}

  return IntakePageContent({ searchParams: params, workspace })
}
