import { isCustomerVisibleFinding } from './evidence-pack'
import { type Finding } from './schemas'

export type FindingsCsvAudience = 'customer' | 'internal'

const findingsCsvHeaders = [
  'id',
  'title',
  'category',
  'customer',
  'severity',
  'status',
  'expected_amount',
  'actual_amount',
  'variance_amount',
  'currency',
  'confidence',
  'recommended_action',
  'evidence_refs',
  'customer_note',
  'internal_note',
  'reviewer_id',
]

const findingTicketCsvHeaders = [
  'summary',
  'description',
  'issue_type',
  'priority',
  'status',
  'assignee_team',
  'customer',
  'workspace',
  'source_url',
  'labels',
  'external_id',
]

export function selectFindingsForCsvExport(findings: Finding[], audience: FindingsCsvAudience): Finding[] {
  return audience === 'customer' ? findings.filter(isCustomerVisibleFinding) : findings
}

export function renderFindingsCsv(findings: Finding[], { audience }: { audience: FindingsCsvAudience }): string {
  const rows = selectFindingsForCsvExport(findings, audience).map((finding) => [
    finding.id,
    finding.title,
    finding.category,
    customerLabel(finding),
    finding.severity,
    finding.status,
    finding.expectedAmount.toString(),
    finding.actualAmount.toString(),
    (finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount).toString(),
    finding.currency,
    finding.confidence.toString(),
    finding.recommendedAction,
    finding.evidenceRefs.map((ref) => `${ref.type} ${ref.sourceId}`).join('; '),
    finding.customerNote ?? '',
    audience === 'internal' ? finding.internalNote ?? '' : '',
    audience === 'internal' ? finding.reviewerId ?? '' : '',
  ])

  return [findingsCsvHeaders, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
}

export function renderFindingTicketCsv(
  finding: Finding,
  {
    audience,
    sourceUrl,
    workspaceName,
  }: {
    audience: FindingsCsvAudience
    sourceUrl: string
    workspaceName: string
  },
): string {
  const row = [
    finding.title,
    ticketDescription(finding, audience),
    'Task',
    priorityForSeverity(finding.severity),
    finding.status,
    finding.assignment?.owner ?? '',
    customerLabel(finding),
    workspaceName,
    sourceUrl,
    `usage-integrity;${finding.category.replaceAll('_', '-')}`,
    finding.id,
  ]

  return [findingTicketCsvHeaders, row].map((csvRow) => csvRow.map(escapeCsvCell).join(',')).join('\n')
}

function customerLabel(finding: Finding): string {
  const customerName = finding.metadata.customerName

  if (typeof customerName === 'string' && customerName.trim().length > 0) {
    return customerName
  }

  return finding.customerId ?? 'Needs mapping'
}

function ticketDescription(finding: Finding, audience: FindingsCsvAudience): string {
  const evidence = finding.evidenceRefs.map((ref) => `${ref.type} ${ref.sourceId}`).join('; ')
  const lines = [
    `Status: ${finding.status}`,
    `Severity: ${finding.severity}`,
    `Variance: ${finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount} ${finding.currency}`,
    `Recommended action: ${finding.recommendedAction}`,
    finding.customerNote ? `Customer note: ${finding.customerNote}` : undefined,
    audience === 'internal' && finding.internalNote ? `Internal note: ${finding.internalNote}` : undefined,
    `Evidence: ${evidence}`,
  ].filter((line): line is string => line !== undefined)

  return lines.join('\n')
}

function priorityForSeverity(severity: Finding['severity']): string {
  if (severity === 'critical') return 'Critical'
  if (severity === 'high') return 'High'
  if (severity === 'medium') return 'Medium'
  if (severity === 'low') return 'Low'

  return 'Info'
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}
