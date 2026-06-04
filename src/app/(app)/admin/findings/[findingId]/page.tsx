import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/description-list'
import { Heading, Subheading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { formatMinorCurrency } from '@/lib/audit/evidence-pack'
import { summarizeParsedRecord } from '@/lib/audit/parsed-record-display'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { type Finding } from '@/lib/audit/schemas'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getFindingStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireInternalAdmin } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

export default async function AdminFindingDetailPage({ params }: { params: Promise<{ findingId: string }> }) {
  const { findingId } = await params
  const session = await requireInternalAdmin()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const [findings, parsedRecords] = await Promise.all([
    getFindingStore().listByWorkspace(workspace.id),
    getParsedRecordStore().listByWorkspace(workspace.id),
  ])
  const finding = findings.find((candidate) => candidate.id === findingId)

  if (!finding) {
    notFound()
  }

  const evidenceRows = finding.evidenceRefs.map((ref) => buildEvidenceRow(ref, parsedRecords))

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href="/admin" plain>
            Back to review queue
          </Button>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Badge color={statusColor(finding.severity)}>{finding.severity}</Badge>
            <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
          </div>
          <Heading className="mt-4">Finding review detail</Heading>
          <Text className="mt-2">
            {finding.title} · {workspace.organizationName} · {workspace.auditPeriod}
          </Text>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        <Metric label="Variance" value={formatMinorCurrency(finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount, finding.currency)} />
        <Metric label="Expected" value={formatMinorCurrency(finding.expectedAmount, finding.currency)} />
        <Metric label="Actual" value={formatMinorCurrency(finding.actualAmount, finding.currency)} />
        <Metric label="Confidence" value={`${Math.round(finding.confidence * 100)}%`} />
      </div>

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.55fr)]">
        <section>
          <Subheading>Evidence trail</Subheading>
          <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
            <TableHead>
              <TableRow>
                <TableHeader>Type</TableHeader>
                <TableHeader>Source</TableHeader>
                <TableHeader>Location</TableHeader>
                <TableHeader>Summary</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {evidenceRows.map((row) => (
                <TableRow key={`${row.type}:${row.sourceId}`}>
                  <TableCell>
                    <Badge color="blue">{row.type.replaceAll('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>{row.sourceId}</TableCell>
                  <TableCell className="text-zinc-500">{row.location}</TableCell>
                  <TableCell className="text-zinc-500">{row.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <aside>
          <Subheading>Review context</Subheading>
          <DescriptionList className="mt-4">
            <DescriptionTerm>Finding ID</DescriptionTerm>
            <DescriptionDetails>{finding.id}</DescriptionDetails>
            <DescriptionTerm>Customer</DescriptionTerm>
            <DescriptionDetails>{findingCustomerLabel(finding)}</DescriptionDetails>
            <DescriptionTerm>Category</DescriptionTerm>
            <DescriptionDetails>{finding.category.replaceAll('_', ' ')}</DescriptionDetails>
            <DescriptionTerm>Confidence</DescriptionTerm>
            <DescriptionDetails>{Math.round(finding.confidence * 100)}%</DescriptionDetails>
            <DescriptionTerm>Recommended action</DescriptionTerm>
            <DescriptionDetails>{finding.recommendedAction}</DescriptionDetails>
            <DescriptionTerm>Internal note</DescriptionTerm>
            <DescriptionDetails>{finding.internalNote ?? 'No internal note has been recorded.'}</DescriptionDetails>
            <DescriptionTerm>Customer note</DescriptionTerm>
            <DescriptionDetails>{finding.customerNote ?? 'No customer-facing note has been drafted.'}</DescriptionDetails>
          </DescriptionList>
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

function buildEvidenceRow(ref: Finding['evidenceRefs'][number], parsedRecords: ParsedRecord[]) {
  const record = parsedRecords.find((candidate) => candidate.id === ref.sourceId || readString(candidate.data, 'id') === ref.sourceId)
  const firstRef = firstSourceRef(record?.data)

  return {
    type: ref.type,
    sourceId: ref.sourceId,
    location: formatLocation(record, firstRef),
    summary: record ? summarizeParsedRecord(record) : `${ref.type} ${ref.sourceId}`,
  }
}

function formatLocation(record: ParsedRecord | undefined, sourceRef: { sourceFileId?: string; rowNumber?: number; page?: number } | undefined) {
  const parts = [
    record?.sourceFileId ?? sourceRef?.sourceFileId,
    record?.sourceRowNumber ?? sourceRef?.rowNumber ? `row ${record?.sourceRowNumber ?? sourceRef?.rowNumber}` : undefined,
    sourceRef?.page ? `page ${sourceRef.page}` : undefined,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : 'No source location'
}

function firstSourceRef(data: Record<string, unknown> | undefined): { sourceFileId?: string; rowNumber?: number; page?: number } | undefined {
  const refs = data?.sourceRefs

  if (!Array.isArray(refs)) {
    return undefined
  }

  const ref = refs.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))

  if (!ref) {
    return undefined
  }

  return {
    sourceFileId: readString(ref, 'sourceFileId'),
    rowNumber: readPositiveNumber(ref, 'rowNumber'),
    page: readPositiveNumber(ref, 'page'),
  }
}

function findingCustomerLabel(finding: Finding) {
  const customerName = finding.metadata.customerName

  return typeof customerName === 'string' && customerName.trim().length > 0 ? customerName : finding.customerId ?? 'Account not identified'
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readPositiveNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]

  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
