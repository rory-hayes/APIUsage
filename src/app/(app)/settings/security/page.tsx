import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { isInternalAdmin } from '@/lib/auth/access'
import { requireSession } from '@/lib/auth/server'

const controls = [
  { name: 'Tenant isolation', phase: 'V0', status: 'active' },
  { name: 'Private file storage', phase: 'V0', status: 'active' },
  { name: 'Signed download URLs', phase: 'V0', status: 'active' },
  { name: 'Audit log', phase: 'V0', status: 'active' },
  { name: 'Workspace data deletion', phase: 'V0', status: 'active' },
  { name: 'NDA/DPA placeholders', phase: 'V0', status: 'active' },
  { name: 'DPA and subprocessor list', phase: 'V1', status: 'planned' },
]

const legalDocuments = [
  {
    name: 'NDA template',
    href: '/security/nda-template.md',
    status: 'manual review',
    description: 'Starting point for customer data access discussions before files are uploaded.',
  },
  {
    name: 'DPA placeholder',
    href: '/security/data-processing-addendum-placeholder.md',
    status: 'manual review',
    description: 'Lightweight processing terms placeholder for counsel review before customer use.',
  },
  {
    name: 'Security overview',
    href: '/security/security-overview.md',
    status: 'manual review',
    description: 'Plain-language summary of V0 access, upload, audit log, and deletion controls.',
  },
  {
    name: 'Subprocessor placeholder',
    href: '/security/subprocessor-list-placeholder.md',
    status: 'manual review',
    description: 'Working list of expected subprocessors until the production stack is final.',
  },
]

export default async function SecurityPage({ searchParams }: { searchParams?: Promise<{ deleted?: string }> }) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const params = await searchParams
  const canDeleteWorkspace = isInternalAdmin(session)
  const deletionCompleted = params?.deleted === '1'

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Security</Heading>
          <Text className="mt-2">Controls needed before customers send billing, usage, cost, and contract data.</Text>
        </div>
        <Badge color="green">V0 baseline</Badge>
      </div>

      {deletionCompleted ? (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm/6 font-medium text-green-800">
          Workspace data deletion completed. A minimal deletion audit event has been retained.
        </div>
      ) : null}

      <Subheading className="mt-10">Control checklist</Subheading>
      <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>Control</TableHeader>
            <TableHeader>Phase</TableHeader>
            <TableHeader>Status</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {controls.map((control) => (
            <TableRow key={control.name}>
              <TableCell className="font-medium">{control.name}</TableCell>
              <TableCell>{control.phase}</TableCell>
              <TableCell>
                <Badge color={control.status === 'active' ? 'green' : 'amber'}>{control.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <section className="mt-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Subheading>Legal and trust documents</Subheading>
            <Text className="mt-2 max-w-3xl">
              V0 placeholders are tracked here so customer document requests do not live in ad hoc folders. Manual review
              before sending to customers is still required.
            </Text>
          </div>
          <Badge color="amber">Manual review before sending to customers</Badge>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-950/10 bg-white shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <Table className="[--gutter:--spacing(6)] lg:[--gutter:--spacing(8)]">
            <TableHead>
              <TableRow>
                <TableHeader>Document</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Purpose</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {legalDocuments.map((document) => (
                <TableRow key={document.name}>
                  <TableCell className="font-medium">
                    <a href={document.href} className="text-blue-600 hover:text-blue-500">
                      {document.name}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge color="amber">{document.status}</Badge>
                  </TableCell>
                  <TableCell>{document.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="mt-12 rounded-lg border border-red-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Subheading>Workspace data deletion</Subheading>
            <Text className="mt-2 max-w-3xl">
              Current target: {workspace.organizationName} - {workspace.auditPeriod}. Deletes raw uploads, upload
              metadata, parse jobs, parsed records, findings, and prior workspace audit events. A minimal deletion event is
              retained for internal accountability.
            </Text>
          </div>
          {canDeleteWorkspace ? (
            <form action={`/api/workspaces/${encodeURIComponent(workspace.id)}/delete`} method="POST">
              <Button type="submit" color="red">
                Delete workspace data
              </Button>
            </form>
          ) : (
            <Badge color="zinc">Internal admin only</Badge>
          )}
        </div>
      </section>
    </>
  )
}
