import { describe, expect, it } from 'vitest'

import {
  buildEvidencePack,
  buildEvidencePackForWorkspace,
  isCustomerVisibleFinding,
  renderEvidencePackCsv,
  renderEvidencePackMarkdown,
  renderEvidencePackPdf,
  renderReadoutSummaryPdf,
} from './evidence-pack'
import { findingSchema, type Finding } from './schemas'
import { DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS } from './uploads'

describe('audit evidence pack generation', () => {
  const workspace = {
    name: 'Acme AI',
    auditPeriod: 'May 2026',
    billingSystem: 'Stripe',
    usageSource: 'Warehouse CSV',
  }

  it('builds an executive summary from customer-visible findings only', () => {
    const approved = finding({ id: 'finding_001', status: 'approved_internal', varianceAmount: 500000 })
    const draft = finding({ id: 'finding_002', status: 'draft', varianceAmount: 900000 })
    const rejected = finding({ id: 'finding_003', status: 'rejected', varianceAmount: 700000 })

    const pack = buildEvidencePack({
      workspace,
      findings: [approved, draft, rejected],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    expect(pack.summary).toEqual({
      workspaceName: 'Acme AI',
      auditPeriod: 'May 2026',
      generatedAt: '2026-06-01T15:00:00.000Z',
      findingCount: 1,
      totalVarianceAmount: 500000,
      highSeverityCount: 1,
      topIssues: [
        {
          category: 'usage_exists_no_invoice',
          label: 'Usage exists no invoice',
          findingCount: 1,
          totalVarianceAmount: 500000,
          highSeverityCount: 1,
        },
      ],
      rootCauses: [
        {
          rootCause: 'billing_config',
          label: 'Billing config',
          findingCount: 1,
          findingIds: ['finding_001'],
          totalVarianceAmount: 500000,
          highSeverityCount: 1,
        },
      ],
      actionPlan: [
        {
          findingId: 'finding_001',
          title: 'Billable usage has no matching invoice line',
          rootCause: 'billing_config',
          rootCauseLabel: 'Billing config',
          recommendedOwner: 'Billing operations owner',
          nextAction: 'Review billing configuration before the May close.',
          totalVarianceAmount: 500000,
          severity: 'high',
        },
      ],
      nextActions: [
        {
          action: 'Review billing configuration before the May close.',
          findingCount: 1,
          findingIds: ['finding_001'],
          totalVarianceAmount: 500000,
        },
      ],
    })
    expect(pack.findings).toHaveLength(1)
    expect(pack.findings[0].id).toBe('finding_001')
    expect(pack.findings[0].recommendedOwner).toBe('Billing operations owner')
    expect(pack.findings[0].nextAction).toBe('Review billing configuration before the May close.')
  })

  it('groups customer-visible findings by root cause taxonomy', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_data',
          category: 'missing_usage',
          title: 'Usage file was missing records',
          varianceAmount: 100000,
          severity: 'medium',
        }),
        finding({
          id: 'finding_contract',
          category: 'wrong_overage_rate',
          title: 'Contracted overage rate was not applied',
          varianceAmount: 450000,
        }),
        finding({
          id: 'finding_billing_config',
          category: 'usage_exists_no_invoice',
          title: 'Usage was not invoiced',
          varianceAmount: 300000,
        }),
        finding({
          id: 'finding_finance_process',
          category: 'late_usage_after_invoice_finalization',
          title: 'Usage arrived after invoice finalization',
          varianceAmount: 250000,
        }),
        finding({
          id: 'finding_cost_issue',
          category: 'cost_exceeds_revenue',
          title: 'Usage cost exceeded revenue',
          varianceAmount: 125000,
        }),
        finding({
          id: 'finding_hidden',
          category: 'duplicate_usage',
          title: 'Hidden duplicate usage',
          status: 'draft',
          varianceAmount: 900000,
        }),
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    expect(pack.findings.map((finding) => [finding.id, finding.rootCause, finding.rootCauseLabel])).toEqual([
      ['finding_data', 'data', 'Data'],
      ['finding_contract', 'contract', 'Contract'],
      ['finding_billing_config', 'billing_config', 'Billing config'],
      ['finding_finance_process', 'finance_process', 'Finance process'],
      ['finding_cost_issue', 'cost_issue', 'Cost issue'],
    ])
    expect(pack.summary.rootCauses).toEqual([
      {
        rootCause: 'data',
        label: 'Data',
        findingCount: 1,
        findingIds: ['finding_data'],
        totalVarianceAmount: 100000,
        highSeverityCount: 0,
      },
      {
        rootCause: 'contract',
        label: 'Contract',
        findingCount: 1,
        findingIds: ['finding_contract'],
        totalVarianceAmount: 450000,
        highSeverityCount: 1,
      },
      {
        rootCause: 'billing_config',
        label: 'Billing config',
        findingCount: 1,
        findingIds: ['finding_billing_config'],
        totalVarianceAmount: 300000,
        highSeverityCount: 1,
      },
      {
        rootCause: 'finance_process',
        label: 'Finance process',
        findingCount: 1,
        findingIds: ['finding_finance_process'],
        totalVarianceAmount: 250000,
        highSeverityCount: 1,
      },
      {
        rootCause: 'cost_issue',
        label: 'Cost issue',
        findingCount: 1,
        findingIds: ['finding_cost_issue'],
        totalVarianceAmount: 125000,
        highSeverityCount: 1,
      },
    ])
  })

  it('builds a workspace evidence pack from only that workspace findings', () => {
    const pack = buildEvidencePackForWorkspace({
      workspace: {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        currency: 'eur',
        requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
        monitoringPeriods: [
          {
            id: 'period_june_2026',
            label: 'June 2026',
            periodStart: '2026-06-01',
            periodEnd: '2026-06-30',
            status: 'active',
          },
        ],
        status: 'review',
        createdBy: 'internal_admin',
        createdAt: '2026-06-02T09:00:00.000Z',
      },
      findings: [
        finding({
          id: 'finding_acme_visible',
          organizationId: 'org_acme',
          workspaceId: 'workspace_acme_may_2026',
          status: 'approved_internal',
          metadata: { customerName: 'Acme AI' },
        }),
        finding({
          id: 'finding_northstar_visible',
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_june_2026',
          status: 'approved_internal',
          metadata: { customerName: 'Northstar AI' },
        }),
        finding({
          id: 'finding_northstar_draft',
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_june_2026',
          status: 'draft',
          metadata: { customerName: 'Northstar AI' },
        }),
      ],
      generatedAt: new Date('2026-06-02T10:00:00.000Z'),
    })

    expect(pack.workspace).toEqual({
      name: 'Northstar AI',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
    })
    expect(pack.summary).toMatchObject({
      workspaceName: 'Northstar AI',
      auditPeriod: 'June 2026',
      findingCount: 1,
      totalVarianceAmount: 500000,
    })
    expect(pack.findings.map((finding) => finding.id)).toEqual(['finding_northstar_visible'])
    expect(renderEvidencePackMarkdown(pack)).toContain('# Northstar AI Evidence Pack')
    expect(renderEvidencePackMarkdown(pack)).not.toContain('Acme AI')
  })

  it('ranks top issues and next actions by customer-visible variance', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_usage_001',
          category: 'usage_exists_no_invoice',
          status: 'approved_internal',
          varianceAmount: 300000,
          recommendedAction: 'Add missing usage to the invoice preview.',
        }),
        finding({
          id: 'finding_usage_002',
          category: 'usage_exists_no_invoice',
          status: 'published',
          varianceAmount: 200000,
          severity: 'medium',
          recommendedAction: 'Add missing usage to the invoice preview.',
        }),
        finding({
          id: 'finding_rate_001',
          category: 'wrong_overage_rate',
          status: 'approved_internal',
          varianceAmount: 750000,
          recommendedAction: 'Correct the overage rate before finalizing invoices.',
        }),
        finding({
          id: 'finding_hidden_001',
          category: 'cost_exceeds_revenue',
          status: 'draft',
          varianceAmount: 900000,
          recommendedAction: 'This hidden action should not appear.',
        }),
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    expect(pack.summary.topIssues).toEqual([
      {
        category: 'wrong_overage_rate',
        label: 'Wrong overage rate',
        findingCount: 1,
        totalVarianceAmount: 750000,
        highSeverityCount: 1,
      },
      {
        category: 'usage_exists_no_invoice',
        label: 'Usage exists no invoice',
        findingCount: 2,
        totalVarianceAmount: 500000,
        highSeverityCount: 1,
      },
    ])
    expect(pack.summary.nextActions).toEqual([
      {
        action: 'Correct the overage rate before finalizing invoices.',
        findingCount: 1,
        findingIds: ['finding_rate_001'],
        totalVarianceAmount: 750000,
      },
      {
        action: 'Add missing usage to the invoice preview.',
        findingCount: 2,
        findingIds: ['finding_usage_001', 'finding_usage_002'],
        totalVarianceAmount: 500000,
      },
    ])
  })

  it('builds an action plan with recommended owners and next actions by variance', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_billing_owner',
          category: 'usage_exists_no_invoice',
          title: 'Missing invoice line',
          varianceAmount: 300000,
          recommendedAction: 'Add missing usage to the invoice preview.',
        }),
        finding({
          id: 'finding_finance_owner',
          category: 'late_usage_after_invoice_finalization',
          title: 'Late usage after invoice close',
          varianceAmount: 650000,
          recommendedAction: 'Move late usage into the next close review.',
        }),
        finding({
          id: 'finding_cost_owner',
          category: 'cost_exceeds_revenue',
          title: 'Cost exceeds billed revenue',
          varianceAmount: 125000,
          recommendedAction: 'Review customer margin before renewal.',
        }),
        finding({
          id: 'finding_hidden',
          category: 'wrong_overage_rate',
          title: 'Hidden contract issue',
          status: 'draft',
          varianceAmount: 900000,
          recommendedAction: 'This hidden action should not appear.',
        }),
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    expect(pack.summary.actionPlan).toEqual([
      {
        findingId: 'finding_finance_owner',
        title: 'Late usage after invoice close',
        rootCause: 'finance_process',
        rootCauseLabel: 'Finance process',
        recommendedOwner: 'Finance operations owner',
        nextAction: 'Move late usage into the next close review.',
        totalVarianceAmount: 650000,
        severity: 'high',
      },
      {
        findingId: 'finding_billing_owner',
        title: 'Missing invoice line',
        rootCause: 'billing_config',
        rootCauseLabel: 'Billing config',
        recommendedOwner: 'Billing operations owner',
        nextAction: 'Add missing usage to the invoice preview.',
        totalVarianceAmount: 300000,
        severity: 'high',
      },
      {
        findingId: 'finding_cost_owner',
        title: 'Cost exceeds billed revenue',
        rootCause: 'cost_issue',
        rootCauseLabel: 'Cost issue',
        recommendedOwner: 'FinOps owner',
        nextAction: 'Review customer margin before renewal.',
        totalVarianceAmount: 125000,
        severity: 'high',
      },
    ])
  })

  it('renders customer notes, recommended actions, and evidence refs into Markdown', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_001',
          status: 'approved_internal',
          customerNote: 'We found May usage that may not have been included on your invoice.',
          internalNote: 'Internal-only parser and invoice review notes.',
        }),
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    const markdown = renderEvidencePackMarkdown(pack)

    expect(markdown).toContain('# Acme AI Evidence Pack')
    expect(markdown).toContain('- Customer-visible findings: 1')
    expect(markdown).toContain('- Total variance: €5,000.00')
    expect(markdown).toContain('## Top Issues')
    expect(markdown).toContain('- Usage exists no invoice: 1 finding, €5,000.00 variance')
    expect(markdown).toContain('## Root Causes')
    expect(markdown).toContain('- Billing config: 1 finding, €5,000.00 variance')
    expect(markdown).toContain('## Next Actions')
    expect(markdown).toContain('- Review billing configuration before the May close. (1 finding, €5,000.00 variance)')
    expect(markdown).toContain('## Action Plan')
    expect(markdown).toContain('- Billing operations owner: Review billing configuration before the May close. (finding_001, €5,000.00 variance)')
    expect(markdown).toContain('## Root Cause: Billing config')
    expect(markdown).toContain('## Finding: Billable usage has no matching invoice line')
    expect(markdown).toContain('- Category: Usage exists no invoice')
    expect(markdown).toContain('- Root cause: Billing config')
    expect(markdown).toContain('- Recommended owner: Billing operations owner')
    expect(markdown).toContain('- Next action: Review billing configuration before the May close.')
    expect(markdown).toContain('- Customer: Acme AI')
    expect(markdown).toContain('- Expected amount: €5,000.00')
    expect(markdown).toContain('- Actual amount: €0.00')
    expect(markdown).toContain('- Variance: €5,000.00')
    expect(markdown).toContain('- Evidence: usage_record usage_001')
    expect(markdown).toContain('We found May usage that may not have been included on your invoice.')
    expect(markdown).toContain('Review billing configuration before the May close.')
    expect(markdown).not.toContain('Internal-only')
  })

  it('includes saved intake answers in the Markdown evidence pack', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [],
      intakeAnswers: [
        {
          key: 'billing_model',
          label: 'Billing model',
          value: 'Enterprise platform fee plus metered API-call overages',
          required: true,
        },
        {
          key: 'close_process',
          label: 'Month-end close process',
          value: 'Finance reviews invoice previews before finalization.',
          required: true,
        },
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    const markdown = renderEvidencePackMarkdown(pack)

    expect(pack.intakeAnswers).toHaveLength(2)
    expect(markdown).toContain('## Intake Context')
    expect(markdown).toContain('- Billing model: Enterprise platform fee plus metered API-call overages')
    expect(markdown).toContain('- Month-end close process: Finance reviews invoice previews before finalization.')
  })

  it('renders customer-visible findings as escaped CSV without internal notes', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_001',
          title: 'Usage, invoice, and "overage" mismatch',
          status: 'approved_internal',
          customerNote: 'Customer note with, comma',
          internalNote: 'Internal-only parser and invoice review notes.',
        }),
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    const csv = renderEvidencePackCsv(pack)

    expect(csv.split('\n')[0]).toBe(
      'id,title,category,root_cause,customer,severity,status,expected_amount,actual_amount,variance_amount,currency,confidence,recommended_owner,next_action,evidence_refs,customer_note',
    )
    expect(csv).toContain(
      'finding_001,"Usage, invoice, and ""overage"" mismatch",usage_exists_no_invoice,Billing config,Acme AI,high,approved_internal,500000,0,500000,eur,0.91,Billing operations owner,Review billing configuration before the May close.,usage_record usage_001,"Customer note with, comma"',
    )
    expect(csv).not.toContain('Internal-only')
  })

  it('renders a PDF evidence pack without internal notes', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_001',
          status: 'approved_internal',
          customerNote: 'We found May usage that may not have been included on your invoice.',
          internalNote: 'Internal-only parser and invoice review notes.',
        }),
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    const pdf = renderEvidencePackPdf(pack)
    const text = new TextDecoder('latin1').decode(pdf)

    expect(text).toContain('%PDF-1.4')
    expect(text).toContain('Acme AI Evidence Pack')
    expect(text).toContain('Root causes')
    expect(text).toContain('Billing config: 1 finding')
    expect(text).toContain('Action plan')
    expect(text).toContain('Billing operations owner: Review billing configuration before the May close.')
    expect(text).toContain('Billable usage has no matching invoice line')
    expect(text).toContain('We found May usage')
    expect(text).not.toContain('Internal-only')
  })

  it('renders a concise customer-ready readout PDF summary', () => {
    const pack = buildEvidencePack({
      workspace,
      findings: [
        finding({
          id: 'finding_high_variance',
          title: 'High variance overage leak',
          status: 'approved_internal',
          varianceAmount: 950000,
          recommendedAction: 'Correct the overage rate before finalizing invoices.',
          customerNote: 'Customer-safe note for the high variance issue.',
          internalNote: 'Internal-only review notes.',
        }),
        finding({
          id: 'finding_lower_variance',
          title: 'Lower variance usage gap',
          status: 'published',
          varianceAmount: 100000,
          recommendedAction: 'Add missing usage to the invoice preview.',
        }),
        finding({
          id: 'finding_hidden_draft',
          title: 'Draft issue should stay internal',
          status: 'draft',
          varianceAmount: 750000,
        }),
      ],
      intakeAnswers: [
        {
          key: 'close_process',
          label: 'Month-end close process',
          value: 'Finance reviews invoice previews before finalization.',
          required: true,
        },
      ],
      generatedAt: new Date('2026-06-01T15:00:00.000Z'),
    })

    const pdf = renderReadoutSummaryPdf(pack)
    const text = new TextDecoder('latin1').decode(pdf)

    expect(text).toContain('%PDF-1.4')
    expect(text).toContain('Acme AI Readout Summary')
    expect(text).toContain('Executive summary')
    expect(text).toContain('Customer-visible findings: 2')
    expect(text).toContain('Top issue themes')
    expect(text).toContain('Root cause themes')
    expect(text).toContain('Billing config: 2 findings')
    expect(text).toContain('Recommended next actions')
    expect(text).toContain('Action plan')
    expect(text).toContain('Billing operations owner: Correct the overage rate before finalizing invoices.')
    expect(text).toContain('High variance overage leak')
    expect(text).toContain('Customer-safe note for the high variance issue.')
    expect(text).toContain('Month-end close process: Finance reviews invoice previews before finalization.')
    expect(text).not.toContain('Draft issue should stay internal')
    expect(text).not.toContain('Internal-only review notes')
    expect(text).not.toContain('Evidence: usage_record')
  })

  it('identifies customer-visible finding statuses', () => {
    expect(isCustomerVisibleFinding(finding({ status: 'approved_internal' }))).toBe(true)
    expect(isCustomerVisibleFinding(finding({ status: 'published' }))).toBe(true)
    expect(isCustomerVisibleFinding(finding({ status: 'open' }))).toBe(true)
    expect(isCustomerVisibleFinding(finding({ status: 'draft' }))).toBe(false)
    expect(isCustomerVisibleFinding(finding({ status: 'rejected' }))).toBe(false)
    expect(isCustomerVisibleFinding(finding({ status: 'monitoring' }))).toBe(true)
    expect(isCustomerVisibleFinding(finding({ status: 'ignored' }))).toBe(false)
  })
})

function finding(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    id: 'finding_001',
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    varianceAmount: 500000,
    currency: 'eur',
    confidence: 0.91,
    status: 'approved_internal',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before the May close.',
    customerNote: 'We found May usage that may not have been included on your invoice.',
    internalNote: 'Internal parser note.',
    metadata: {
      customerName: 'Acme AI',
    },
    ...overrides,
  })
}
