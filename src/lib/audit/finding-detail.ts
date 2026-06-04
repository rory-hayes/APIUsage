import { isCustomerVisibleFinding } from './evidence-pack'
import { type ParsedRecord } from './parse-jobs'
import { summarizeParsedRecord } from './parsed-record-display'
import { type Finding, type FindingAssignment } from './schemas'

export type CustomerFindingEvidence = {
  type: Finding['evidenceRefs'][number]['type']
  sourceId: string
  summary: string
  sourceFileId?: string
  rowNumber?: number
  page?: number
}

export type CustomerFindingDetail = {
  id: string
  title: string
  customer: string
  severity: Finding['severity']
  status: Finding['status']
  expectedAmount: number
  actualAmount: number
  varianceAmount: number
  currency: string
  confidence: number
  customerNote?: string
  assignment?: FindingAssignment
  recommendedAction: string
  evidence: CustomerFindingEvidence[]
}

export function buildCustomerFindingDetail({
  finding,
  parsedRecords = [],
}: {
  finding: Finding
  parsedRecords?: ParsedRecord[]
}): CustomerFindingDetail | null {
  if (!isCustomerVisibleFinding(finding)) {
    return null
  }

  return {
    id: finding.id,
    title: finding.title,
    customer: readString(finding.metadata, 'customerName') ?? finding.customerId ?? 'Needs mapping',
    severity: finding.severity,
    status: finding.status,
    expectedAmount: finding.expectedAmount,
    actualAmount: finding.actualAmount,
    varianceAmount: finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount,
    currency: finding.currency,
    confidence: finding.confidence,
    customerNote: finding.customerNote,
    assignment: finding.assignment,
    recommendedAction: finding.recommendedAction,
    evidence: finding.evidenceRefs.map((ref) => toCustomerEvidence(ref, parsedRecords)),
  }
}

function toCustomerEvidence(
  ref: Finding['evidenceRefs'][number],
  parsedRecords: ParsedRecord[],
): CustomerFindingEvidence {
  const record = parsedRecords.find((candidate) => candidate.id === ref.sourceId || readString(candidate.data, 'id') === ref.sourceId)
  const firstSourceRef = readFirstSourceRef(record?.data)

  return {
    type: ref.type,
    sourceId: ref.sourceId,
    summary: record ? summarizeParsedRecord(record) : `${ref.type} ${ref.sourceId}`,
    sourceFileId: record?.sourceFileId ?? firstSourceRef?.sourceFileId,
    rowNumber: record?.sourceRowNumber ?? firstSourceRef?.rowNumber,
    page: firstSourceRef?.page,
  }
}

function readFirstSourceRef(data: Record<string, unknown> | undefined): { sourceFileId?: string; rowNumber?: number; page?: number } | undefined {
  const refs = data?.sourceRefs

  if (!Array.isArray(refs)) {
    return undefined
  }

  const first = refs.find((ref): ref is Record<string, unknown> => typeof ref === 'object' && ref !== null && !Array.isArray(ref))

  if (!first) {
    return undefined
  }

  return {
    sourceFileId: readString(first, 'sourceFileId'),
    rowNumber: readPositiveNumber(first, 'rowNumber'),
    page: readPositiveNumber(first, 'page'),
  }
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readPositiveNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]

  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
