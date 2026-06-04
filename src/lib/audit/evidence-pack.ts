import { type Finding } from './schemas'
import { type IntakeAnswerListItem } from './intake'
import { type AuditWorkspace } from './workspaces'
import { findingAssignmentOwnerLabel } from './finding-assignment'

export type EvidencePackWorkspace = {
  name: string
  auditPeriod: string
  billingSystem: string
  usageSource: string
}

export type EvidencePackFinding = {
  id: string
  title: string
  category: Finding['category']
  rootCause: EvidencePackRootCause
  rootCauseLabel: string
  customer: string
  severity: Finding['severity']
  status: Finding['status']
  assignedOwner: string
  expectedAmount: number
  actualAmount: number
  varianceAmount: number
  currency: string
  confidence: number
  customerNote?: string
  recommendedOwner: string
  nextAction: string
  recommendedAction: string
  evidenceRefs: Finding['evidenceRefs']
}

export type EvidencePackRootCause = 'data' | 'contract' | 'billing_config' | 'finance_process' | 'cost_issue'

export type EvidencePackRootCauseGroup = {
  rootCause: EvidencePackRootCause
  label: string
  findingCount: number
  findingIds: string[]
  totalVarianceAmount: number
  highSeverityCount: number
}

export type EvidencePackTopIssue = {
  category: Finding['category']
  label: string
  findingCount: number
  totalVarianceAmount: number
  highSeverityCount: number
}

export type EvidencePackNextAction = {
  action: string
  findingCount: number
  findingIds: string[]
  totalVarianceAmount: number
}

export type EvidencePackActionPlanItem = {
  findingId: string
  title: string
  rootCause: EvidencePackRootCause
  rootCauseLabel: string
  recommendedOwner: string
  nextAction: string
  totalVarianceAmount: number
  severity: Finding['severity']
}

export type EvidencePack = {
  workspace: EvidencePackWorkspace
  summary: {
    workspaceName: string
    auditPeriod: string
    generatedAt: string
    findingCount: number
    totalVarianceAmount: number
    highSeverityCount: number
    topIssues: EvidencePackTopIssue[]
    rootCauses: EvidencePackRootCauseGroup[]
    actionPlan: EvidencePackActionPlanItem[]
    nextActions: EvidencePackNextAction[]
  }
  intakeAnswers: IntakeAnswerListItem[]
  findings: EvidencePackFinding[]
}

const customerVisibleStatuses = [
  'approved_internal',
  'published',
  'customer_reviewing',
  'open',
  'investigating',
  'accepted',
  'fixed',
  'monitoring',
  'closed',
]

const rootCauseDefinitions = [
  { rootCause: 'data', label: 'Data' },
  { rootCause: 'contract', label: 'Contract' },
  { rootCause: 'billing_config', label: 'Billing config' },
  { rootCause: 'finance_process', label: 'Finance process' },
  { rootCause: 'cost_issue', label: 'Cost issue' },
] as const satisfies Array<{ rootCause: EvidencePackRootCause; label: string }>

const rootCauseLabels = new Map(rootCauseDefinitions.map((definition) => [definition.rootCause, definition.label]))

const categoryRootCauses = {
  account_mapping_mismatch: 'data',
  cancelled_account_usage: 'finance_process',
  contract_terms_not_in_billing: 'contract',
  cost_exceeds_revenue: 'cost_issue',
  credit_burn_mismatch: 'billing_config',
  duplicate_usage: 'data',
  expired_discount_active: 'contract',
  internal_usage_billed: 'finance_process',
  invoice_without_usage: 'data',
  late_usage_after_invoice_finalization: 'finance_process',
  minimum_not_enforced: 'billing_config',
  missing_usage: 'data',
  paid_usage_marked_free: 'billing_config',
  usage_above_allowance_no_overage: 'billing_config',
  usage_exists_no_invoice: 'billing_config',
  wrong_overage_rate: 'contract',
} as const satisfies Record<Finding['category'], EvidencePackRootCause>

