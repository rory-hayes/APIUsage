import { getUnmappedAccountReport, type AccountMapping } from './account-mapping'
import { isCustomerVisibleFinding } from './evidence-pack'
import { getIntakeCompleteness, type IntakeCompleteness, type IntakeResponse } from './intake'
import { type ParsedRecord, type ParseJob } from './parse-jobs'
import { summarizeParsedRecord } from './parsed-record-display'
import {
  getWorkspaceRequiredUploadCategories,
  getWorkspaceRecurringUploadChecklist,
  type UploadCategory,
  type UploadChecklistItem,
  type UploadRecord,
  type UploadStatus,
} from './uploads'
import { type Finding } from './schemas'
import { type AuditWorkspace } from './workspaces'

export type WorkspaceStatusView = {
  workspace: {
    id: string
    name: string
    auditPeriod: string
    status: AuditWorkspace['status']
    statusLabel: string
    readinessPercent: number
  }
  intakeCompleteness: IntakeCompleteness
  lastIntakeUpdate?: string
  uploadSummary: {
    acceptedRequired: number
    missingRequired: number
    needsReviewRequired: number
    requiredTotal: number
  }
  uploadRows: Array<{
    category: UploadCategory
    label: string
    owner: string
    required: boolean
    status: UploadStatus
    files: number
    latestFilename?: string
    periodLabel?: string
    periodScope?: UploadChecklistItem['periodScope']
    rollsForward?: boolean
  }>
  findingSummary: {
    customerVisibleCount: number
    draftReviewCount: number
    evidencePackReady: boolean
    rejectedCount: number
  }
  dataQuality: {
    score: number
    level: 'excellent' | 'good' | 'needs_attention'
    completenessPercent: number
    parseSuccessPercent: number
    mappingCoveragePercent: number
    confidencePercent: number
  }
  parseRows: Array<{
    id: string
    filename: string
    parser: string
    status: ParseJob['status']
    recordCount: number
    errorCount: number
    ranAt: string
  }>
  normalizedRecordRows: Array<{
    id: string
    file: string
    recordType: ParsedRecord['recordType']
    sourceRowNumber?: number
    summary: string
  }>
  parseErrors: Array<{
    id: string
    filename: string
    rowNumber: number
    message: string
  }>
}

export type CustomerAuditHealth = 'blocked' | 'needs_attention' | 'on_track' | 'complete'

export type CustomerAuditStatusRow = {
  organizationId: string
  organizationName: string
  workspaceCount: number
  workspaces: AuditWorkspace[]
  latestWorkspace: WorkspaceStatusView['workspace'] & {
    createdAt: string
  }
  health: CustomerAuditHealth
  healthLabel: string
  statusReason: string
  uploadSummary: WorkspaceStatusView['uploadSummary']
  findingSummary: {
    customerInputCount: number
    customerVisibleCount: number
    highRiskOpenCount: number
    internalReviewCount: number
    openCount: number
  }
}

export function buildCustomerAuditStatusRows({
  workspaces,
  intakeResponses = [],
  parseJobs = [],
  parsedRecords = [],
  uploads = [],
  findings = [],
  accountMappings = [],
}: {
  workspaces: AuditWorkspace[]
  intakeResponses?: IntakeResponse[]
  parseJobs?: ParseJob[]
  parsedRecords?: ParsedRecord[]
  uploads?: UploadRecord[]
  findings?: Finding[]
  accountMappings?: AccountMapping[]
}): CustomerAuditStatusRow[] {
  const workspacesByOrganizationId = new Map<string, AuditWorkspace[]>()

  for (const workspace of workspaces) {
    workspacesByOrganizationId.set(workspace.organizationId, [...(workspacesByOrganizationId.get(workspace.organizationId) ?? []), workspace])
  }

  return [...workspacesByOrganizationId.entries()]
    .map(([organizationId, organizationWorkspaces]) => {
      const sortedWorkspaces = [...organizationWorkspaces].sort(sortWorkspacesNewestFirst)
      const latestWorkspace = sortedWorkspaces[0]
      const latestFindings = findings.filter((finding) => finding.workspaceId === latestWorkspace.id)
      const statusView = buildWorkspaceStatusView({
        workspace: latestWorkspace,
        intakeResponse: intakeResponses.find((response) => response.workspaceId === latestWorkspace.id) ?? null,
        parseJobs,
        parsedRecords,
        uploads,
        findings,
        accountMappings,
      })
      const findingSummary = summarizeCustomerStatusFindings(latestFindings)
      const health = getCustomerAuditHealth(statusView.uploadSummary, findingSummary, latestWorkspace.status)

      return {
        organizationId,
        organizationName: latestWorkspace.organizationName,
        workspaceCount: sortedWorkspaces.length,
        workspaces: sortedWorkspaces,
        latestWorkspace: {
          ...statusView.workspace,
          createdAt: latestWorkspace.createdAt,
        },
        health: health.health,
        healthLabel: health.label,
        statusReason: health.reason,
        uploadSummary: statusView.uploadSummary,
        findingSummary,
      }
    })
    .sort((a, b) => a.organizationName.localeCompare(b.organizationName))
}

