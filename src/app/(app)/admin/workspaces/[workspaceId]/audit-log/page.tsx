import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { type AuditLogEvent } from '@/lib/audit/audit-log'
import { getAuditLogStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

export default async function AuditLogPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }

  const events = await getAuditLogStore().listByWorkspace(workspace.id)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Audit log</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Operator-visible event trail for workspace activity.
          </Text>
        </div>
        <div className="flex flex-wrap gap-3">
          <Badge color="blue">{events.length} events</Badge>
          <Button href="/admin/workspaces" outline>
            Back to workspaces
          </Button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="mt-8 rounded-lg border border-zinc-950/10 bg-white p-6 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <Text>No audit events have been recorded for this workspace yet.</Text>
        </div>
      ) : (
        <Table className="mt-8 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Time</TableHeader>
              <TableHeader>Action</TableHeader>
              <TableHeader>Actor</TableHeader>
              <TableHeader>Target</TableHeader>
              <TableHeader>Metadata</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatTimestamp(event.createdAt)}</TableCell>
                <TableCell className="font-medium">{formatAction(event.action)}</TableCell>
                <TableCell>{event.actorId}</TableCell>
                <TableCell>
                  <div>{event.targetType.replaceAll('_', ' ')}</div>
                  <div className="text-zinc-500">{event.targetId}</div>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal text-zinc-600">{formatMetadata(event.metadata)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatAction(action: AuditLogEvent['action']): string {
  const label = action.replaceAll('_', ' ')

  return label[0].toUpperCase() + label.slice(1)
}

function formatMetadata(metadata: AuditLogEvent['metadata']): string {
  const entries = Object.entries(metadata)

  if (entries.length === 0) {
    return 'None'
  }

  return entries.map(([key, value]) => `${key}: ${formatMetadataValue(value)}`).join(', ')
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  return JSON.stringify(value)
}
