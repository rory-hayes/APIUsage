import { extractCandidateContractTermsFromText, type ExtractContractTermsInput } from './contract-terms'
import { type ContractTerm } from './schemas'

export type ExpectedContractExtractionTerm = Partial<
  Pick<
    ContractTerm,
    | 'type'
    | 'customerId'
    | 'unit'
    | 'rate'
    | 'allowance'
    | 'creditAmount'
    | 'minimumAmount'
    | 'discountPercent'
    | 'currency'
    | 'effectiveFrom'
    | 'effectiveTo'
  >
> & {
  type: ContractTerm['type']
  metadata?: {
    summary?: string
  }
}

export type ContractExtractionEvalCase = ExtractContractTermsInput & {
  id: string
  name: string
  expectedTerms: ExpectedContractExtractionTerm[]
}

export type ContractExtractionFieldMismatch = {
  expectedTerm: ExpectedContractExtractionTerm
  actualTerm: ContractTerm
  field: string
  expectedValue: unknown
  actualValue: unknown
}

export type ContractExtractionEvalCaseResult = {
  caseId: string
  name: string
  passed: boolean
  expectedTermCount: number
  actualTermCount: number
  matchedTermCount: number
  missingTerms: ExpectedContractExtractionTerm[]
  unexpectedTerms: ContractTerm[]
  fieldMismatches: ContractExtractionFieldMismatch[]
}

export type ContractExtractionEvalSetResult = {
  cases: ContractExtractionEvalCaseResult[]
  summary: {
    caseCount: number
    passedCaseCount: number
    expectedTermCount: number
    matchedTermCount: number
    missingTermCount: number
    unexpectedTermCount: number
    fieldMismatchCount: number
  }
}

type ContractTermExtractor = (input: ExtractContractTermsInput) => ContractTerm[]

const comparedTermFields = [
  'type',
  'customerId',
  'unit',
  'rate',
  'allowance',
  'creditAmount',
  'minimumAmount',
  'discountPercent',
  'currency',
  'effectiveFrom',
  'effectiveTo',
] as const satisfies ReadonlyArray<keyof ExpectedContractExtractionTerm>

export const CONTRACT_EXTRACTION_EVAL_CASES: ContractExtractionEvalCase[] = [
  {
    id: 'enterprise_order_form_full_commercial_terms',
    name: 'Enterprise order form with allowance, overage, credits, minimum, discount, and rollover',
    organizationId: 'org_eval',
    workspaceId: 'workspace_eval',
    customerId: 'cus_enterprise',
    sourceFileId: 'src_eval_enterprise_order_form',
    text: [
      'Page 1: Effective from 2026-05-01 to 2027-04-30.',
      'Page 2: Included allowance: 10,000 API calls per month.',
      'Page 2: Overage charged at EUR 2.50 per 1k API calls.',
      'Page 3: Annual prepaid credit: EUR 50,000.',
      'Page 3: Monthly minimum commitment: EUR 20,000.',
      'Page 4: Discount: 15% until 2026-12-31.',
      'Page 5: Special term: customer may rollover unused credits for 60 days.',
    ].join('\n'),
    expectedTerms: [
      {
        type: 'allowance',
        customerId: 'cus_enterprise',
        allowance: 10000,
        unit: 'api_calls',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
      },
      {
        type: 'overage_rate',
        customerId: 'cus_enterprise',
        rate: 2.5,
        currency: 'eur',
        unit: '1k_api_calls',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
      },
      {
        type: 'credit',
        customerId: 'cus_enterprise',
        creditAmount: 50000,
        currency: 'eur',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
      },
      {
        type: 'minimum',
        customerId: 'cus_enterprise',
        minimumAmount: 20000,
        currency: 'eur',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
      },
      {
        type: 'discount',
        customerId: 'cus_enterprise',
        discountPercent: 15,
        effectiveFrom: '2026-05-01',
        effectiveTo: '2026-12-31',
      },
      {
        type: 'special_term',
        customerId: 'cus_enterprise',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2027-04-30',
        metadata: {
          summary: 'customer may rollover unused credits for 60 days.',
        },
      },
    ],
  },
  {
    id: 'usage_pricing_amendment',
    name: 'Usage pricing amendment with revised allowance and overage rate',
    organizationId: 'org_eval',
    workspaceId: 'workspace_eval',
    customerId: 'cus_amendment',
    sourceFileId: 'src_eval_usage_pricing_amendment',
    text: [
      'Page 1: Effective from 2026-07-01 to 2027-06-30.',
      'Page 2: Included allowance: 250,000 LLM tokens per month.',
      'Page 2: Overage charged at USD 1.75 per 1k LLM tokens.',
    ].join('\n'),
    expectedTerms: [
      {
        type: 'allowance',
        customerId: 'cus_amendment',
        allowance: 250000,
        unit: 'llm_tokens',
        effectiveFrom: '2026-07-01',
        effectiveTo: '2027-06-30',
      },
      {
        type: 'overage_rate',
        customerId: 'cus_amendment',
        rate: 1.75,
        currency: 'usd',
        unit: '1k_llm_tokens',
        effectiveFrom: '2026-07-01',
        effectiveTo: '2027-06-30',
      },
    ],
  },
  {
    id: 'discount_and_rollover_order_form',
    name: 'Order form with launch discount and rollover special term',
    organizationId: 'org_eval',
    workspaceId: 'workspace_eval',
    customerId: 'cus_discount',
    sourceFileId: 'src_eval_discount_order_form',
    text: [
      'Page 1: Effective from 2026-06-01 to 2026-12-31.',
      'Page 2: Discount: 20% through 2026-09-30.',
      'Page 3: Special term: unused monthly credits roll over for 30 days.',
    ].join('\n'),
    expectedTerms: [
      {
        type: 'discount',
        customerId: 'cus_discount',
        discountPercent: 20,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-09-30',
      },
      {
        type: 'special_term',
        customerId: 'cus_discount',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-12-31',
        metadata: {
          summary: 'unused monthly credits roll over for 30 days.',
        },
      },
    ],
  },
]

