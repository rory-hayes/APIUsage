import { createUploadRecord, getUploadChecklist, reviewUploadRecord } from './uploads'

export const workspace = {
  name: 'Acme AI',
  auditPeriod: 'May 2026',
  billingSystem: 'Stripe',
  usageSource: 'Warehouse CSV',
  stage: 'Evidence review',
  readiness: 74,
  moneyAtRisk: 18750,
  targetMarginRisk: 6200,
}

const uploadedAt = new Date('2026-06-01T09:00:00.000Z')
const reviewedAt = new Date('2026-06-01T10:00:00.000Z')

export const uploadRecords = [
  reviewUploadRecord(
    createUploadRecord(
      {
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'contracts_order_forms',
        filename: 'acme-order-forms.zip',
        byteSize: 3_280_000,
        contentType: 'application/zip',
        storageKey: 'workspaces/workspace_acme_may_2026/contracts/acme-order-forms.zip',
        uploadedBy: 'user_finance',
      },
      uploadedAt,
    ),
    { status: 'accepted', reviewedBy: 'internal_admin', reviewNote: 'Signed order forms for active customers received.' },
    reviewedAt,
  ),
  reviewUploadRecord(
    createUploadRecord(
      {
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'pricing_docs',
        filename: 'pricing-and-packaging.pdf',
        byteSize: 680_000,
        contentType: 'application/pdf',
        storageKey: 'workspaces/workspace_acme_may_2026/pricing/pricing-and-packaging.pdf',
        uploadedBy: 'user_revops',
      },
      uploadedAt,
    ),
    { status: 'accepted', reviewedBy: 'internal_admin', reviewNote: 'Current public and private pricing received.' },
    reviewedAt,
  ),
  reviewUploadRecord(
    createUploadRecord(
      {
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'stripe_invoices_export',
        filename: 'stripe-invoices-may.csv',
        byteSize: 94_000,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_may_2026/stripe/stripe-invoices-may.csv',
        uploadedBy: 'user_finance',
      },
      uploadedAt,
    ),
    { status: 'accepted', reviewedBy: 'internal_admin' },
    reviewedAt,
  ),
  reviewUploadRecord(
    createUploadRecord(
      {
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'stripe_customers_export',
        filename: 'stripe-customers.csv',
        byteSize: 42_000,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_may_2026/stripe/stripe-customers.csv',
        uploadedBy: 'user_finance',
      },
      uploadedAt,
    ),
    { status: 'accepted', reviewedBy: 'internal_admin' },
    reviewedAt,
  ),
  reviewUploadRecord(
    createUploadRecord(
      {
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'stripe_subscriptions_export',
        filename: 'stripe-subscriptions.csv',
        byteSize: 51_000,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_may_2026/stripe/stripe-subscriptions.csv',
        uploadedBy: 'user_finance',
      },
      uploadedAt,
    ),
    { status: 'accepted', reviewedBy: 'internal_admin' },
    reviewedAt,
  ),
  createUploadRecord(
    {
      organizationId: 'org_acme',
      workspaceId: 'workspace_acme_may_2026',
      category: 'usage_csv',
      filename: 'usage-events-may.csv',
      byteSize: 1_860_000,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_acme_may_2026/usage/usage-events-may.csv',
      uploadedBy: 'user_engineering',
    },
    new Date('2026-06-01T10:30:00.000Z'),
  ),
  reviewUploadRecord(
    createUploadRecord(
      {
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'credits_allowances_csv',
        filename: 'credits-may.csv',
        byteSize: 18_000,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_may_2026/credits/credits-may.csv',
        uploadedBy: 'user_finance',
      },
      uploadedAt,
    ),
    { status: 'needs_clarification', reviewedBy: 'internal_admin', reviewNote: 'Missing prepaid credit expiry dates.' },
    reviewedAt,
  ),
]

export const uploadChecklist = getUploadChecklist(uploadRecords)

export const findings = [
  {
    id: 'F-001',
    customer: 'Brightline Labs',
    category: 'Usage above allowance',
    severity: 'high',
    expected: 9500,
    actual: 0,
    confidence: 0.91,
    status: 'approved',
    owner: 'Finance',
  },
  {
    id: 'F-002',
    customer: 'North Pier AI',
    category: 'Wrong overage rate',
    severity: 'medium',
    expected: 7200,
    actual: 4300,
    confidence: 0.84,
    status: 'draft',
    owner: 'RevOps',
  },
  {
    id: 'F-003',
    customer: 'TensorWorks',
    category: 'Cost exceeds revenue',
    severity: 'high',
    expected: 4800,
    actual: 0,
    confidence: 0.77,
    status: 'needs_review',
    owner: 'Engineering',
  },
] as const

export const intakeAnswers = [
  { label: 'Billing model', value: 'Base subscription + token overages + prepaid credits' },
  { label: 'Custom contracts', value: 'Yes, 11 active customers have non-standard terms' },
  { label: 'Month-end owner', value: 'Finance lead with engineering support' },
  { label: 'Manual reconciliation', value: 'Usage export compared to Stripe invoice preview' },
  { label: 'Cost tracking', value: 'Provider costs tracked monthly, not reliably by customer' },
] as const

export const runs = [
  { id: 'RUN-004', name: 'May pre-close reconciliation', status: 'reviewing', records: '18,402', findings: 3 },
  { id: 'RUN-003', name: 'Contract term extraction', status: 'complete', records: '14 terms', findings: 2 },
  { id: 'RUN-002', name: 'Stripe invoice import', status: 'complete', records: '286 lines', findings: 0 },
  { id: 'RUN-001', name: 'Usage CSV import', status: 'needs_mapping', records: '18,116 rows', findings: 0 },
] as const

export function formatCurrency(amount: number, currency = 'EUR') {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function statusColor(status: string) {
  if (
    status === 'accepted' ||
    status === 'approved' ||
    status === 'approved_internal' ||
    status === 'published' ||
    status === 'fixed' ||
    status === 'closed' ||
    status === 'complete'
  )
    return 'green'
  if (
    status === 'needs_review' ||
    status === 'needs_customer_input' ||
    status === 'needs_clarification' ||
    status === 'open' ||
    status === 'investigating' ||
    status === 'reviewing' ||
    status === 'completed_with_errors' ||
    status === 'in_progress'
  )
    return 'amber'
  if (status === 'draft' || status === 'duplicate' || status === 'monitoring' || status === 'unsupported') return 'blue'
  if (status === 'missing' || status === 'rejected' || status === 'failed' || status === 'critical' || status === 'high') return 'red'
  return 'zinc'
}
