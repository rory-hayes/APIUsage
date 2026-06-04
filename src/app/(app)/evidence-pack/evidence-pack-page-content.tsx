import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { buildEvidencePackForWorkspace, formatMinorCurrency, renderEvidencePackMarkdown } from '@/lib/audit/evidence-pack'
import { buildIntakeAnswerList } from '@/lib/audit/intake'
import { applyReportBuilderConfig } from '@/lib/audit/report-builder'
import { getFindingStore, getIntakeStore, getReportBuilderConfigStore } from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'

export async function EvidencePackPageContent({ workspace }: { workspace: AuditWorkspace }) {
  const [generatedFindings, intakeResponse, reportConfig] = await Promise.all([
    getFindingStore().listByWorkspace(workspace.id),
    getIntakeStore().getByWorkspace(workspace.id),
    getReportBuilderConfigStore().getByWorkspace(workspace.id),
  ])
  const pack = buildEvidencePackForWorkspace({
    workspace,
    findings: applyReportBuilderConfig(generatedFindings, reportConfig),
    intakeAnswers: buildIntakeAnswerList(intakeResponse?.answers ?? {}),
  })
  const markdown = renderEvidencePackMarkdown(pack)
  const markdownHref = evidencePackDownloadHref(workspace.id, 'markdown')
  const csvHref = evidencePackDownloadHref(workspace.id, 'csv')
  const pdfHref = evidencePackDownloadHref(workspace.id, 'pdf')
  const readoutHref = evidencePackDownloadHref(workspace.id, 'readout')
  const evidencePackFilenameBase = filenameBase(workspace, 'evidence-pack')
  const readoutFilenameBase = filenameBase(workspace, 'readout-summary')

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Evidence pack</Heading>
          <Text className="mt-2">
            {pack.summary.auditPeriod} · {pack.summary.findingCount} customer-visible findings ·{' '}
            {formatMinorCurrency(pack.summary.totalVarianceAmount, 'eur')} at risk
          </Text>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href={readoutHref} download={`${readoutFilenameBase}.pdf`}>
            Export Readout PDF
          </Button>
          <Button href={markdownHref} download={`${evidencePackFilenameBase}.md`}>
            Export Markdown
          </Button>
          <Button href={pdfHref} download={`${evidencePackFilenameBase}.pdf`} outline>
            Export PDF
          </Button>
          <Button href={csvHref} download={`${evidencePackFilenameBase}.csv`} outline>
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <Summary label="Total variance" value={formatMinorCurrency(pack.summary.totalVarianceAmount, 'eur')} />
        <Summary label="Critical/high findings" value={pack.summary.highSeverityCount.toString()} />
        <Summary label="Published findings" value={pack.summary.findingCount.toString()} />
      </div>

      <div className="mt-10 grid gap-8 xl:grid-cols-2">
        <section>
          <Subheading>Top issues</Subheading>
          {pack.summary.topIssues.length === 0 ? (
            <Text className="mt-4">No customer-visible issue groups are available yet.</Text>
          ) : (
            <div className="mt-4 space-y-3">
              {pack.summary.topIssues.map((issue) => (
                <div key={issue.category} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium text-zinc-950 dark:text-white">{issue.label}</div>
                    <Badge color={issue.highSeverityCount > 0 ? 'red' : 'zinc'}>{issue.findingCount} findings</Badge>
                  </div>
                  <Text className="mt-2">
                    {formatMinorCurrency(issue.totalVarianceAmount, 'eur')} variance · {issue.highSeverityCount} critical/high
                  </Text>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <Subheading>Next actions</Subheading>
          {pack.summary.nextActions.length === 0 ? (
            <Text className="mt-4">No customer-visible actions are available yet.</Text>
          ) : (
            <div className="mt-4 space-y-3">
              {pack.summary.nextActions.map((action) => (
                <div key={action.action} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                  <div className="font-medium text-zinc-950 dark:text-white">{action.action}</div>
                  <Text className="mt-2">
                    {action.findingCount} findings · {formatMinorCurrency(action.totalVarianceAmount, 'eur')} variance
                  </Text>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

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
                {formatMinorCurrency(rootCause.totalVarianceAmount, 'eur')} variance · {rootCause.highSeverityCount} critical/high
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
                {item.title} · {formatMinorCurrency(item.totalVarianceAmount, 'eur')} variance
              </Text>
            </div>
          ))}
        </div>
      )}

      <Subheading className="mt-10">Intake context</Subheading>
      {pack.intakeAnswers.length === 0 ? (
        <Text className="mt-4">No intake answers have been included yet.</Text>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {pack.intakeAnswers.map((answer) => (
            <div key={answer.key} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <div className="font-medium text-zinc-950 dark:text-white">{answer.label}</div>
              <Text className="mt-3">{answer.value}</Text>
            </div>
          ))}
        </div>
      )}

      <Subheading className="mt-10">Published findings</Subheading>
      {pack.findings.length === 0 ? (
        <Text className="mt-4">No approved findings are currently available for the evidence pack.</Text>
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
                        {finding.customer} · {formatMinorCurrency(finding.varianceAmount, finding.currency)} variance ·{' '}
                        {Math.round(finding.confidence * 100)}% confidence
                      </Text>
                      {finding.customerNote ? <Text className="mt-3">{finding.customerNote}</Text> : null}
                      <Text className="mt-3">Recommended action: {finding.recommendedAction}</Text>
                      <div className="mt-3 text-sm/6 text-zinc-500 dark:text-zinc-400">
                        Evidence: {finding.evidenceRefs.map((ref) => `${ref.type} ${ref.sourceId}`).join(', ')}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Subheading className="mt-10">Markdown preview</Subheading>
      <pre className="mt-4 overflow-x-auto rounded-lg border border-zinc-950/10 bg-zinc-950 p-5 text-sm/6 whitespace-pre-wrap text-white shadow-xs dark:border-white/10">
        {markdown}
      </pre>
    </>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{value}</div>
    </div>
  )
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function filenameBase(workspace: { organizationName: string; auditPeriod: string }, suffix: string) {
  return `${slug(workspace.organizationName)}-${slug(workspace.auditPeriod)}-${suffix}`
}

function evidencePackDownloadHref(workspaceId: string, format: 'markdown' | 'csv' | 'pdf' | 'readout') {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/evidence-pack?format=${format}`
}