const rootCauseOwners = {
  billing_config: 'Billing operations owner',
  contract: 'Finance owner',
  cost_issue: 'FinOps owner',
  data: 'Data owner',
  finance_process: 'Finance operations owner',
} as const satisfies Record<EvidencePackRootCause, string>

export function buildEvidencePack({
  workspace,
  findings,
  intakeAnswers = [],
  generatedAt = new Date(),
}: {
  workspace: EvidencePackWorkspace
  findings: Finding[]
  intakeAnswers?: IntakeAnswerListItem[]
  generatedAt?: Date
}): EvidencePack {
  const visibleFindings = findings.filter(isCustomerVisibleFinding).map(toEvidencePackFinding)
  const topIssues = buildTopIssues(visibleFindings)
  const rootCauses = buildRootCauses(visibleFindings)
  const actionPlan = buildActionPlan(visibleFindings)
  const nextActions = buildNextActions(visibleFindings)

  return {
    workspace,
    summary: {
      workspaceName: workspace.name,
      auditPeriod: workspace.auditPeriod,
      generatedAt: generatedAt.toISOString(),
      findingCount: visibleFindings.length,
      totalVarianceAmount: visibleFindings.reduce((total, finding) => total + finding.varianceAmount, 0),
      highSeverityCount: visibleFindings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high').length,
      topIssues,
      rootCauses,
      actionPlan,
      nextActions,
    },
    intakeAnswers,
    findings: visibleFindings,
  }
}

export function buildEvidencePackForWorkspace({
  workspace,
  findings,
  intakeAnswers = [],
  generatedAt = new Date(),
}: {
  workspace: AuditWorkspace
  findings: Finding[]
  intakeAnswers?: IntakeAnswerListItem[]
  generatedAt?: Date
}): EvidencePack {
  return buildEvidencePack({
    workspace: {
      name: workspace.organizationName,
      auditPeriod: workspace.auditPeriod,
      billingSystem: workspace.billingSystem,
      usageSource: workspace.usageSource,
    },
    findings: findings.filter((finding) => finding.workspaceId === workspace.id),
    intakeAnswers,
    generatedAt,
  })
}

export function isCustomerVisibleFinding(finding: Finding): boolean {
  return customerVisibleStatuses.includes(finding.status)
}

