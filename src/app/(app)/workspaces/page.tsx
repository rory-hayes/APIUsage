import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

export default async function WorkspacesPage() {
  const session = await requireSession()
  const workspaces = listSessionWorkspaces(session, await getWorkspaceStore().list())

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Workspaces</Heading>
          <Text className="mt-2">Invite-only audit workspaces available to your account.</Text>
        </div>
        <Badge color="blue">{workspaces.length} accessible</Badge>
      </div>

      {workspaces.length === 0 ? (
        <Text className="mt-8">No audit workspaces are available for this account.</Text>
      ) : (
        <Table className="mt-8 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Workspace</TableHeader>
              <TableHeader>Customer</TableHeader>
              <TableHeader>Data sources</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="text-right">Action</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {workspaces.map((workspace) => (
              <TableRow key={workspace.id} href={workspaceSelectHref(workspace.id)} title={workspace.name}>
                <TableCell>
                  <div className="font-medium">{workspace.name}</div>
                  <div className="text-zinc-500">{workspace.id}</div>
                </TableCell>
                <TableCell>
                  <div>{workspace.organizationName}</div>
                  <div className="text-zinc-500">{workspace.auditPeriod}</div>
                </TableCell>
                <TableCell>
                  <div>{workspace.billingSystem}</div>
                  <div className="text-zinc-500">{workspace.usageSource}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(workspace.status)}>{workspace.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button href={workspaceSelectHref(workspace.id)} outline>
                    Open workspace
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function workspaceSelectHref(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/select?next=${encodeURIComponent(`/workspaces/${workspaceId}`)}`
}
