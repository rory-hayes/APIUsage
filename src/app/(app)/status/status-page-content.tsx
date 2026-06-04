import { Badge } from '@/components/badge'
import { Heading, Subheading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { buildWorkspaceStatusView } from '@/lib/audit/status'
import {
  getAccountMappingStore,
  getFindingStore,
  getIntakeStore,
  getParsedRecordStore,
  getParseJobStore,
  getUploadStore,
} from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'

export async function StatusPageContent({ workspace }: { workspace: AuditWorkspace }) {
  const [intakeResponse, parseJobs, parsedRecords, uploads, findings, accountMappings] = await Promise.all([
    getIntakeStore().getByWorkspace(workspace.id),
    getParseJobStore().listByWorkspace(workspace.id),
    getParsedRecordStore().listByWorkspace(workspace.id),
    getUploadStore().listByWorkspace(workspace.id),
    getFindingStore().listByWorkspace(workspace.id),
    getAccountMappingStore().listByWorkspace(workspace.id),
  ])
  const statusView = buildWorkspaceStatusView({
    workspace,
    intakeResponse,
    parseJobs,
    parsedRecords,
    uploads,
    findings,
    accountMappings,
  })

  return (
    <>
      <div>
        <Heading>Status</Heading>
        <Text className="mt-2">
          {statusView.workspace.name} - {statusView.workspace.auditPeriod} - {statusView.workspace.statusLabel} - {statusView.workspace.readinessPercent}%
          workspace readiness
        </Text>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <Subheading>Intake readiness</Subheading>
            <Badge color={intakeStatusColor(statusView.intakeCompleteness.status)}>
              {statusView.intakeCompleteness.status.replaceAll('_', ' ')}
            </Badge>
          </div>
          <Text className="mt-3">
            {statusView.intakeCompleteness.answeredRequired} of {statusView.intakeCompleteness.requiredQuestions} required answers complete.
          </Text>
        </div>
        <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Intake completeness</div>
          <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{statusView.intakeCompleteness.percentComplete}%</div>
        </div>
        <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Last intake update</div>
          <div className="mt-2 text-sm/6 font-medium text-zinc-950 dark:text-white">
            {statusView.lastIntakeUpdate ? new Date(statusView.lastIntakeUpdate).toLocaleString('en-IE') : 'No intake saved'}
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <Subheading>Upload readiness</Subheading>
            <Badge color={statusView.uploadSummary.missingRequired === 0 ? 'green' : 'amber'}>
              {statusView.uploadSummary.acceptedRequired}/{statusView.uploadSummary.requiredTotal} accepted
            </Badge>
          </div>
          <Text className="mt-3">
            {statusView.uploadSummary.acceptedRequired} of {statusView.uploadSummary.requiredTotal} required upload categories accepted.
          </Text>
          <Text className="mt-1">
            {statusView.uploadSummary.needsReviewRequired} awaiting internal review · {statusView.uploadSummary.missingRequired} still missing.
          </Text>
        </div>
        <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-3">
            <Subheading>Readout readiness</Subheading>
            <Badge color={statusView.findingSummary.evidencePackReady ? 'green' : 'amber'}>
              {statusView.findingSummary.evidencePackReady ? 'evidence ready' : 'in review'}
            </Badge>
          </div>
          <Text className="mt-3">
            {formatCount(statusView.findingSummary.customerVisibleCount, 'approved finding')} available for the evidence pack.
          </Text>
          <Text className="mt-1">
            {formatCount(statusView.findingSummary.draftReviewCount, 'finding')} in internal review ·{' '}
            {formatCount(statusView.findingSummary.rejectedCount, 'rejected finding')} filtered out.
          </Text>
        </div>
      </div>

      <div className="mt-10 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <Subheading>Data quality score</Subheading>
          <Badge color={dataQualityColor(statusView.dataQuality.level)}>{statusView.dataQuality.score}%</Badge>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Completeness</div>
            <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">{statusView.dataQuality.completenessPercent}%</div>
          </div>
          <div>
            <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Parse success</div>
            <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">{statusView.dataQuality.parseSuccessPercent}%</div>
          </div>
          <div>
            <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Mapping coverage</div>
            <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">{statusView.dataQuality.mappingCoveragePercent}%</div>
          </div>
          <div>
            <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">Confidence</div>
            <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">{statusView.dataQuality.confidencePercent}%</div>
          </div>
        </div>
      </div>

      <Subheading className="mt-10">Upload checklist</Subheading>
      <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>Category</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Owner</TableHeader>
            <TableHeader>Files</TableHeader>
            <TableHeader>Latest file</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {statusView.uploadRows.map((upload) => (
            <TableRow key={upload.category}>
              <TableCell>
                <div className="font-medium">{upload.label}</div>
                <div className="text-zinc-500">{upload.required ? 'Required' : 'Optional'}</div>
              </TableCell>
              <TableCell>
                <Badge color={statusColor(upload.status)}>{upload.status.replaceAll('_', ' ')}</Badge>
              </TableCell>
              <TableCell>{upload.owner}</TableCell>
              <TableCell>{upload.files}</TableCell>
              <TableCell className="text-zinc-500">{upload.latestFilename ?? 'Not uploaded yet'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Subheading className="mt-10">Pipeline runs</Subheading>
      {statusView.parseRows.length === 0 ? (
        <Text className="mt-4">No uploaded files have been parsed yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Run</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Records</TableHeader>
              <TableHeader className="text-right">Errors</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {statusView.parseRows.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <div className="font-medium">{run.filename}</div>
                  <div className="text-zinc-500">{run.id}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(run.status)}>{run.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{run.recordCount}</TableCell>
                <TableCell className="text-right">{run.errorCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Uploaded file parses</Subheading>
      {statusView.parseRows.length === 0 ? (
        <Text className="mt-4">No uploaded files have been parsed yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>File</TableHeader>
              <TableHeader>Parser</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="text-right">Records</TableHeader>
              <TableHeader className="text-right">Errors</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {statusView.parseRows.map((job) => (
              <TableRow key={job.id}>
                <TableCell>
                  <div className="font-medium">{job.filename}</div>
                  <div className="text-zinc-500">{new Date(job.ranAt).toLocaleString('en-IE')}</div>
                </TableCell>
                <TableCell>{job.parser}</TableCell>
                <TableCell>
                  <Badge color={statusColor(job.status)}>{job.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell className="text-right">{job.recordCount}</TableCell>
                <TableCell className="text-right">{job.errorCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Normalized records</Subheading>
      {statusView.normalizedRecordRows.length === 0 ? (
        <Text className="mt-4">No normalized records have been saved yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>File</TableHeader>
              <TableHeader>Type</TableHeader>
              <TableHeader>Row</TableHeader>
              <TableHeader>Summary</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {statusView.normalizedRecordRows.map((record) => (
              <TableRow key={record.id}>
                <TableCell>{record.file}</TableCell>
                <TableCell>{record.recordType.replaceAll('_', ' ')}</TableCell>
                <TableCell>{record.sourceRowNumber ?? 'n/a'}</TableCell>
                <TableCell className="text-zinc-500">{record.summary}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Parse errors</Subheading>
      {statusView.parseErrors.length === 0 ? (
        <Text className="mt-4">No row-level parser errors have been recorded.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>File</TableHeader>
              <TableHeader>Row</TableHeader>
              <TableHeader>Error</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {statusView.parseErrors.map((error) => (
              <TableRow key={error.id}>
                <TableCell>{error.filename}</TableCell>
                <TableCell>{error.rowNumber}</TableCell>
                <TableCell className="text-zinc-500">{error.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function intakeStatusColor(status: string) {
  if (status === 'complete') {
    return 'green'
  }

  if (status === 'in_progress') {
    return 'amber'
  }

  return 'zinc'
}

function dataQualityColor(level: string) {
  if (level === 'excellent') {
    return 'green'
  }

  if (level === 'good') {
    return 'blue'
  }

  return 'amber'
}