export function renderEvidencePackMarkdown(pack: EvidencePack): string {
  const lines = [
    `# ${pack.workspace.name} Evidence Pack`,
    '',
    `Audit period: ${pack.workspace.auditPeriod}`,
    `Billing system: ${pack.workspace.billingSystem}`,
    `Usage source: ${pack.workspace.usageSource}`,
    `Generated: ${pack.summary.generatedAt}`,
    '',
    '## Executive Summary',
    '',
    `- Customer-visible findings: ${pack.summary.findingCount}`,
    `- Total variance: ${formatMinorCurrency(pack.summary.totalVarianceAmount, 'eur')}`,
    `- Critical/high findings: ${pack.summary.highSeverityCount}`,
  ]

  if (pack.summary.topIssues.length > 0) {
    lines.push('', '## Top Issues', '')

    for (const issue of pack.summary.topIssues) {
      lines.push(
        `- ${issue.label}: ${formatCount(issue.findingCount, 'finding')}, ${formatMinorCurrency(issue.totalVarianceAmount, 'eur')} variance`,
      )
    }
  }

  if (pack.summary.rootCauses.length > 0) {
    lines.push('', '## Root Causes', '')

    for (const rootCause of pack.summary.rootCauses) {
      lines.push(
        `- ${rootCause.label}: ${formatCount(rootCause.findingCount, 'finding')}, ${formatMinorCurrency(rootCause.totalVarianceAmount, 'eur')} variance`,
      )
    }
  }

  if (pack.summary.nextActions.length > 0) {
    lines.push('', '## Next Actions', '')

    for (const action of pack.summary.nextActions) {
      lines.push(
        `- ${action.action} (${formatCount(action.findingCount, 'finding')}, ${formatMinorCurrency(action.totalVarianceAmount, 'eur')} variance)`,
      )
    }
  }

  if (pack.summary.actionPlan.length > 0) {
    lines.push('', '## Action Plan', '')

    for (const item of pack.summary.actionPlan) {
      lines.push(
        `- ${item.recommendedOwner}: ${item.nextAction} (${item.findingId}, ${formatMinorCurrency(item.totalVarianceAmount, 'eur')} variance)`,
      )
    }
  }

  if (pack.intakeAnswers.length > 0) {
    lines.push('', '## Intake Context', '', ...pack.intakeAnswers.map((answer) => `- ${answer.label}: ${answer.value}`))
  }

  lines.push('', '## Findings')

  if (pack.findings.length === 0) {
    lines.push('', 'No approved findings are currently available for the evidence pack.')
    return lines.join('\n')
  }

  for (const rootCause of pack.summary.rootCauses) {
    lines.push('', `## Root Cause: ${rootCause.label}`)

    for (const finding of pack.findings.filter((candidate) => candidate.rootCause === rootCause.rootCause)) {
      lines.push(
        '',
        `## Finding: ${finding.title}`,
        '',
        `- ID: ${finding.id}`,
        `- Category: ${toIssueLabel(finding.category)}`,
        `- Root cause: ${finding.rootCauseLabel}`,
        `- Recommended owner: ${finding.recommendedOwner}`,
        `- Next action: ${finding.nextAction}`,
        `- Customer: ${finding.customer}`,
        `- Severity: ${finding.severity}`,
        `- Status: ${finding.status.replaceAll('_', ' ')}`,
        `- Expected amount: ${formatMinorCurrency(finding.expectedAmount, finding.currency)}`,
        `- Actual amount: ${formatMinorCurrency(finding.actualAmount, finding.currency)}`,
        `- Variance: ${formatMinorCurrency(finding.varianceAmount, finding.currency)}`,
        `- Confidence: ${Math.round(finding.confidence * 100)}%`,
        `- Recommended action: ${finding.recommendedAction}`,
        ...finding.evidenceRefs.map((ref) => `- Evidence: ${ref.type} ${ref.sourceId}`),
      )

      if (finding.customerNote) {
        lines.push('', finding.customerNote)
      }
    }
  }

  return lines.join('\n')
}

export function renderEvidencePackCsv(pack: EvidencePack): string {
  const headers = [
    'id',
    'title',
    'category',
    'root_cause',
    'customer',
    'severity',
    'status',
    'expected_amount',
    'actual_amount',
    'variance_amount',
    'currency',
    'confidence',
    'recommended_owner',
    'next_action',
    'evidence_refs',
    'customer_note',
  ]
  const rows = pack.findings.map((finding) => [
    finding.id,
    finding.title,
    finding.category,
    finding.rootCauseLabel,
    finding.customer,
    finding.severity,
    finding.status,
    finding.expectedAmount.toString(),
    finding.actualAmount.toString(),
    finding.varianceAmount.toString(),
    finding.currency,
    finding.confidence.toString(),
    finding.recommendedOwner,
    finding.nextAction,
    finding.evidenceRefs.map((ref) => `${ref.type} ${ref.sourceId}`).join('; '),
    finding.customerNote ?? '',
  ])

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n')
}

export function renderEvidencePackPdf(pack: EvidencePack): Uint8Array {
  return renderPdfDocument(evidencePackPdfLines(pack))
}

export function renderReadoutSummaryPdf(pack: EvidencePack): Uint8Array {
  return renderPdfDocument(readoutSummaryPdfLines(pack))
}

