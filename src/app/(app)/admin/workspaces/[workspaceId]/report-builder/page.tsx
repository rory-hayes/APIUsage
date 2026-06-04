import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { buildEvidencePackForWorkspace, formatMinorCurrency, isCustomerVisibleFinding, renderEvidencePackMarkdown } from '@/lib/audit/evidence-pack'
import { buildIntakeAnswerList } from '@/lib/audit/intake'
import { applyReportBuilderConfig } from '@/lib/audit/report-builder'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getFindingStore, getIntakeStore, getReportBuilderConfigStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'

import { saveReportBuilderAction } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function ReportBuilderPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const [findings, intakeResponse, reportConfig] = await Promise.all([
    getFindingStore().listByWorkspace(workspace.id),
    getIntakeStore().getByWorkspace(workspace.id),
    getReportBuilderConfigStore().getByWorkspace(workspace.id),
  ])
  const customerVisibleFindings = findings.filter(isCustomerVisibleFinding)
  const selectedFindingIds = new Set(reportConfig?.selectedFindingIds ?? customerVisibleFindings.map((finding) => finding.id))
  const noteFindingIds = new Set(
    reportConfig?.noteFindingIds ?? customerVisibleFindings.filter((finding) => finding.customerNote).map((finding) => finding.id),
  )
  const pack = buildEvidencePackForWorkspace({
    workspace,
    findings: applyReportBuilderConfig(findings, reportConfig),
    intakeAnswers: buildIntakeAnswerList(intakeResponse?.answers ?? {}),
  })
  const heldForReviewCount = findings.filter((finding) => !isCustomerVisibleFinding(finding) && finding.status !== 'rejected').length
  const markdown = renderEvidencePackMarkdown(pack)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to admin workspace
          </Button>
          <Heading className="mt-6">Report builder</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Assemble the customer-visible readout from approved
            findings and saved intake context.
          </Text>
        </div>
        <Badge color={statusColor(workspace.status)}>{workspace.status.replaceAll('_', ' ')}</Badge>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        <Summary label="Report-ready findings">{plural(pack.summary.findingCount, 'report-ready finding')}</Summary>
        <Summary label="Held for review">{heldForReviewText(heldForReviewCount)}</Summary>
        <Summary label="Total variance">{formatMinorCurrency(pack.summary.totalVarianceAmount, 'eur')}</Summary>
        <Summary label="Critical/high findings">{pack.summary.highSeverityCount.toString()}</Summary>
      </div>

      <section className="mt-10 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Subheading>Audited exports</Subheading>
            <Text className="mt-2">Downloads are served by the evidence-pack API so report access is logged.</Text>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button href={evidencePackDownloadHref(workspace.id, 'readout')} download={`${filenameBase(workspace, 'readout-summary')}.pdf`}>
              Export Readout PDF
            </Button>
            <Button href={evidencePackDownloadHref(workspace.id, 'markdown')} download={`${filenameBase(workspace)}.md`}>
              Export Markdown
            </Button>
            <Button href={evidencePackDownloadHref(workspace.id, 'pdf')} download={`${filenameBase(workspace)}.pdf`} outline>
              Export PDF
            </Button>
            <Button href={evidencePackDownloadHref(workspace.id, 'csv')} download={`${filenameBase(workspace)}.csv`} outline>
              Export CSV
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <Subheading>Report selection</Subheading>
        {customerVisibleFindings.length === 0 ? (
          <Text className="mt-4">No customer-visible findings are available to select yet.</Text>
        ) : (
          <form action={saveReportBuilderAction} className="mt-4">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <Table className="[--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
              <TableHead>
                <TableRow>
                  <TableHeader>Finding</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Include finding</TableHeader>
                  <TableHeader>Include note</TableHeader>
                  <TableHeader className="text-right">Variance</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {customerVisibleFindings.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell>
                      <div className="font-medium">{finding.title}</div>
                      <div className="text-zinc-500">{finding.id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell>
                      <label className="flex items-center gap-2 text-sm/6 text-zinc-600 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          name="findingId"
                          value={finding.id}
                          defaultChecked={selectedFindingIds.has(finding.id)}
                          className="size-4 rounded border-zinc-300 text-zinc-900"
                        />
                        Include finding
                      </label>
                    </TableCell>
                    <TableCell>
                      <label className="flex items-center gap-2 text-sm/6 text-zinc-600 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          name="noteFindingId"
                          value={finding.id}
                          defaultChecked={Boolean(finding.customerNote) && noteFindingIds.has(finding.id)}
                          disabled={!finding.customerNote}
                          className="size-4 rounded border-zinc-300 text-zinc-900 disabled:opacity-40"
                        />
                        Include note
                      </label>
                      {!finding.customerNote ? <Text className="mt-1">No customer note.</Text> : null}
                    </TableCell>
                    <TableCell className="text-right">{formatMinorCurrency(finding.varianceAmount ?? 0, finding.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4">
              <Button type="submit">Save report selection</Button>
            </div>
          </form>
        )}
      </section>

      <Subheading className="mt-10">Root causes</Subheading>
      {pack.summary.rootCauses.length === 0 ? (
        <Text className="mt-4">No customer-visible root causes are available yet.</Text>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {pack.summary.rootCauses.map((rootCause) => (
            <div key={rootCause.rootCause} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium text-zinc-950 dark:text-white">{rootCause.label}</div>
                <Badge color={rootCause.highSeverityCount > 0 ? 'red' : 'zinc'}>{rootCause.findingCount} findings</Badge>
              </div>
              <Text className="mt-2">
                {formatMinorCurrency(rootCause.totalVarianceAmount, 'eur')} variance - {rootCause.highSeverityCount} critical/high
              </Text>
            </div>
          ))}
        </div>
      )}

      <Subheading className="mt-10">Action plan</Subheading>
      {pack.summary.actionPlan.length === 0 ? (
        <Text className="mt-4">No customer-visible next actions are available yet.</Text>
      ) : (
        <div className="mt-4 space-y-3">
          {pack.summary.actionPlan.map((item) => (
            <div key={item.findingId} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium text-zinc-950 dark:text-white">{item.recommendedOwner}</div>
                <Badge color={item.severity === 'critical' || item.severity === 'high' ? 'red' : 'zinc'}>{item.rootCauseLabel}</Badge>
              </div>
              <Text className="mt-2">{item.nextAction}</Text>
              <Text className="mt-2">
                {item.title} - {formatMinorCurrency(item.totalVarianceAmount, 'eur')} variance
              </Text>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 grid gap-8 xl:grid-cols-2">
        <section>
          <Subheading>Included findings</Subheading>
          {pack.findings.length === 0 ? (
            <Text className="mt-4">No approved findings are currently available for the report.</Text>
          ) : (
            <div className="mt-4 space-y-8">
              {pack.summary.rootCauses.map((rootCause) => (
                <section key={rootCause.rootCause}>
                  <div className="font-medium text-zinc-950 dark:text-white">{rootCause.label}</div>
                  <div className="mt-3 space-y-4">
                    {pack.findings
                      .filter((finding) => finding.rootCause === rootCause.rootCause)
                      .map((finding) => (
                        <div key={finding.id} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="font-medium text-zinc-950 dark:text-white">{finding.title}</div>
                            <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
                          </div>
                          <Text className="mt-2">
                            {finding.customer} - {formatMinorCurrency(finding.varianceAmount, finding.currency)} variance -{' '}
                            {Math.round(finding.confidence * 100)}% confidence
                          </Text>
                          {finding.customerNote ? <Text className="mt-3">{finding.customerNote}</Text> : null}
                          <Text className="mt-3">Recommended action: {finding.recommendedAction}</Text>
                        </div>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        <section>
          <Subheading>Intake context</Subheading>
          {pack.intakeAnswers.length === 0 ? (
            <Text className="mt-4">No intake answers have been included yet.</Text>
          ) : (
            <div className="mt-4 space-y-4">
              {pack.intakeAnswers.map((answer) => (
                <div key={answer.key} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                  <div className="font-medium text-zinc-950 dark:text-white">{answer.label}</div>
                  <Text className="mt-3">{answer.value}</Text>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Subheading className="mt-10">Markdown preview</Subheading>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-950/10 bg-zinc-950 p-5 text-sm/6 whitespace-pre-wrap text-white shadow-xs dark:border-white/10">
        {markdown}
      </pre>
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

function evidencePackDownloadHref(workspaceId: string, format: 'markdown' | 'csv' | 'pdf' | 'readout') {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/evidence-pack?format=${format}`
}

function filenameBase(workspace: { organizationName: string; auditPeriod: string }, suffix = 'evidence-pack') {
  return `${slug(workspace.organizationName)}-${slug(workspace.auditPeriod)}-${suffix}`
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function plural(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function heldForReviewText(count: number) {
  return count === 1 ? '1 finding held for review' : `${count} findings held for review`
}
