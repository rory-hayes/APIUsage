import { describe, expect, it } from 'vitest'

import { DEFAULT_RULE_TEMPLATES, resolveRuleTemplateSelection } from './rule-templates'

describe('rule templates', () => {
  it('exposes the V1 reconciliation checks as reusable default templates', () => {
    expect(DEFAULT_RULE_TEMPLATES.length).toBeGreaterThanOrEqual(10)
    expect(DEFAULT_RULE_TEMPLATES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'usage_without_invoice',
          category: 'revenue_leakage',
          findingCategory: 'usage_exists_no_invoice',
          defaultEnabled: true,
        }),
        expect.objectContaining({
          id: 'wrong_overage_rate',
          category: 'contract_billing',
          findingCategory: 'wrong_overage_rate',
          defaultEnabled: true,
        }),
        expect.objectContaining({
          id: 'cost_exceeds_revenue',
          category: 'margin_risk',
          findingCategory: 'cost_exceeds_revenue',
          defaultEnabled: true,
        }),
      ]),
    )
  })

  it('resolves selected template IDs in library order and ignores unknown IDs', () => {
    expect(resolveRuleTemplateSelection(['cost_exceeds_revenue', 'unknown_template', 'usage_without_invoice']).map((template) => template.id)).toEqual([
      'usage_without_invoice',
      'cost_exceeds_revenue',
    ])
  })

  it('defaults to every enabled template when no explicit selection is provided', () => {
    expect(resolveRuleTemplateSelection().map((template) => template.id)).toEqual(
      DEFAULT_RULE_TEMPLATES.filter((template) => template.defaultEnabled).map((template) => template.id),
    )
  })
})
