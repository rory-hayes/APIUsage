import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { statusColor } from '@/lib/audit/demo-workspace'
import { formatMinorCurrency, isCustomerVisibleFinding } from '@/lib/audit/evidence-pack'
import { findingAssignmentOwnerLabel } from '@/lib/audit/finding-assignment'
import { findingWorkflowStatusOptions, isFindingIssueTrackable } from '@/lib/audit/finding-workflow'
import { type Finding } from '@/lib/audit/schemas'
import { getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'

import { mergeFindingAction, reviewFindingAction, updateFindingIssueStatusAction } from '../../../actions'

export const dynamic = 'force-dynamic'

const reviewableStatuses = ['draft', 'needs_review', 'needs_customer_input'] as const satisfies readonly Finding['status'][]

export default async function AdminWorkspaceFindingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const findings = await getFindingStore().listByWorkspace(workspace.id)
  const reviewableFindings = findings.filter(isReviewableFinding)
  const issueFindings = findings.filter(isIssueTrackableFinding)
  const customerVisibleCount = findings.filter(isCustomerVisibleFinding).length
  const rejectedCount = findings.filter((finding) => finding.status === 'rejected').length

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to workspace
          </Button>
          <Heading className="mt-6">Finding review</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Review draft findings, separate internal notes from
            customer-facing notes, and publish only approved evidence-backed issues.
          </Text>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Summary label="Review queue">{plural(reviewableFindings.length, 'reviewable finding')}</Summary>
        <Summary label="Customer visible">{plural(customerVisibleCount, 'customer-visible finding')}</Summary>
        <Summary label="Rejected">{rejectedCount === 1 ? '1 rejected' : `${rejectedCount.toLocaleString('en-IE')} rejected`}</Summary>
      </div>

      <Subheading className="mt-12">Draft findings</Subheading>
      {reviewableFindings.length === 0 ? (
        <Text className="mt-4">No draft findings currently need review for this workspace.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Finding</TableHeader>
              <TableHeader>Severity</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Evidence</TableHeader>
              <TableHeader className="text-right">Variance</TableHeader>
              <TableHeader>Review</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {reviewableFindings.map((finding) => (
              <TableRow key={finding.id}>
                <TableCell>
                  <div className="font-medium">{finding.title}</div>
                  <div className="text-zinc-500">{finding.category.replaceAll('_', ' ')}</div>
                  <div className="mt-1 text-zinc-400">{findingCustomerLabel(finding)}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.severity)}>{finding.severity}</Badge>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{plural(finding.evidenceRefs.length, 'evidence ref')}</TableCell>
                <TableCell className="text-right">{formatMinorCurrency(finding.varianceAmount ?? 0, finding.currency)}</TableCell>
                <TableCell>
                  <div className="grid gap-3">
                    <form action={reviewFindingAction} className="grid gap-3">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="findingId" value={finding.id} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          name="title"
                          aria-label={`Finding title for ${finding.title}`}
                          defaultValue={finding.title}
                          className="sm:col-span-2"
                          required
                        />
                        <Select name="severity" aria-label={`Severity for ${finding.title}`} defaultValue={finding.severity}>
                          <option value="critical">critical</option>
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="low">low</option>
                          <option value="info">info</option>
                        </Select>
                        <Input
                          name="expectedAmount"
                          aria-label={`Expected amount for ${finding.title}`}
                          type="number"
                          defaultValue={finding.expectedAmount.toString()}
                          required
                        />
                        <Input
                          name="actualAmount"
                          aria-label={`Actual amount for ${finding.title}`}
                          type="number"
                          defaultValue={finding.actualAmount.toString()}
                          required
                        />
                        <Input
                          name="recommendedAction"
                          aria-label={`Recommended action for ${finding.title}`}
                          defaultValue={finding.recommendedAction}
                          className="sm:col-span-2"
                          required
                        />
                      </div>
                      <Textarea name="internalNote" aria-label={`Internal note for ${finding.title}`} placeholder="Internal reviewer note" />
                      <Textarea name="customerNote" aria-label={`Customer note for ${finding.title}`} placeholder="Customer-facing note" />
                      <label className="flex items-center gap-2 text-sm/6 text-zinc-600 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          name="suppressFutureMatches"
                          value="on"
                          className="size-4 rounded border-zinc-300 text-zinc-900"
                        />
                        Suppress future matches
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" name="status" value="approved_internal">
                          Approve
                        </Button>
                        <Button type="submit" name="status" value="rejected" outline>
                          Reject
                        </Button>
                        <Button type="submit" name="status" value="needs_customer_input" outline>
                          Request more data
                        </Button>
                      </div>
                    </form>
                    <form action={mergeFindingAction} className="grid gap-2 border-t border-zinc-950/10 pt-3 dark:border-white/10">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="sourceFindingId" value={finding.id} />
                      <Input name="targetFindingId" aria-label={`Merge target for ${finding.title}`} placeholder="Target finding ID" required />
                      <Textarea name="note" aria-label={`Merge note for ${finding.title}`} placeholder="Merge note" />
                      <div>
                        <Button type="submit" outline>
                          Merge
                        </Button>
                      </div>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Open issue tracking</Subheading>
      <div className="mt-4 grid gap-4 lg:grid-cols-6">
        {findingWorkflowStatusOptions.map((status) => (
          <Summary key={status.value} label={status.label}>
            {plural(issueFindings.filter((finding) => finding.status === status.value).length, status.value)}
          </Summary>
        ))}
      </div>
      {issueFindings.length === 0 ? (
        <Text className="mt-4">No customer-visible issues are ready for lifecycle tracking yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Issue</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Owner</TableHeader>
              <TableHeader>Recommended action</TableHeader>
              <TableHeader className="text-right">Variance</TableHeader>
              <TableHeader>Tracking</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {issueFindings.map((finding) => (
              <TableRow key={finding.id}>
                <TableCell>
                  <div className="font-medium">{finding.title}</div>
                  <div className="text-zinc-500">{findingCustomerLabel(finding)}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{findingAssignmentOwnerLabel(finding.assignment?.owner)}</TableCell>
                <TableCell className="max-w-sm whitespace-normal text-zinc-500">{finding.recommendedAction}</TableCell>
                <TableCell className="text-right">{formatMinorCurrency(finding.varianceAmount ?? 0, finding.currency)}</TableCell>
                <TableCell>
                  <form action={updateFindingIssueStatusAction} className="grid min-w-64 gap-2">
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <input type="hidden" name="findingId" value={finding.id} />
                    <Select name="status" aria-label={`Issue status for ${finding.title}`} defaultValue={defaultIssueStatus(finding)}>
                      {findingWorkflowStatusOptions.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </Select>
                    <Textarea name="issueStatusNote" aria-label={`Issue status note for ${finding.title}`} placeholder="Resolution or monitoring note" />
                    <div>
                      <Button type="submit" outline>
                        Update status
                      </Button>
                    </div>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function Summary({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{children}</div>
    </div>
  )
}

function isReviewableFinding(finding: Finding) {
  return (reviewableStatuses as readonly string[]).includes(finding.status)
}

function isIssueTrackableFinding(finding: Finding) {
  return isFindingIssueTrackable(finding)
}

function defaultIssueStatus(finding: Finding) {
  return findingWorkflowStatusOptions.some((option) => option.value === finding.status) ? finding.status : 'open'
}

function findingCustomerLabel(finding: Finding) {
  const customerName = finding.metadata.customerName

  return typeof customerName === 'string' && customerName.trim().length > 0 ? customerName : finding.customerId ?? 'Account not identified'
}

function plural(count: number, singular: string) {
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-IE')} ${singular}s`
}
