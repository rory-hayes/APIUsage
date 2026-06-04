import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { type ParseJob } from '@/lib/audit/parse-jobs'
import { type RuleRun } from '@/lib/audit/rule-runs'
import { buildLatestRuleRunComparison, type RuleRunComparison } from '@/lib/audit/run-comparison'
import { getParseJobStore, getRuleRunStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireInternalAdmin } from '@/lib/auth/server'
import { RuleTemplateRunForm } from '../rule-template-run-form'

export const dynamic = 'force-dynamic'

type RunRow = {
  id: string
  name: string
  kind: string
  status: string
  ranAt: string
  recordsLabel: string
  detail: string
}

export default async function AdminRunsPage() {
  const session = await requireInternalAdmin()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const [parseJobs, ruleRuns] = await Promise.all([
    getParseJobStore().listByWorkspace(workspace.id),
    getRuleRunStore().listByWorkspace(workspace.id),
  ])
  const runRows = buildRunRows(parseJobs, ruleRuns, buildLatestRuleRunComparison(ruleRuns))

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Run history</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Internal parser and reconciliation runs for the
            active workspace.
          </Text>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} outline>
            Workspace
          </Button>
          <Button href="#rule-template-library" outline>
            Configure checks
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Summary label="Parser runs">{parseJobs.length.toLocaleString('en-IE')}</Summary>
        <Summary label="Reconciliation runs">{ruleRuns.length.toLocaleString('en-IE')}</Summary>
        <Summary label="Open parser errors">{parseJobs.reduce((total, job) => total + job.errorCount, 0).toLocaleString('en-IE')}</Summary>
      </div>

      {RuleTemplateRunForm({})}

      <Subheading className="mt-10">Runs</Subheading>
      {runRows.length === 0 ? (
        <Text className="mt-4">No parser or reconciliation runs have been recorded for this workspace yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Run</TableHeader>
              <TableHeader>Kind</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Records</TableHeader>
              <TableHeader>Detail</TableHeader>
              <TableHeader>Ran at</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {runRows.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-medium">{run.name}</TableCell>
                <TableCell>{run.kind}</TableCell>
                <TableCell>
                  <Badge color={statusColor(run.status)}>{run.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{run.recordsLabel}</TableCell>
                <TableCell className="text-zinc-500">{run.detail}</TableCell>
                <TableCell>{formatTimestamp(run.ranAt)}</TableCell>
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

function buildRunRows(parseJobs: ParseJob[], ruleRuns: RuleRun[], comparison: RuleRunComparison | null): RunRow[] {
  const parseRows = parseJobs.map((job): RunRow => ({
    id: job.id,
    name: job.filename,
    kind: job.parser.replaceAll('_', ' '),
    status: job.status,
    ranAt: job.ranAt,
    recordsLabel: `${job.recordCount.toLocaleString('en-IE')} ${job.recordCount === 1 ? 'record' : 'records'}`,
    detail: job.errors.length === 0 ? 'No parser errors' : job.errors.map((error) => `row ${error.rowNumber}: ${error.message}`).join(' · '),
  }))
  const checkRows = ruleRuns.map((run): RunRow => ({
    id: run.id,
    name: 'Reconciliation checks',
    kind: 'reconciliation',
    status: run.status,
    ranAt: run.completedAt,
    recordsLabel: `${run.inputs.parsedRecordCount.toLocaleString('en-IE')} ${
      run.inputs.parsedRecordCount === 1 ? 'record' : 'records'
    }`,
    detail: formatRuleRunDetail(run, comparison),
  }))

  return [...parseRows, ...checkRows].sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())
}

function formatRuleRunDetail(run: RuleRun, comparison: RuleRunComparison | null): string {
  return [
    `Rule version ${run.ruleVersion}`,
    `${run.inputs.parsedRecordCount.toLocaleString('en-IE')} ${run.inputs.parsedRecordCount === 1 ? 'record' : 'records'}`,
    `${run.inputs.contractTermCount.toLocaleString('en-IE')} ${run.inputs.contractTermCount === 1 ? 'contract term' : 'contract terms'}`,
    `${run.inputs.accountMappingCount.toLocaleString('en-IE')} ${run.inputs.accountMappingCount === 1 ? 'mapping' : 'mappings'}`,
    `${run.output.findingCount.toLocaleString('en-IE')} ${run.output.findingCount === 1 ? 'finding' : 'findings'}`,
    `${run.inputs.ruleTemplateIds.length.toLocaleString('en-IE')} ${run.inputs.ruleTemplateIds.length === 1 ? 'check' : 'checks'}`,
    formatPricingRuleVersions(run),
    formatRunComparison(run, comparison),
    formatFindingCategories(run),
    formatRuleErrors(run),
  ]
    .filter(Boolean)
    .join(' · ')
}

function formatPricingRuleVersions(run: RuleRun): string | undefined {
  if (!run.inputs.pricingRuleVersions || run.inputs.pricingRuleVersions.length === 0) {
    return undefined
  }

  return `Pricing rules: ${run.inputs.pricingRuleVersions.map((rule) => `${rule.name} v${rule.version}`).join(', ')}`
}

function formatRunComparison(run: RuleRun, comparison: RuleRunComparison | null): string | undefined {
  if (!comparison || comparison.currentRunId !== run.id) {
    return undefined
  }

  return `Run comparison: ${comparison.counts.new.toLocaleString('en-IE')} new · ${comparison.counts.recurring.toLocaleString(
    'en-IE',
  )} recurring · ${comparison.counts.resolved.toLocaleString('en-IE')} resolved since previous run`
}

function formatFindingCategories(run: RuleRun): string | undefined {
  return run.output.findingCategories.length > 0 ? run.output.findingCategories.map((category) => category.replaceAll('_', ' ')).join(', ') : undefined
}

function formatRuleErrors(run: RuleRun): string {
  return run.errors.length === 0 ? 'No rule errors' : run.errors.map((error) => error.message).join(' · ')
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
