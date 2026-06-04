import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/description-list'
import { Field, FieldGroup, Fieldset, Label } from '@/components/fieldset'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getMissingUploadReminderItems, type ReminderEmailType } from '@/lib/audit/reminders'
import { getInviteStore, getReminderEmailStore, getUploadStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'
import { requireInternalAdmin } from '@/lib/auth/server'
import { addMonitoringPeriodAction, sendMissingUploadReminderAction, sendReadoutReminderAction } from '../../actions'

export const dynamic = 'force-dynamic'

const adminWorkflowLinks = [
  {
    label: 'Review uploads',
    detail: 'Inspect customer files, run parsers, and review upload decisions for this workspace.',
    next: '/uploads',
  },
  {
    label: 'Resolve mappings',
    detail: 'Review suggested account mappings and apply manual overrides where needed.',
    next: '/mappings',
  },
  {
    label: 'Approve contract terms',
    detail: 'Validate extracted contract terms, versions, and evidence before reconciliation.',
    next: '/contract-terms',
  },
  {
    label: 'Document field meanings',
    detail: 'Capture customer-specific source field definitions, examples, and normalized mappings for parser review.',
    next: '/data-dictionary',
  },
  {
    label: 'Inspect runs',
    detail: 'Open the workspace status surface for intake, parser, reconciliation, and evidence readiness.',
    next: '/runs',
  },
  {
    label: 'Review findings',
    detail: 'Triage draft findings, request customer input, merge duplicates, and approve customer-visible issues.',
    next: '/findings',
  },
  {
    label: 'Build report',
    detail: 'Pin this workspace before assembling the operator-reviewed report and evidence narrative.',
    next: '/report-builder',
  },
  {
    label: 'Audit log',
    detail: 'Read the immutable operator-visible trail for workspace actions and review decisions.',
    next: '/audit-log',
  },
]

export default async function AdminWorkspaceDetailPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const [invites, uploads, reminders] = await Promise.all([
    getInviteStore().listByWorkspace(workspace.id),
    getUploadStore().listByWorkspace(workspace.id),
    getReminderEmailStore().listByWorkspace(workspace.id),
  ])
  const activeInviteCount = invites.filter((invite) => invite.status === 'active').length
  const missingUploadItems = getMissingUploadReminderItems(workspace, uploads)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href="/admin/workspaces" plain>
            Back to workspaces
          </Button>
          <Heading className="mt-6">Admin workspace</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Internal operator hub for review, reconciliation,
            findings, reporting, and audit trail work.
          </Text>
        </div>
        <Badge color={statusColor(workspace.status)}>{workspace.status.replaceAll('_', ' ')}</Badge>
      </div>

      <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.55fr)]">
        <div>
          <Subheading>Operator workflow</Subheading>
          <div className="mt-4 grid gap-4">
            {adminWorkflowLinks.map((link) => (
              <div key={link.next} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-950 dark:text-white">{link.label}</div>
                    <Text className="mt-2">{link.detail}</Text>
                  </div>
                  <Button href={adminWorkspaceRouteHref(workspace.id, link.next)} outline>
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside>
          <Subheading>Workspace details</Subheading>
          <DescriptionList className="mt-4">
            <DescriptionTerm>Customer</DescriptionTerm>
            <DescriptionDetails>{workspace.organizationName}</DescriptionDetails>
            <DescriptionTerm>Workspace</DescriptionTerm>
            <DescriptionDetails>{workspace.name}</DescriptionDetails>
            <DescriptionTerm>Audit period</DescriptionTerm>
            <DescriptionDetails>{workspace.auditPeriod}</DescriptionDetails>
            <DescriptionTerm>Billing system</DescriptionTerm>
            <DescriptionDetails>{workspace.billingSystem}</DescriptionDetails>
            <DescriptionTerm>Usage source</DescriptionTerm>
            <DescriptionDetails>{workspace.usageSource}</DescriptionDetails>
            <DescriptionTerm>Workspace ID</DescriptionTerm>
            <DescriptionDetails>{workspace.id}</DescriptionDetails>
          </DescriptionList>

          <div className="mt-8">
            <Subheading>Monitoring periods</Subheading>
            <Table className="mt-4 [--gutter:--spacing(4)]">
              <TableHead>
                <TableRow>
                  <TableHeader>Period</TableHeader>
                  <TableHeader>Dates</TableHeader>
                  <TableHeader>Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {workspace.monitoringPeriods.map((period) => (
                  <TableRow key={period.id}>
                    <TableCell>
                      <div className="font-medium">{period.label}</div>
                      <div className="text-zinc-500">{period.id}</div>
                    </TableCell>
                    <TableCell>
                      {period.periodStart} - {period.periodEnd}
                    </TableCell>
                    <TableCell>
                      <Badge color={periodStatusColor(period.status)}>{period.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <form action={addMonitoringPeriodAction} className="mt-6 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <Fieldset>
                <Subheading>Add period</Subheading>
                <Input name="workspaceId" type="hidden" value={workspace.id} />
                <FieldGroup className="mt-5">
                  <Field>
                    <Label>Period label</Label>
                    <Input name="label" placeholder="June 2026" required />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <Label>Start</Label>
                      <Input name="periodStart" type="date" required />
                    </Field>
                    <Field>
                      <Label>End</Label>
                      <Input name="periodEnd" type="date" required />
                    </Field>
                  </div>
                  <Field>
                    <Label>Status</Label>
                    <Select name="status" defaultValue="planned" required>
                      <option value="planned">Planned</option>
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                    </Select>
                  </Field>
                </FieldGroup>
                <div className="mt-5">
                  <Button type="submit">Add period</Button>
                </div>
              </Fieldset>
            </form>
          </div>

          <div className="mt-8">
            <Subheading>Reminder emails</Subheading>
            <Text className="mt-2">
              Send reminders to {activeInviteCount} active customer {activeInviteCount === 1 ? 'invitee' : 'invitees'} on this workspace.
            </Text>

            <form action={sendMissingUploadReminderAction} className="mt-4 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <Fieldset>
                <Subheading>Missing upload reminder</Subheading>
                <Input name="workspaceId" type="hidden" value={workspace.id} />
                {missingUploadItems.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {missingUploadItems.map((item) => (
                      <li key={item.category}>{item.label}</li>
                    ))}
                  </ul>
                ) : (
                  <Text className="mt-3">All required uploads are accepted.</Text>
                )}
                <div className="mt-5">
                  <Button type="submit">Send missing upload reminder</Button>
                </div>
              </Fieldset>
            </form>

            <form action={sendReadoutReminderAction} className="mt-4 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <Fieldset>
                <Subheading>Readout reminder</Subheading>
                <Input name="workspaceId" type="hidden" value={workspace.id} />
                <FieldGroup className="mt-5">
                  <Field>
                    <Label>Readout date</Label>
                    <Input name="readoutDate" type="date" required />
                  </Field>
                </FieldGroup>
                <div className="mt-5">
                  <Button type="submit">Send readout reminder</Button>
                </div>
              </Fieldset>
            </form>

            <div className="mt-6">
              <Subheading>Last reminders</Subheading>
              {reminders.length > 0 ? (
                <Table className="mt-4 [--gutter:--spacing(4)]">
                  <TableHead>
                    <TableRow>
                      <TableHeader>Recipient</TableHeader>
                      <TableHeader>Reminder</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {reminders.slice(0, 5).map((reminder) => (
                      <TableRow key={reminder.id}>
                        <TableCell>{reminder.recipientEmail}</TableCell>
                        <TableCell>
                          <div className="font-medium">{reminderTypeLabel(reminder.type)}</div>
                          <div className="text-zinc-500">{reminder.subject}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Text className="mt-3">No reminder emails sent yet.</Text>
              )}
            </div>
          </div>
        </aside>
      </section>
    </>
  )
}

function adminWorkspaceRouteHref(workspaceId: AuditWorkspace['id'], next: string) {
  return `/admin/workspaces/${encodeURIComponent(workspaceId)}${next}`
}

function periodStatusColor(status: AuditWorkspace['monitoringPeriods'][number]['status']) {
  if (status === 'active') {
    return 'green'
  }

  if (status === 'closed') {
    return 'zinc'
  }

  return 'blue'
}

function reminderTypeLabel(type: ReminderEmailType) {
  if (type === 'missing_uploads') {
    return 'Missing uploads'
  }

  if (type === 'readout') {
    return 'Readout'
  }

  if (type === 'high_severity_findings') {
    return 'High-severity findings'
  }

  return 'Failed sync'
}
