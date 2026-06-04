import { type PricingRule, type PricingRuleType } from './pricing-rules'
import { type ContractTerm } from './schemas'

export type PricingRuleComparisonStatus = 'matched' | 'mismatch' | 'missing_rule'

export type PricingRuleComparisonField =
  | 'meter'
  | 'unit'
  | 'billingPeriod'
  | 'rate'
  | 'allowance'
  | 'threshold'
  | 'discountPercent'
  | 'currency'
  | 'effectiveFrom'
  | 'effectiveTo'

export type PricingRuleComparisonDifference = {
  field: PricingRuleComparisonField
  contractTermValue: string | number | undefined
  pricingRuleValue: string | number | undefined
}

export type PricingRuleComparison = {
  term: ContractTerm
  pricingRule?: PricingRule
  status: PricingRuleComparisonStatus
  differences: PricingRuleComparisonDifference[]
}

export type PricingRuleComparisonSummary = {
  matched: number
  mismatch: number
  missingRule: number
  total: number
}

const comparableTermTypes = new Set<ContractTerm['type']>(['rate', 'allowance', 'overage_rate', 'discount'])

export function compareContractTermsToPricingRules(terms: ContractTerm[], pricingRules: PricingRule[]): PricingRuleComparison[] {
  const activeRules = pricingRules.filter((rule) => rule.status === 'active')

  return terms
    .filter(isComparableTerm)
    .map((term) => {
      const pricingRule = bestPricingRuleForTerm(term, activeRules)

      if (!pricingRule) {
        return {
          term,
          pricingRule: undefined,
          status: 'missing_rule' as const,
          differences: [],
        }
      }

      const differences = compareFields(term, pricingRule)

      return {
        term,
        pricingRule,
        status: differences.length === 0 ? ('matched' as const) : ('mismatch' as const),
        differences,
      }
    })
}

export function summarizePricingRuleComparisons(comparisons: PricingRuleComparison[]): PricingRuleComparisonSummary {
  return comparisons.reduce(
    (summary, comparison) => ({
      matched: summary.matched + (comparison.status === 'matched' ? 1 : 0),
      mismatch: summary.mismatch + (comparison.status === 'mismatch' ? 1 : 0),
      missingRule: summary.missingRule + (comparison.status === 'missing_rule' ? 1 : 0),
      total: summary.total + 1,
    }),
    { matched: 0, mismatch: 0, missingRule: 0, total: 0 },
  )
}

function isComparableTerm(term: ContractTerm): boolean {
  return term.status !== 'rejected' && comparableTermTypes.has(term.type)
}

function bestPricingRuleForTerm(term: ContractTerm, pricingRules: PricingRule[]): PricingRule | undefined {
  return pricingRules
    .filter((rule) => rule.type === term.type)
    .filter((rule) => customerScopesCompatible(term, rule))
    .filter((rule) => fieldsCompatible(term.meter, rule.meter))
    .map((rule) => ({ rule, score: pricingRuleMatchScore(term, rule) }))
    .sort((left, right) => right.score - left.score || left.rule.createdAt.localeCompare(right.rule.createdAt))[0]?.rule
}

function customerScopesCompatible(term: ContractTerm, rule: PricingRule): boolean {
  if (!rule.customerId) {
    return true
  }

  return normalizeString(term.customerId) === normalizeString(rule.customerId)
}

function fieldsCompatible(termValue: string | undefined, ruleValue: string | undefined): boolean {
  if (!termValue || !ruleValue) {
    return true
  }

  return normalizeString(termValue) === normalizeString(ruleValue)
}

function pricingRuleMatchScore(term: ContractTerm, rule: PricingRule): number {
  return [
    scoreStringMatch(term.customerId, rule.customerId, 8),
    scoreStringMatch(term.meter, rule.meter, 6),
    scoreStringMatch(term.unit, rule.unit, 3),
    scoreStringMatch(term.billingPeriod, rule.billingPeriod, 3),
    scoreStringMatch(term.effectiveFrom, rule.effectiveFrom, 1),
    scoreStringMatch(term.effectiveTo, rule.effectiveTo, 1),
  ].reduce((total, score) => total + score, 0)
}

function scoreStringMatch(left: string | undefined, right: string | undefined, score: number): number {
  if (!left || !right) {
    return 0
  }

  return normalizeString(left) === normalizeString(right) ? score : 0
}

function compareFields(term: ContractTerm, rule: PricingRule): PricingRuleComparisonDifference[] {
  return comparisonFieldsForType(rule.type)
    .map((field) => ({
      field,
      contractTermValue: comparableValue(term[field]),
      pricingRuleValue: comparableValue(rule[field]),
    }))
    .filter((difference) => comparableFieldValuesDiffer(difference.contractTermValue, difference.pricingRuleValue))
}

function comparisonFieldsForType(type: PricingRuleType): PricingRuleComparisonField[] {
  const sharedFields: PricingRuleComparisonField[] = ['meter', 'unit', 'billingPeriod']
  const dateFields: PricingRuleComparisonField[] = ['effectiveFrom', 'effectiveTo']

  if (type === 'rate') {
    return [...sharedFields, 'rate', 'currency', ...dateFields]
  }

  if (type === 'allowance') {
    return [...sharedFields, 'allowance', 'threshold', ...dateFields]
  }

  if (type === 'overage_rate') {
    return [...sharedFields, 'rate', 'threshold', 'currency', ...dateFields]
  }

  return ['discountPercent', ...dateFields]
}

function comparableValue(value: unknown): string | number | undefined {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }

  return undefined
}

function comparableFieldValuesDiffer(left: string | number | undefined, right: string | number | undefined): boolean {
  if (left === undefined && right === undefined) {
    return false
  }

  if (typeof left === 'number' || typeof right === 'number') {
    return left !== right
  }

  return normalizeString(left) !== normalizeString(right)
}

function normalizeString(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}