export function evaluateContractExtractionSet(
  cases: ContractExtractionEvalCase[],
  extractor: ContractTermExtractor = extractCandidateContractTermsFromText,
): ContractExtractionEvalSetResult {
  const results = cases.map((testCase) => evaluateContractExtractionCase(testCase, extractor))

  return {
    cases: results,
    summary: {
      caseCount: results.length,
      passedCaseCount: results.filter((result) => result.passed).length,
      expectedTermCount: sum(results, (result) => result.expectedTermCount),
      matchedTermCount: sum(results, (result) => result.matchedTermCount),
      missingTermCount: sum(results, (result) => result.missingTerms.length),
      unexpectedTermCount: sum(results, (result) => result.unexpectedTerms.length),
      fieldMismatchCount: sum(results, (result) => result.fieldMismatches.length),
    },
  }
}

export function evaluateContractExtractionCase(
  testCase: ContractExtractionEvalCase,
  extractor: ContractTermExtractor = extractCandidateContractTermsFromText,
): ContractExtractionEvalCaseResult {
  const actualTerms = extractor(testCase)
  const unmatchedActualTerms = new Set(actualTerms)
  const missingTerms: ExpectedContractExtractionTerm[] = []
  const fieldMismatches: ContractExtractionFieldMismatch[] = []
  let matchedTermCount = 0

  for (const expectedTerm of testCase.expectedTerms) {
    const actualTerm = bestActualTermMatch(expectedTerm, [...unmatchedActualTerms])

    if (!actualTerm) {
      missingTerms.push(expectedTerm)
      continue
    }

    unmatchedActualTerms.delete(actualTerm)
    matchedTermCount += 1
    fieldMismatches.push(...compareExpectedTermFields(expectedTerm, actualTerm))
  }

  return {
    caseId: testCase.id,
    name: testCase.name,
    passed: missingTerms.length === 0 && unmatchedActualTerms.size === 0 && fieldMismatches.length === 0,
    expectedTermCount: testCase.expectedTerms.length,
    actualTermCount: actualTerms.length,
    matchedTermCount,
    missingTerms,
    unexpectedTerms: [...unmatchedActualTerms],
    fieldMismatches,
  }
}

function bestActualTermMatch(expectedTerm: ExpectedContractExtractionTerm, actualTerms: ContractTerm[]): ContractTerm | undefined {
  return actualTerms
    .filter((actualTerm) => actualTerm.type === expectedTerm.type)
    .map((actualTerm) => ({ actualTerm, score: termMatchScore(expectedTerm, actualTerm) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.actualTerm
}

function termMatchScore(expectedTerm: ExpectedContractExtractionTerm, actualTerm: ContractTerm): number {
  return termIdentityFields(expectedTerm).reduce((score, field) => {
    return comparableValue(expectedTerm[field]) === comparableValue(actualTerm[field]) ? score + 1 : score
  }, 0)
}

function termIdentityFields(expectedTerm: ExpectedContractExtractionTerm): Array<keyof ExpectedContractExtractionTerm> {
  if (expectedTerm.type === 'discount') {
    return ['effectiveTo']
  }

  if (expectedTerm.type === 'special_term') {
    return ['effectiveTo']
  }

  const identityFields = ['customerId', 'unit', 'currency', 'effectiveFrom', 'effectiveTo'] as const

  return identityFields.filter((field) => expectedTerm[field] !== undefined)
}

function compareExpectedTermFields(expectedTerm: ExpectedContractExtractionTerm, actualTerm: ContractTerm): ContractExtractionFieldMismatch[] {
  const fieldMismatches = comparedTermFields
    .filter((field) => expectedTerm[field] !== undefined)
    .filter((field) => comparableValue(expectedTerm[field]) !== comparableValue(actualTerm[field]))
    .map((field) => ({
      expectedTerm,
      actualTerm,
      field,
      expectedValue: expectedTerm[field],
      actualValue: actualTerm[field],
    }))

  if (expectedTerm.metadata?.summary && actualTerm.metadata.summary !== expectedTerm.metadata.summary) {
    return [
      ...fieldMismatches,
      {
        expectedTerm,
        actualTerm,
        field: 'metadata.summary',
        expectedValue: expectedTerm.metadata.summary,
        actualValue: actualTerm.metadata.summary,
      },
    ]
  }

  return fieldMismatches
}

function comparableValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

function sum<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0)
}
