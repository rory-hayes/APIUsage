import { isCustomerVisibleFinding } from './evidence-pack'
import { type Finding } from './schemas'
import { type AuditWorkspace, type AuditWorkspacePeriod } from './workspaces'

export type PeriodComparisonSummary = {
  findingCount: number
  totalVarianceAmount: number
  highSeverityCount: number
}

export type PeriodComparisonCategoryRow = {
  category: Finding['category']
  label: string
  currentCount: number
  previousCount: number
  delta: number
}

export type PeriodFindingComparison = {
  currentPeriod: AuditWorkspacePeriod
  previousPeriod: AuditWorkspacePeriod
  current: PeriodComparisonSummary
  previous: PeriodComparisonSummary
  delta: PeriodComparisonSummary
  categoryRows: PeriodComparisonCategoryRow[]
}

export function buildPeriodFindingComparison({
  workspace,
  findings,
}: {
  workspace: AuditWorkspace
  findings: Finding[]
}): PeriodFindingComparison | null {
  const periods = [...workspace.monitoringPeriods].sort((left, right) => left.periodStart.localeCompare(right.periodStart))
  const currentPeriod = selectCurrentPeriod(periods)

  if (!currentPeriod) {
    return null
  }

  const currentIndex = periods.findIndex((period) => period.id === currentPeriod.id)
  const previousPeriod = currentIndex > 0 ? periods[currentIndex - 1] : undefined

  if (!previousPeriod) {
    return null
  }

  const visibleFindings = findings.filter(isCustomerVisibleFinding)
  const currentFindings = visibleFindings.filter((finding) => findingMatchesPeriod(finding, currentPeriod))
  const previousFindings = visibleFindings.filter((finding) => findingMatchesPeriod(finding, previousPeriod))
  const current = summarizeFindings(currentFindings)
  const previous = summarizeFindings(previousFindings)

  return {
    currentPeriod,
    previousPeriod,
    current,
    previous,
    delta: {
      findingCount: current.findingCount - previous.findingCount,
      totalVarianceAmount: current.totalVarianceAmount - previous.totalVarianceAmount,
      highSeverityCount: current.highSeverityCount - previous.highSeverityCount,
    },
    categoryRows: buildCategoryRows(currentFindings, previousFindings),
  }
}

function selectCurrentPeriod(periods: AuditWorkspacePeriod[]): AuditWorkspacePeriod | undefined {
  const activePeriods = periods.filter((period) => period.status === 'active')

  return activePeriods[activePeriods.length - 1] ?? periods[periods.length - 1]
}

function findingMatchesPeriod(finding: Finding, period: AuditWorkspacePeriod): boolean {
  const metadataPeriodId = metadataString(finding.metadata, ['periodId', 'monitoringPeriodId'])

  if (metadataPeriodId) {
    return metadataPeriodId === period.id
  }

  const periodStart = metadataDate(finding.metadata, ['periodStart', 'billingPeriodStart'])
  const periodEnd = metadataDate(finding.metadata, ['periodEnd', 'billingPeriodEnd'])

  if (!periodStart) {
    return false
  }

  return overlaps(periodStart, periodEnd ?? periodStart, period.periodStart, period.periodEnd)
}

function summarizeFindings(findings: Finding[]): PeriodComparisonSummary {
  return {
    findingCount: findings.length,
    totalVarianceAmount: findings.reduce((total, finding) => total + finding.varianceAmount, 0),
    highSeverityCount: findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high').length,
  }
}

function buildCategoryRows(currentFindings: Finding[], previousFindings: Finding[]): PeriodComparisonCategoryRow[] {
  const categories = new Set<Finding['category']>([
    ...currentFindings.map((finding) => finding.category),
    ...previousFindings.map((finding) => finding.category),
  ])

  return [...categories]
    .map((category) => {
      const currentCount = currentFindings.filter((finding) => finding.category === category).length
      const previousCount = previousFindings.filter((finding) => finding.category === category).length

      return {
        category,
        label: formatCategory(category),
        currentCount,
        previousCount,
        delta: currentCount - previousCount,
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata[key]

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }

  return undefined
}

function metadataDate(metadata: Record<string, unknown>, keys: string[]): string | undefined {
  const value = metadataString(metadata, keys)

  if (!value) {
    return undefined
  }

  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined
}

function overlaps(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return leftStart <= rightEnd && leftEnd >= rightStart
}

function formatCategory(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase())
}
