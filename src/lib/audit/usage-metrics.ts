import { type RuleRun } from './rule-runs'
import { type Finding } from './schemas'
import { type UploadRecord } from './uploads'
import { type AuditWorkspace } from './workspaces'

export type WorkspaceUsageMetrics = {
  workspaceId: string
  timeToFirstUploadMinutes: number | null
  timeToFirstFindingMinutes: number | null
  acceptedFindingCount: number
  moneyAtRiskAmount: number
  currency: string
}

export function buildWorkspaceUsageMetrics({
  workspace,
  uploads,
  ruleRuns,
  findings,
}: {
  workspace: AuditWorkspace
  uploads: UploadRecord[]
  ruleRuns: RuleRun[]
  findings: Finding[]
}): WorkspaceUsageMetrics {
  const workspaceUploads = uploads.filter((upload) => upload.workspaceId === workspace.id)
  const workspaceRuleRuns = ruleRuns.filter((run) => run.workspaceId === workspace.id)
  const workspaceFindings = findings.filter((finding) => finding.workspaceId === workspace.id)
  const firstUpload = earliestByDate(workspaceUploads, (upload) => upload.uploadedAt)
  const firstFindingRun = earliestByDate(
    workspaceRuleRuns.filter((run) => run.output.findingCount > 0),
    (run) => run.completedAt,
  )

  return {
    workspaceId: workspace.id,
    timeToFirstUploadMinutes: firstUpload ? minutesBetween(workspace.createdAt, firstUpload.uploadedAt) : null,
    timeToFirstFindingMinutes: firstFindingRun ? minutesBetween(workspace.createdAt, firstFindingRun.completedAt) : null,
    acceptedFindingCount: workspaceFindings.filter((finding) => finding.status === 'accepted').length,
    moneyAtRiskAmount: workspaceFindings.reduce((total, finding) => total + moneyAtRiskForFinding(finding), 0),
    currency: workspace.currency,
  }
}

function moneyAtRiskForFinding(finding: Finding): number {
  if (finding.status === 'rejected' || finding.status === 'ignored' || finding.status === 'fixed' || finding.status === 'closed') {
    return 0
  }

  return Math.max(finding.varianceAmount ?? finding.expectedAmount - finding.actualAmount, 0)
}

function earliestByDate<T>(items: T[], getDate: (item: T) => string): T | undefined {
  return [...items].sort((a, b) => new Date(getDate(a)).getTime() - new Date(getDate(b)).getTime())[0]
}

function minutesBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
}
