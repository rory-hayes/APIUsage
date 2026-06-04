import { describe, expect, it } from 'vitest'

import { renderFindingTicketCsv, renderFindingsCsv } from './findings-export'
import { findingSchema, type Finding } from './schemas'

describe('findings CSV export', () => {
  it('renders only customer-visible findings for customer exports without internal notes', () => {
    const csv = renderFindingsCsv(
      [
        finding({
          id: 'finding_visible',
          title: 'Usage, invoice, and "overage" mismatch',
          status: 'approved_internal',
          customerNote: 'Customer note with, comma',
          internalNote: 'Internal-only parser note.',
        }),
        finding({
          id: 'finding_draft',
          title: 'Hidden draft issue',
          status: 'draft',
          internalNote: 'Hidden internal draft note.',
        }),
      ],
      { audience: 'customer' },
    )

    expect(csv.split('\n')[0]).toBe(
      'id,title,category,customer,severity,status,expected_amount,actual_amount,variance_amount,currency,confidence,recommended_action,evidence_refs,customer_note,internal_note,reviewer_id',
    )
    expect(csv).toContain(
      'finding_visible,"Usage, invoice, and ""overage"" mismatch",usage_exists_no_invoice,Acme AI,high,approved_internal,500000,0,500000,eur,0.91,Review billing configuration before the close.,usage_record usage_001,"Customer note with, comma",,',
    )
    expect(csv).not.toContain('finding_draft')
    expect(csv).not.toContain('Internal-only')
  })

  it('renders all workspace findings for internal exports including internal review fields', () => {
    const csv = renderFindingsCsv(
      [
        finding({
          id: 'finding_visible',
          status: 'approved_internal',
          internalNote: 'Reviewed by finance.',
          reviewerId: 'internal_admin',
        }),
        finding({
          id: 'finding_draft',
          status: 'draft',
          internalNote: 'Needs invoice source row check.',
        }),
      ],
      { audience: 'internal' },
    )

    expect(csv).toContain('finding_visible')
    expect(csv).toContain('Reviewed by finance.')
    expect(csv).toContain('internal_admin')
    expect(csv).toContain('finding_draft')
    expect(csv).toContain('Needs invoice source row check.')
  })

  it('renders a single finding as a ticket-import CSV without internal notes for customer exports', () => {
    const csv = renderFindingTicketCsv(
      finding({
        id: 'finding_ticket_001',
        title: 'Usage, invoice, and "overage" mismatch',
        status: 'investigating',
        customerNote: 'Customer note with, comma',
        internalNote: 'Internal-only parser note.',
        assignment: {
          owner: 'engineering',
          assignedBy: 'user_customer',
          assignedAt: '2026-06-05T10:30:00.000Z',
        },
      }),
      {
        audience: 'customer',
        sourceUrl: 'https://app.example/workspaces/workspace_001/findings/finding_ticket_001',
        workspaceName: 'Acme May audit',
      },
    )

    expect(csv.split('\n')[0]).toBe(
      'summary,description,issue_type,priority,status,assignee_team,customer,workspace,source_url,labels,external_id',
    )
    expect(csv).toContain(
      '"Usage, invoice, and ""overage"" mismatch","Status: investigating\nSeverity: high\nVariance: 500000 eur\nRecommended action: Review billing configuration before the close.\nCustomer note: Customer note with, comma\nEvidence: usage_record usage_001",Task,High,investigating,engineering,Acme AI,Acme May audit,https://app.example/workspaces/workspace_001/findings/finding_ticket_001,usage-integrity;usage-exists-no-invoice,finding_ticket_001',
    )
    expect(csv).not.toContain('Internal-only')
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
    recommendedAction: 'Review billing configuration before the close.',
    customerNote: 'Customer-facing note.',
    internalNote: 'Internal parser note.',
    metadata: {
      customerName: 'Acme AI',
    },
    ...overrides,
  })
}
