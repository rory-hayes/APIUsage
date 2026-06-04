import { requireSession } from '@/lib/auth/server'
import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces, resolveCurrentWorkspace } from '@/lib/audit/workspaces'
import { ApplicationLayout } from './application-layout'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  const allWorkspaces = await getWorkspaceStore().list()
  const accessibleWorkspaces = listSessionWorkspaces(session, allWorkspaces)
  const currentWorkspace = resolveCurrentWorkspace(session, allWorkspaces)

  return (
    <ApplicationLayout session={session} workspaces={accessibleWorkspaces} currentWorkspace={currentWorkspace}>
      {children}
    </ApplicationLayout>
  )
}