function renderPdfDocument(lines: string[]): Uint8Array {
  const content = [
    'BT',
    '/F1 12 Tf',
    '50 750 Td',
    ...lines.flatMap((line, index) => {
      const nextLine = index === 0 ? [] : ['0 -16 Td']

      return [...nextLine, `(${escapePdfString(line)}) Tj`]
    }),
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]

  for (const [index, object] of objects.entries()) {
    offsets.push(byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const xrefOffset = byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new TextEncoder().encode(pdf)
}

function readoutSummaryPdfLines(pack: EvidencePack): string[] {
  const lines = [
    `${pack.workspace.name} Readout Summary`,
    `Audit period: ${pack.workspace.auditPeriod}`,
    `Prepared: ${pack.summary.generatedAt}`,
    '',
    'Executive summary',
    `Customer-visible findings: ${pack.summary.findingCount}`,
    `Total variance: ${formatMinorCurrency(pack.summary.totalVarianceAmount, 'eur')}`,
    `Critical/high findings: ${pack.summary.highSeverityCount}`,
  ]

  if (pack.summary.topIssues.length > 0) {
    lines.push('', 'Top issue themes')
    for (const issue of pack.summary.topIssues.slice(0, 3)) {
      lines.push(`${issue.label}: ${formatCount(issue.findingCount, 'finding')}, ${formatMinorCurrency(issue.totalVarianceAmount, 'eur')} variance`)
    }
  }

  if (pack.summary.rootCauses.length > 0) {
    lines.push('', 'Root cause themes')
    for (const rootCause of pack.summary.rootCauses) {
      lines.push(`${rootCause.label}: ${formatCount(rootCause.findingCount, 'finding')}, ${formatMinorCurrency(rootCause.totalVarianceAmount, 'eur')} variance`)
    }
  }

  if (pack.summary.nextActions.length > 0) {
    lines.push('', 'Recommended next actions')
    for (const action of pack.summary.nextActions.slice(0, 3)) {
      lines.push(`${action.action} (${formatCount(action.findingCount, 'finding')})`)
    }
  }

  if (pack.summary.actionPlan.length > 0) {
    lines.push('', 'Action plan')
    for (const item of pack.summary.actionPlan.slice(0, 5)) {
      lines.push(`${item.recommendedOwner}: ${item.nextAction} (${formatMinorCurrency(item.totalVarianceAmount, 'eur')} variance)`)
    }
  }

  if (pack.findings.length > 0) {
    lines.push('', 'Priority findings')
    for (const finding of [...pack.findings].sort((left, right) => right.varianceAmount - left.varianceAmount).slice(0, 3)) {
      lines.push(`${finding.title}: ${formatMinorCurrency(finding.varianceAmount, finding.currency)} variance`)

      if (finding.customerNote) {
        lines.push(finding.customerNote)
      }
    }
  } else {
    lines.push('', 'Priority findings', 'No approved findings are currently available for the readout.')
  }

  if (pack.intakeAnswers.length > 0) {
    lines.push('', 'Customer context')
    for (const answer of pack.intakeAnswers.slice(0, 3)) {
      lines.push(`${answer.label}: ${answer.value}`)
    }
  }

  return lines.flatMap(wrapPdfLine).slice(0, 45)
}

function evidencePackPdfLines(pack: EvidencePack): string[] {
  const lines = [
    `${pack.workspace.name} Evidence Pack`,
    `Audit period: ${pack.workspace.auditPeriod}`,
    `Billing system: ${pack.workspace.billingSystem}`,
    `Usage source: ${pack.workspace.usageSource}`,
    `Customer-visible findings: ${pack.summary.findingCount}`,
    `Total variance: ${formatMinorCurrency(pack.summary.totalVarianceAmount, 'eur')}`,
    `Critical/high findings: ${pack.summary.highSeverityCount}`,
  ]

  if (pack.summary.topIssues.length > 0) {
    lines.push('Top issues')
    for (const issue of pack.summary.topIssues) {
      lines.push(`${issue.label}: ${formatCount(issue.findingCount, 'finding')}, ${formatMinorCurrency(issue.totalVarianceAmount, 'eur')} variance`)
    }
  }

  if (pack.summary.rootCauses.length > 0) {
    lines.push('Root causes')
    for (const rootCause of pack.summary.rootCauses) {
      lines.push(`${rootCause.label}: ${formatCount(rootCause.findingCount, 'finding')}, ${formatMinorCurrency(rootCause.totalVarianceAmount, 'eur')} variance`)
    }
  }

  if (pack.summary.nextActions.length > 0) {
    lines.push('Next actions')
    for (const action of pack.summary.nextActions) {
      lines.push(`${action.action} (${formatCount(action.findingCount, 'finding')}, ${formatMinorCurrency(action.totalVarianceAmount, 'eur')} variance)`)
    }
  }

  if (pack.summary.actionPlan.length > 0) {
    lines.push('Action plan')
    for (const item of pack.summary.actionPlan) {
      lines.push(`${item.recommendedOwner}: ${item.nextAction} (${item.findingId}, ${formatMinorCurrency(item.totalVarianceAmount, 'eur')} variance)`)
    }
  }

  if (pack.intakeAnswers.length > 0) {
    lines.push('Intake context')
    for (const answer of pack.intakeAnswers) {
      lines.push(`${answer.label}: ${answer.value}`)
    }
  }

  lines.push('Findings')

  if (pack.findings.length === 0) {
    lines.push('No approved findings are currently available for the evidence pack.')
    return lines.flatMap(wrapPdfLine)
  }

  for (const rootCause of pack.summary.rootCauses) {
    lines.push(`Root cause: ${rootCause.label}`)

    for (const finding of pack.findings.filter((candidate) => candidate.rootCause === rootCause.rootCause)) {
      lines.push(
        finding.title,
        `ID: ${finding.id}`,
        `Category: ${toIssueLabel(finding.category)}`,
        `Root cause: ${finding.rootCauseLabel}`,
        `Recommended owner: ${finding.recommendedOwner}`,
        `Next action: ${finding.nextAction}`,
        `Customer: ${finding.customer}`,
        `Severity: ${finding.severity}`,
        `Status: ${finding.status.replaceAll('_', ' ')}`,
        `Expected amount: ${formatMinorCurrency(finding.expectedAmount, finding.currency)}`,
        `Actual amount: ${formatMinorCurrency(finding.actualAmount, finding.currency)}`,
        `Variance: ${formatMinorCurrency(finding.varianceAmount, finding.currency)}`,
        `Confidence: ${Math.round(finding.confidence * 100)}%`,
        `Recommended action: ${finding.recommendedAction}`,
        ...finding.evidenceRefs.map((ref) => `Evidence: ${ref.type} ${ref.sourceId}`),
      )

      if (finding.customerNote) {
        lines.push(finding.customerNote)
      }
    }
  }

  return lines.flatMap(wrapPdfLine).slice(0, 45)
}

function buildTopIssues(findings: EvidencePackFinding[]): EvidencePackTopIssue[] {
  const byCategory = new Map<Finding['category'], EvidencePackTopIssue>()

  for (const finding of findings) {
    const current =
      byCategory.get(finding.category) ??
      ({
        category: finding.category,
        label: toIssueLabel(finding.category),
        findingCount: 0,
        totalVarianceAmount: 0,
        highSeverityCount: 0,
      } satisfies EvidencePackTopIssue)

    byCategory.set(finding.category, {
      ...current,
      findingCount: current.findingCount + 1,
      totalVarianceAmount: current.totalVarianceAmount + finding.varianceAmount,
      highSeverityCount: current.highSeverityCount + (finding.severity === 'critical' || finding.severity === 'high' ? 1 : 0),
    })
  }

  return [...byCategory.values()].sort(sortByVarianceThenCount).slice(0, 5)
}

function buildRootCauses(findings: EvidencePackFinding[]): EvidencePackRootCauseGroup[] {
  const byRootCause = new Map<EvidencePackRootCause, EvidencePackRootCauseGroup>()

  for (const finding of findings) {
    const current =
      byRootCause.get(finding.rootCause) ??
      ({
        rootCause: finding.rootCause,
        label: finding.rootCauseLabel,
        findingCount: 0,
        findingIds: [],
        totalVarianceAmount: 0,
        highSeverityCount: 0,
      } satisfies EvidencePackRootCauseGroup)

    byRootCause.set(finding.rootCause, {
      ...current,
      findingCount: current.findingCount + 1,
      findingIds: [...current.findingIds, finding.id],
      totalVarianceAmount: current.totalVarianceAmount + finding.varianceAmount,
      highSeverityCount: current.highSeverityCount + (finding.severity === 'critical' || finding.severity === 'high' ? 1 : 0),
    })
  }

  return rootCauseDefinitions.flatMap((definition) => {
    const group = byRootCause.get(definition.rootCause)

    return group ? [group] : []
  })
}

function buildActionPlan(findings: EvidencePackFinding[]): EvidencePackActionPlanItem[] {
  return findings
    .map(
      (finding) =>
        ({
          findingId: finding.id,
          title: finding.title,
          rootCause: finding.rootCause,
          rootCauseLabel: finding.rootCauseLabel,
          recommendedOwner: finding.recommendedOwner,
          nextAction: finding.nextAction,
          totalVarianceAmount: finding.varianceAmount,
          severity: finding.severity,
        }) satisfies EvidencePackActionPlanItem,
    )
    .sort(sortActionPlanItems)
}

function buildNextActions(findings: EvidencePackFinding[]): EvidencePackNextAction[] {
  const byAction = new Map<string, EvidencePackNextAction>()

  for (const finding of findings) {
    const action = finding.recommendedAction.trim()
    const current =
      byAction.get(action) ??
      ({
        action,
        findingCount: 0,
        findingIds: [],
        totalVarianceAmount: 0,
      } satisfies EvidencePackNextAction)

    byAction.set(action, {
      ...current,
      findingCount: current.findingCount + 1,
      findingIds: [...current.findingIds, finding.id],
      totalVarianceAmount: current.totalVarianceAmount + finding.varianceAmount,
    })
  }

  return [...byAction.values()].sort(sortByVarianceThenCount).slice(0, 5)
}

function sortByVarianceThenCount(
  left: { totalVarianceAmount: number; findingCount: number },
  right: { totalVarianceAmount: number; findingCount: number },
) {
  return right.totalVarianceAmount - left.totalVarianceAmount || right.findingCount - left.findingCount
}

function sortActionPlanItems(left: EvidencePackActionPlanItem, right: EvidencePackActionPlanItem) {
  return right.totalVarianceAmount - left.totalVarianceAmount || severityRank(right.severity) - severityRank(left.severity)
}

function severityRank(severity: Finding['severity']): number {
  switch (severity) {
    case 'critical':
      return 5
    case 'high':
      return 4
    case 'medium':
      return 3
    case 'low':
      return 2
    case 'info':
      return 1
  }
}

function toEvidencePackFinding(finding: Finding): EvidencePackFinding {
  const rootCause = toRootCause(finding.category)
  const nextAction = finding.recommendedAction

  return {
    id: finding.id,
    title: finding.title,
    category: finding.category,
    rootCause,
    rootCauseLabel: rootCauseLabels.get(rootCause) ?? rootCause,
    customer: readString(finding.metadata, 'customerName') ?? finding.customerId ?? 'Needs mapping',
    severity: finding.severity,
    status: finding.status,
    assignedOwner: findingAssignmentOwnerLabel(finding.assignment?.owner),
    expectedAmount: finding.expectedAmount,
    actualAmount: finding.actualAmount,
    varianceAmount: finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount,
    currency: finding.currency,
    confidence: finding.confidence,
    customerNote: finding.customerNote,
    recommendedOwner: recommendedOwnerForRootCause(rootCause),
    nextAction,
    recommendedAction: finding.recommendedAction,
    evidenceRefs: finding.evidenceRefs,
  }
}

function toRootCause(category: Finding['category']): EvidencePackRootCause {
  return categoryRootCauses[category]
}

function recommendedOwnerForRootCause(rootCause: EvidencePackRootCause): string {
  return rootCauseOwners[rootCause]
}

function toIssueLabel(category: Finding['category']): string {
  const label = category.replaceAll('_', ' ')

  return `${label[0]?.toUpperCase() ?? ''}${label.slice(1)}`
}

export function formatMinorCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

function wrapPdfLine(value: string): string[] {
  const sanitized = sanitizePdfText(value)
  const lines: string[] = []
  let current = sanitized

  while (current.length > 86) {
    const breakAt = Math.max(current.lastIndexOf(' ', 86), 40)
    lines.push(current.slice(0, breakAt).trim())
    current = current.slice(breakAt).trim()
  }

  lines.push(current)

  return lines
}

function sanitizePdfText(value: string): string {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, '')
}

function escapePdfString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