export function buildWorkspaceStatusView({
  workspace,
  intakeResponse,
  parseJobs,
  parsedRecords,
  uploads = [],
  findings = [],
  accountMappings = [],
}: {
  workspace: AuditWorkspace
  intakeResponse: IntakeResponse | null
  parseJobs: ParseJob[]
  parsedRecords: ParsedRecord[]
  uploads?: UploadRecord[]
  findings?: Finding[]
  accountMappings?: AccountMapping[]
}): WorkspaceStatusView {
  const workspaceParseJobs = parseJobs.filter((job) => job.workspaceId === workspace.id)
  const workspaceParsedRecords = parsedRecords.filter((record) => record.workspaceId === workspace.id)
  const uploadChecklist = getWorkspaceRecurringUploadChecklist(uploads, workspace, getWorkspaceRequiredUploadCategories(workspace))
  const workspaceFindings = findings.filter((finding) => finding.workspaceId === workspace.id)
  const workspaceAccountMappings = accountMappings.filter((mapping) => mapping.workspaceId === workspace.id)
  const parseJobById = new Map(workspaceParseJobs.map((job) => [job.id, job]))
  const intakeCompleteness =
    intakeResponse?.workspaceId === workspace.id ? intakeResponse.completeness : getIntakeCompleteness({})
  const uploadSummary = summarizeUploads(uploadChecklist)

  return {
    workspace: {
      id: workspace.id,
      name: workspace.organizationName,
      auditPeriod: workspace.auditPeriod,
      status: workspace.status,
      statusLabel: workspace.status.replaceAll('_', ' '),
      readinessPercent: calculateReadinessPercent(intakeCompleteness, workspaceParseJobs),
    },
    intakeCompleteness,
    lastIntakeUpdate: intakeResponse?.workspaceId === workspace.id ? intakeResponse.updatedAt : undefined,
    uploadSummary,
    uploadRows: uploadChecklist.map((item) => ({
      category: item.category,
      label: item.label,
      owner: item.owner,
      required: item.required,
      status: item.status,
      files: item.files,
      latestFilename: item.latestUpload?.filename,
      periodLabel: item.periodLabel,
      periodScope: item.periodScope,
      rollsForward: item.rollsForward,
    })),
    findingSummary: summarizeFindings(workspaceFindings),
    dataQuality: calculateDataQuality({
      uploadSummary,
      parseJobs: workspaceParseJobs,
      parsedRecords: workspaceParsedRecords,
      accountMappings: workspaceAccountMappings,
      findings: workspaceFindings,
    }),
    parseRows: workspaceParseJobs.map((job) => ({
      id: job.id,
      filename: job.filename,
      parser: job.parser.replaceAll('_', ' '),
      status: job.status,
      recordCount: job.recordCount,
      errorCount: job.errorCount,
      ranAt: job.ranAt,
    })),
    normalizedRecordRows: workspaceParsedRecords.slice(0, 20).map((record) => ({
      id: record.id,
      file: parseJobById.get(record.jobId)?.filename ?? record.sourceFileId,
      recordType: record.recordType,
      sourceRowNumber: record.sourceRowNumber,
      summary: summarizeParsedRecord(record),
    })),
    parseErrors: workspaceParseJobs.flatMap((job) =>
      job.errors.map((error) => ({
        id: `${job.id}-${error.rowNumber}-${error.message}`,
        filename: job.filename,
        rowNumber: error.rowNumber,
        message: error.message,
      })),
    ),
  }
}

function calculateDataQuality({
  uploadSummary,
  parseJobs,
  parsedRecords,
  accountMappings,
  findings,
}: {
  uploadSummary: WorkspaceStatusView['uploadSummary']
  parseJobs: ParseJob[]
  parsedRecords: ParsedRecord[]
  accountMappings: AccountMapping[]
  findings: Finding[]
}): WorkspaceStatusView['dataQuality'] {
  const completenessPercent =
    uploadSummary.requiredTotal === 0 ? 0 : Math.round((uploadSummary.acceptedRequired / uploadSummary.requiredTotal) * 100)
  const parseSuccessPercent = parseProgressPercent(parseJobs)
  const mappingCoveragePercent = calculateMappingCoveragePercent(parsedRecords, accountMappings)
  const confidencePercent = calculateConfidencePercent(accountMappings, findings)
  const score = Math.round((completenessPercent + parseSuccessPercent + mappingCoveragePercent + confidencePercent) / 4)

  return {
    score,
    level: dataQualityLevel(score),
    completenessPercent,
    parseSuccessPercent,
    mappingCoveragePercent,
    confidencePercent,
  }
}

function calculateMappingCoveragePercent(parsedRecords: ParsedRecord[], accountMappings: AccountMapping[]): number {
  const activeMappings = accountMappings.filter((mapping) => mapping.status !== 'rejected')
  const unmappedReport = getUnmappedAccountReport(parsedRecords, activeMappings)
  const unmappedCount =
    unmappedReport.usageAccountIds.length +
    unmappedReport.stripeCustomerIds.length +
    unmappedReport.contractCustomerIds.length +
    unmappedReport.costAccountIds.length
  const total = activeMappings.length + unmappedCount

  return total === 0 ? 0 : Math.round((activeMappings.length / total) * 100)
}

