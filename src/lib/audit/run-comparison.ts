import { type RuleRun } from './rule-runs'

export type RuleRunComparison = {
  currentRunId: string
  previousRunId: string
  newFindingIds: string[]
  recurringFindingIds: string[]
  resolvedFindingIds: string[]
  counts: {
    new: number
    recurring: number
    resolved: number
  }
}

export function buildLatestRuleRunComparison(ruleRuns: RuleRun[]): RuleRunComparison | null {
  const comparableRuns = ruleRuns
    .filter((run) => run.status !== 'failed')
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())

  if (comparableRuns.length < 2) {
    return null
  }

  const [currentRun, previousRun] = comparableRuns
  const currentFindingIds = uniqueStrings(currentRun.output.findingIds)
  const previousFindingIds = uniqueStrings(previousRun.output.findingIds)
  const previousIdSet = new Set(previousFindingIds)
  const currentIdSet = new Set(currentFindingIds)
  const newFindingIds = currentFindingIds.filter((findingId) => !previousIdSet.has(findingId))
  const recurringFindingIds = currentFindingIds.filter((findingId) => previousIdSet.has(findingId))
  const resolvedFindingIds = previousFindingIds.filter((findingId) => !currentIdSet.has(findingId))

  return {
    currentRunId: currentRun.id,
    previousRunId: previousRun.id,
    newFindingIds,
    recurringFindingIds,
    resolvedFindingIds,
    counts: {
      new: newFindingIds.length,
      recurring: recurringFindingIds.length,
      resolved: resolvedFindingIds.length,
    },
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}
