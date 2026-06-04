import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/description-list'
import { Heading, Subheading } from '@/components/heading'
import { Select } from '@/components/select'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { statusColor } from '@/lib/audit/demo-workspace'
import { formatMinorCurrency } from '@/lib/audit/evidence-pack'
import { buildCustomerFindingDetail, type CustomerFindingEvidence } from '@/lib/audit/finding-detail'
import { type FindingComment } from '@/lib/audit/finding-comments'
import { findingAssignmentOwnerLabel, findingAssignmentOwners } from '@/lib/audit/finding-assignment'
import { findingWorkflowStatusOptions } from '@/lib/audit/finding-workflow'
import { getFindingCommentStore, getFindingStore, getParsedRecordStore } from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'
import { addFindingCommentAction, updateFindingAssignmentAction, updateFindingWorkflowStatusAction } from './actions'

export async function FindingDetailPageContent({
  backHref,
  findingId,
  workspace,
}: {
  backHref: string
  findingId: string
  workspace: AuditWorkspace
}) {
  const [findings, parsedRecords, comments] = await Promise.all([
    getFindingStore().listByWorkspace(workspace.id),
    getParsedRecordStore().listByWorkspace(workspace.id),
    getFindingCommentStore().listByWorkspace(workspace.id),
  ])
  const finding = findings.find((candidate) => candidate.id === findingId)
  const detail = finding ? buildCustomerFindingDetail({ finding, parsedRecords }) : null

  if (!detail) {
    notFound()
  }

  const findingComments = comments.filter((comment) => comment.findingId === detail.id)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={backHref} plain>
            Back to findings
          </Button>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Badge color={statusColor(detail.severity)}>{detail.severity}</Badge>
            <Badge color={statusColor(detail.status)}>{detail.status.replaceAll('_', ' ')}</Badge>
          </div>
          <Heading className="mt-4">{detail.title}</Heading>
          <Text className="mt-2">
            {detail.customer} · {workspace.auditPeriod} · {detail.id}
          </Text>
        </div>
        <div>
          <Button href={ticketCsvHref(workspace.id, detail.id)} download={ticketCsvFilename(detail.title)} outline>
            Export ticket CSV
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        <Metric label="Expected amount" value={formatMinorCurrency(detail.expectedAmount, detail.currency)} />
        <Metric label="Actual amount" value={formatMinorCurrency(detail.actualAmount, detail.currency)} />
        <Metric label="Variance" value={formatMinorCurrency(detail.varianceAmount, detail.currency)} />
        <Metric label="Confidence" value={`${Math.round(detail.confidence * 100)}%`} />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.6fr)]">
        <section>
          <Subheading>Evidence trail</Subheading>
          <div className="mt-4 space-y-4">
            {detail.evidence.map((item) => (
              <EvidenceItem key={`${item.type}:${item.sourceId}`} evidence={item} />
            ))}
          </div>
        </section>

        <aside>
          <Subheading>Customer review brief</Subheading>
          <DescriptionList className="mt-4">
            <DescriptionTerm>Customer</DescriptionTerm>
            <DescriptionDetails>{detail.customer}</DescriptionDetails>
            <DescriptionTerm>Recommended action</DescriptionTerm>
            <DescriptionDetails>{detail.recommendedAction}</DescriptionDetails>
            <DescriptionTerm>Customer note</DescriptionTerm>
            <DescriptionDetails>{detail.customerNote ?? 'No customer note has been added yet.'}</DescriptionDetails>
            <DescriptionTerm>Assigned owner</DescriptionTerm>
            <DescriptionDetails>{findingAssignmentOwnerLabel(detail.assignment?.owner)}</DescriptionDetails>
            <DescriptionTerm>Finding ID</DescriptionTerm>
            <DescriptionDetails>{detail.id}</DescriptionDetails>
          </DescriptionList>
          <form action={updateFindingAssignmentAction} className="mt-6 grid gap-3">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="findingId" value={detail.id} />
            <Subheading>Assign owner</Subheading>
            <Select name="assignmentOwner" defaultValue={detail.assignment?.owner ?? 'finance'}>
              {findingAssignmentOwners.map((owner) => (
                <option key={owner.value} value={owner.value}>
                  {owner.label}
                </option>
              ))}
            </Select>
            <Textarea name="assignmentNote" placeholder="Assignment note" defaultValue={detail.assignment?.note} />
            <div>
              <Button type="submit" outline>
                Assign owner
              </Button>
            </div>
          </form>

          <form action={updateFindingWorkflowStatusAction} className="mt-8 grid gap-3">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="findingId" value={detail.id} />
            <Subheading>Workflow status</Subheading>
            <Select name="workflowStatus" defaultValue={defaultWorkflowStatus(detail.status)}>
              {findingWorkflowStatusOptions.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Select>
            <Textarea name="workflowStatusNote" placeholder="Status note" />
            <div>
              <Button type="submit" outline>
                Update status
              </Button>
            </div>
          </form>

          <div className="mt-8">
            <Subheading>Discussion</Subheading>
            <div className="mt-4 space-y-3">
              {findingComments.length > 0 ? (
                findingComments.map((comment) => (
                  <div key={comment.id} className="rounded-lg border border-zinc-950/10 bg-white p-4 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-zinc-950 dark:text-white">{comment.authorName}</div>
                      <Badge color={comment.authorRole === 'internal_admin' ? 'purple' : 'blue'}>{formatRole(comment.authorRole)}</Badge>
                    </div>
                    <Text className="mt-2 whitespace-pre-wrap">{comment.body}</Text>
                    <div className="mt-2 text-xs/5 text-zinc-500 dark:text-zinc-400">{formatCommentDate(comment.createdAt)}</div>
                  </div>
                ))
              ) : (
                <Text>No comments yet.</Text>
              )}
            </div>
            <form action={addFindingCommentAction} className="mt-4 grid gap-3">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="findingId" value={detail.id} />
              <Subheading>Add comment</Subheading>
              <Textarea name="body" placeholder="Comment" />
              <div>
                <Button type="submit" outline>
                  Add comment
                </Button>
              </div>
            </form>
          </div>
        </aside>
      </div>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{value}</div>
    </div>
  )
}

function EvidenceItem({ evidence }: { evidence: CustomerFindingEvidence }) {
  const source = formatSource(evidence)

  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge color="blue">{evidence.type.replaceAll('_', ' ')}</Badge>
        <span className="text-sm/6 text-zinc-500 dark:text-zinc-400">{evidence.sourceId}</span>
      </div>
      <div className="mt-3 font-medium text-zinc-950 dark:text-white">{evidence.summary}</div>
      {source ? <Text className="mt-2">{source}</Text> : null}
    </div>
  )
}

function formatRole(role: FindingComment['authorRole']) {
  const label = role.replaceAll('_', ' ')

  return label.charAt(0).toUpperCase() + label.slice(1)
}

function defaultWorkflowStatus(status: string) {
  return findingWorkflowStatusOptions.some((option) => option.value === status) ? status : 'open'
}

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatSource(evidence: CustomerFindingEvidence): string | undefined {
  const parts = [
    evidence.sourceFileId ? `File ${evidence.sourceFileId}` : undefined,
    evidence.rowNumber ? `row ${evidence.rowNumber}` : undefined,
    evidence.page ? `page ${evidence.page}` : undefined,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : undefined
}

function ticketCsvHref(workspaceId: string, findingId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/findings/${encodeURIComponent(findingId)}/ticket-csv`
}

function ticketCsvFilename(title: string) {
  return `${slug(title)}-ticket.csv`
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