function calculateConfidencePercent(accountMappings: AccountMapping[], findings: Finding[]): number {
  const values = [
    ...accountMappings.filter((mapping) => mapping.status !== 'rejected').map((mapping) => mapping.confidence),
    ...findings.map((finding) => finding.confidence),
  ]

  if (values.length === 0) {
    return 0
  }

  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100)
}

function dataQualityLevel(score: number): WorkspaceStatusView['dataQuality']['level'] {
  if (score >= 90) {
    return 'excellent'
  }

  if (score >= 75) {
    return 'good'
  }

  return 'needs_attention'
}

function summarizeUploads(uploadRows: ReturnType<typeof getWorkspaceRecurringUploadChecklist>): WorkspaceStatusView['uploadSummary'] {
  const requiredRows = uploadRows.filter((item) => item.required)

  return {
    acceptedRequired: requiredRows.filter((item) => item.status === 'accepted').length,
    missingRequired: requiredRows.filter((item) => item.status === 'missing').length,
    needsReviewRequired: requiredRows.filter((item) => item.status !== 'accepted' && item.status !== 'missing').length,
    requiredTotal: requiredRows.length,
  }
}

function summarizeFindings(findings: Finding[]): WorkspaceStatusView['findingSummary'] {
  const customerVisibleCount = findings.filter(isCustomerVisibleFinding).length

  return {
    customerVisibleCount,
    draftReviewCount: findings.filter(
      (finding) => finding.status === 'draft' || finding.status === 'needs_review' || finding.status === 'needs_customer_input',
    ).length,
    evidencePackReady: customerVisibleCount > 0,
    rejectedCount: findings.filter((finding) => finding.status === 'rejected').length,
  }
}

function summarizeCustomerStatusFindings(findings: Finding[]): CustomerAuditStatusRow['findingSummary'] {
  const openFindings = findings.filter(isOpenFinding)

  return {
    customerInputCount: findings.filter((finding) => finding.status === 'needs_customer_input').length,
    customerVisibleCount: findings.filter(isCustomerVisibleFinding).length,
    highRiskOpenCount: openFindings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high').length,
    internalReviewCount: findings.filter((finding) => finding.status === 'draft' || finding.status === 'needs_review').length,
    openCount: openFindings.length,
  }
}

function getCustomerAuditHealth(
  uploadSummary: WorkspaceStatusView['uploadSummary'],
  findingSummary: CustomerAuditStatusRow['findingSummary'],
  workspaceStatus: AuditWorkspace['status'],
): { health: CustomerAuditHealth; label: string; reason: string } {
  if (uploadSummary.missingRequired > 0) {
    return {
      health: 'blocked',
      label: 'Blocked',
      reason: `${formatCount(uploadSummary.missingRequired, 'required upload')} missing`,
    }
  }

  if (findingSummary.customerInputCount > 0) {
    return {
      health: 'blocked',
      label: 'Blocked',
      reason: `${formatCount(findingSummary.customerInputCount, 'finding')} awaiting customer input`,
    }
  }

  if (uploadSummary.needsReviewRequired > 0) {
    return {
      health: 'needs_attention',
      label: 'Needs attention',
      reason: `${formatCount(uploadSummary.needsReviewRequired, 'required upload')} awaiting internal review`,
    }
  }

  if (findingSummary.internalReviewCount > 0) {
    return {
      health: 'needs_attention',
      label: 'Needs attention',
      reason: `${formatCount(findingSummary.internalReviewCount, 'finding')} awaiting internal review`,
    }
  }

  if (findingSummary.highRiskOpenCount > 0) {
    return {
      health: 'needs_attention',
      label: 'Needs attention',
      reason: formatCount(findingSummary.highRiskOpenCount, 'high risk finding'),
    }
  }

  if (workspaceStatus === 'complete') {
    return {
      health: 'complete',
      label: 'Complete',
      reason: 'Latest audit complete',
    }
  }

  return {
    health: 'on_track',
    label: 'On track',
    reason: 'Latest audit progressing',
  }
}

function isOpenFinding(finding: Finding): boolean {
  return finding.status !== 'rejected' && finding.status !== 'ignored' && finding.status !== 'fixed' && finding.status !== 'closed'
}

function sortWorkspacesNewestFirst(a: AuditWorkspace, b: AuditWorkspace): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function calculateReadinessPercent(intakeCompleteness: IntakeCompleteness, parseJobs: ParseJob[]): number {
  return Math.round(intakeCompleteness.percentComplete * 0.7 + parseProgressPercent(parseJobs) * 0.3)
}

function parseProgressPercent(parseJobs: ParseJob[]): number {
  if (parseJobs.length === 0) {
    return 0
  }

  const score = parseJobs.reduce((total, job) => total + parseJobScore(job), 0)

  return Math.round(score / parseJobs.length)
}

function parseJobScore(job: ParseJob): number {
  if (job.status === 'complete') return 100
  if (job.status === 'completed_with_errors') return 65
  if (job.status === 'unsupported') return 25

  return 0
}
