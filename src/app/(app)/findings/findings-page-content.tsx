import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { buildEvidencePackForWorkspace, formatMinorCurrency } from '@/lib/audit/evidence-pack'
import { statusColor } from '@/lib/audit/demo-workspace'
import { buildPeriodFindingComparison } from '@/lib/audit/period-comparison'
import { getFindingStore } from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'

import { generateEvidencePackAction } from '../admin/actions'

export async function FindingsPageContent({
  canGenerateEvidencePack,
  scoped = false,
  workspace,
}: {
  canGenerateEvidencePack: boolean
  scoped?: boolean
  workspace: AuditWorkspace
}) {
  const generatedFindings = await getFindingStore().listByWorkspace(workspace.id)
  const generatedPack = buildEvidencePackForWorkspace({
    workspace,
    findings: generatedFindings,
  })
  const periodComparison = buildPeriodFindingComparison({
    workspace,
    findings: generatedFindings,
  })
  const csvHref = findingsCsvDownloadHref(workspace.id)
  const rows = generatedPack.findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    category: formatCategory(finding.category),
    customer: finding.customer,
    severity: finding.severity,
    status: finding.status,
    assignedOwner: finding.assignedOwner,
    variance: formatMinorCurrency(finding.varianceAmount, finding.currency),
    confidence: finding.confidence,
    recommendedAction: finding.recommendedAction,
    href: findingHref(workspace.id, finding.id, scoped),
  }))

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Findings</Heading>
          <Text className="mt-2">Human-reviewed revenue and margin integrity issues.</Text>
        </div>
        <div className="flex flex-wrap gap-3">
          {canGenerateEvidencePack ? (
            <form action={generateEvidencePackAction}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <Button type="submit">Generate evidence pack</Button>
            </form>
          ) : null}
          <Button href={csvHref} download={`${slug(workspace.organizationName)}-${slug(workspace.auditPeriod)}-findings.csv`} outline>
            Export CSV
          </Button>
        </div>
      </div>

      {periodComparison ? (
        <section className="mt-8 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Subheading>Period comparison</Subheading>
              <Text className="mt-2">
                {periodComparison.currentPeriod.label} vs {periodComparison.previousPeriod.label}
              </Text>
            </div>
            <Badge color={periodComparison.delta.totalVarianceAmount >= 0 ? 'amber' : 'green'}>
              {formatSignedMinorCurrency(periodComparison.delta.totalVarianceAmount, workspace.currency)} variance
            </Badge>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Current period</div>
              <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">
                {formatCount(periodComparison.current.findingCount, 'current finding')}
              </div>
            </div>
            <div>
              <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Previous period</div>
              <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">
                {formatCount(periodComparison.previous.findingCount, 'previous finding')}
              </div>
            </div>
            <div>
              <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Critical/high delta</div>
              <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">
                {formatSignedInteger(periodComparison.delta.highSeverityCount)}
              </div>
            </div>
          </div>
          {periodComparison.categoryRows.length > 0 ? (
            <Table className="mt-5 [--gutter:--spacing(4)]">
              <TableHead>
                <TableRow>
                  <TableHeader>Category</TableHeader>
                  <TableHeader className="text-right">Current</TableHeader>
                  <TableHeader className="text-right">Previous</TableHeader>
                  <TableHeader className="text-right">Delta</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {periodComparison.categoryRows.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right">{row.currentCount}</TableCell>
                    <TableCell className="text-right">{row.previousCount}</TableCell>
                    <TableCell className="text-right">{formatSignedInteger(row.delta)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </section>
      ) : null}

      {rows.length === 0 ? (
        <Text className="mt-8">No approved findings have been published yet.</Text>
      ) : (
        <Table className="mt-8 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Finding</TableHeader>
              <TableHeader>Category</TableHeader>
              <TableHeader>Customer</TableHeader>
              <TableHeader>Severity</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Owner</TableHeader>
              <TableHeader>Recommended action</TableHeader>
              <TableHeader className="text-right">Variance</TableHeader>
              <TableHeader className="text-right">Confidence</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((finding) => (
              <TableRow key={finding.id} href={finding.href} title={finding.title}>
                <TableCell>
                  <div className="font-medium">{finding.title}</div>
                  <div className="text-zinc-500">{finding.id}</div>
                </TableCell>
                <TableCell>{finding.category}</TableCell>
                <TableCell>{finding.customer}</TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.severity)}>{finding.severity}</Badge>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{finding.assignedOwner}</TableCell>
                <TableCell className="max-w-sm whitespace-normal text-zinc-500">{finding.recommendedAction}</TableCell>
                <TableCell className="text-right">{finding.variance}</TableCell>
                <TableCell className="text-right">{Math.round(finding.confidence * 100)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function formatCategory(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

function formatSignedInteger(value: number): string {
  return value > 0 ? `+${value}` : value.toString()
}

function formatSignedMinorCurrency(amount: number, currency: string) {
  return amount > 0 ? `+${formatMinorCurrency(amount, currency)}` : formatMinorCurrency(amount, currency)
}

function findingsCsvDownloadHref(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/findings/csv`
}

function findingHref(workspaceId: string, findingId: string, scoped: boolean) {
  const encodedFindingId = encodeURIComponent(findingId)

  return scoped ? `/workspaces/${encodeURIComponent(workspaceId)}/findings/${encodedFindingId}` : `/findings/${encodedFindingId}`
}
