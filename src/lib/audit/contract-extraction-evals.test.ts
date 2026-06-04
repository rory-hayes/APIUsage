import { describe, expect, it } from 'vitest'

import {
  CONTRACT_EXTRACTION_EVAL_CASES,
  evaluateContractExtractionCase,
  evaluateContractExtractionSet,
} from './contract-extraction-evals'

describe('contract extraction evaluation set', () => {
  it('ships representative contract and order-form cases with expected commercial terms', () => {
    expect(CONTRACT_EXTRACTION_EVAL_CASES).toHaveLength(3)
    expect(CONTRACT_EXTRACTION_EVAL_CASES.map((testCase) => testCase.id)).toEqual([
      'enterprise_order_form_full_commercial_terms',
      'usage_pricing_amendment',
      'discount_and_rollover_order_form',
    ])
    expect(new Set(CONTRACT_EXTRACTION_EVAL_CASES.flatMap((testCase) => testCase.expectedTerms.map((term) => term.type)))).toEqual(
      new Set(['allowance', 'overage_rate', 'credit', 'minimum', 'discount', 'special_term']),
    )
  })

  it('passes the shipped evaluation set against the current extractor', () => {
    const result = evaluateContractExtractionSet(CONTRACT_EXTRACTION_EVAL_CASES)

    expect(result.summary).toEqual({
      caseCount: 3,
      passedCaseCount: 3,
      expectedTermCount: 10,
      matchedTermCount: 10,
      missingTermCount: 0,
      unexpectedTermCount: 0,
      fieldMismatchCount: 0,
    })
    expect(result.cases.every((testCase) => testCase.passed)).toBe(true)
  })

  it('reports missing terms, unexpected terms, and field mismatches for extractor drift', () => {
    const [testCase] = CONTRACT_EXTRACTION_EVAL_CASES

    const result = evaluateContractExtractionCase(testCase, () => [
      {
        id: 'term_wrong_rate',
        organizationId: testCase.organizationId,
        workspaceId: testCase.workspaceId,
        type: 'overage_rate',
        rate: 9.99,
        currency: 'eur',
        unit: '1k_api_calls',
        status: 'candidate',
        metadata: {},
      },
      {
        id: 'term_unexpected_discount',
        organizationId: testCase.organizationId,
        workspaceId: testCase.workspaceId,
        type: 'discount',
        discountPercent: 99,
        status: 'candidate',
        metadata: {},
      },
    ])

    expect(result.passed).toBe(false)
    expect(result.missingTerms.map((term) => term.type)).toEqual(['allowance', 'credit', 'minimum', 'discount', 'special_term'])
    expect(result.unexpectedTerms.map((term) => term.type)).toEqual(['discount'])
    expect(result.fieldMismatches.map((mismatch) => mismatch.field)).toEqual(['customerId', 'rate', 'effectiveFrom', 'effectiveTo'])
    expect(result.fieldMismatches).toEqual(
      expect.arrayContaining([
        {
          expectedTerm: expect.objectContaining({ type: 'overage_rate', rate: 2.5 }),
          actualTerm: expect.objectContaining({ type: 'overage_rate', rate: 9.99 }),
          field: 'rate',
          expectedValue: 2.5,
          actualValue: 9.99,
        },
      ]),
    )
  })
})
