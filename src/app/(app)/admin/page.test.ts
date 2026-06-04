import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import {
  getAuditLogStore,
  getContractTermStore,
  getFindingStore,
  getParsedRecordStore,
  getParseJobStore,
  getUploadStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { parseJobSchema, type ParsedRecord } from '@/lib/audit/parse-jobs'
import { contractTermSchema, findingSchema, type ContractTerm, type Finding } from '@/lib/audit/schemas'
import { createUploadRecord } from '@/lib/audit/uploads'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminPage from './page'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

vi.mock('@/lib/auth/server', () => ({
  requireInternalAdmin: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
  requireSession: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-page-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      name: 'Rory',
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('shows review data for the active workspace only', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    await getUploadStore().save(
      createUploadRecord({
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        category: 'usage_csv',
        filename: 'acme-usage.csv',
        byteSize: 128,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_acme_may_2026/usage_csv/acme-usage.csv',
        uploadedBy: 'user_customer',
      }),
    )
    await getUploadStore().save(
      createUploadRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        category: 'usage_csv',
        filename: 'northstar-usage.csv',
        byteSize: 256,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage.csv',
        uploadedBy: 'user_customer',
      }),
    )

    const page = await AdminPage()
    const text = collectText(page)

    expect(text).toContain('Northstar AI')
    expect(text).toContain('northstar-usage.csv')
    expect(text).toContain('Duplicate')
    expect(text).not.toContain('acme-usage.csv')
    expect(text).not.toContain('usage-events-may.csv')
    expect(text).not.toContain('May pre-close reconciliation')
  })

  it('uses the audited findings CSV export route for internal operators', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_june_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'June 2026 audit',
          auditPeriod: 'June 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          status: 'review',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
    )

    const page = await AdminPage()
    const hrefs = collectHrefs(page)

    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/findings/csv')
  })

  it('exposes stable section anchors for workspace-scoped admin routes', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_june_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'June 2026 audit',
          auditPeriod: 'June 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          status: 'review',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
    )

    const page = await AdminPage()

    expect(collectIds(page)).toEqual(
      expect.arrayContaining(['account-mappings', 'uploaded-files', 'contract-terms', 'draft-findings']),
    )
  })

  it('shows usage CSV mapping controls before running the parser', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    await getUploadStore().save(
      createUploadRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        category: 'usage_csv',
        filename: 'northstar-custom-usage.csv',
        byteSize: 256,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-custom-usage.csv',
        uploadedBy: 'user_northstar_finance',
      }),
    )

    const page = await AdminPage()
    const controlNames = collectControlNames(page)

    expect(controlNames).toEqual(
      expect.arrayContaining([
        'usageAccountIdColumn',
        'usageCustomerNameColumn',
        'usageMeterColumn',
        'usageQuantityColumn',
        'usageUnitColumn',
        'usagePeriodStartColumn',
        'usagePeriodEndColumn',
      ]),
    )
  })

  it('shows provider cost CSV mapping controls before running the parser', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    await getUploadStore().save(
      createUploadRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        category: 'provider_cost_csv',
        filename: 'northstar-custom-costs.csv',
        byteSize: 256,
        contentType: 'text/csv',
        storageKey: 'workspaces/workspace_northstar_june_2026/provider_cost_csv/northstar-custom-costs.csv',
        uploadedBy: 'user_northstar_finance',
      }),
    )

    const page = await AdminPage()
    const controlNames = collectControlNames(page)

    expect(controlNames).toEqual(
      expect.arrayContaining([
        'costAccountIdColumn',
        'costCustomerNameColumn',
        'costProviderColumn',
        'costProductColumn',
        'costModelColumn',
        'costAmountColumn',
        'costCurrencyColumn',
        'costPeriodStartColumn',
        'costPeriodEndColumn',
      ]),
    )
  })

  it('links parsed records back to their raw upload and source row', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    const upload = createUploadRecord({
      organizationId: northstarWorkspace.organizationId,
      workspaceId: northstarWorkspace.id,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      byteSize: 256,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage.csv',
      uploadedBy: 'user_northstar_finance',
    })
    await getUploadStore().save(upload)
    await getParseJobStore().save(
      parseJobSchema.parse({
        id: 'parse_northstar_usage',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        uploadId: upload.id,
        sourceFileId: upload.sourceFileId,
        filename: upload.filename,
        category: upload.category,
        parser: 'usage_csv',
        status: 'complete',
        recordCount: 1,
        errorCount: 0,
        errors: [],
        ranAt: '2026-06-02T11:00:00.000Z',
      }),
    )
    await getParsedRecordStore().saveMany([
      parsedUsageRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        jobId: 'parse_northstar_usage',
        uploadId: upload.id,
        sourceFileId: upload.sourceFileId,
      }),
    ])

    const page = await AdminPage()
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Source lineage')
    expect(text).toContain('northstar-usage.csv')
    expect(text).toContain('row 17')
    expect(hrefs.some((href) => href.startsWith(`/api/uploads/${encodeURIComponent(upload.id)}/download?token=`))).toBe(true)
  })

  it('keeps reviewed and rejected findings out of the draft review queue', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_actionable_draft',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Draft overage needs review',
        status: 'draft',
      }),
      finding({
        id: 'finding_false_positive_rejected',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Rejected false positive',
        status: 'rejected',
      }),
      finding({
        id: 'finding_approved_visible',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Approved visible finding',
        status: 'approved_internal',
      }),
    ])

    const page = await AdminPage()
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Draft overage needs review')
    expect(hrefs).toContain('/admin/findings/finding_actionable_draft')
    expect(text).toContain('Request more data')
    expect(text).not.toContain('Rejected false positive')
    expect(text).not.toContain('Approved visible finding')
  })

  it('exposes editable finding fields in the draft review form', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_editable_draft',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Editable draft finding',
        status: 'needs_review',
      }),
    ])

    const page = await AdminPage()
    const text = collectText(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Merge')
    expect(controlNames).toEqual(
      expect.arrayContaining([
        'findingId',
        'title',
        'severity',
        'expectedAmount',
        'actualAmount',
        'recommendedAction',
        'internalNote',
        'customerNote',
        'status',
        'sourceFindingId',
        'targetFindingId',
      ]),
    )
  })

  it('filters draft findings by status, severity, and category', async () => {
    const northstarWorkspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstarWorkspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_matching_rate',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Critical overage rate issue',
        status: 'needs_review',
        severity: 'critical',
        category: 'wrong_overage_rate',
      }),
      finding({
        id: 'finding_wrong_status',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Draft usage issue',
        status: 'draft',
        severity: 'critical',
        category: 'wrong_overage_rate',
      }),
      finding({
        id: 'finding_wrong_severity',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Medium overage issue',
        status: 'needs_review',
        severity: 'medium',
        category: 'wrong_overage_rate',
      }),
      finding({
        id: 'finding_wrong_category',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Critical cost issue',
        status: 'needs_review',
        severity: 'critical',
        category: 'cost_exceeds_revenue',
      }),
      finding({
        id: 'finding_approved_hidden',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Approved customer-visible issue',
        status: 'approved_internal',
        severity: 'critical',
        category: 'wrong_overage_rate',
      }),
    ])

    const page = await AdminPage({
      searchParams: Promise.resolve({
        findingCategory: 'wrong_overage_rate',
        findingSeverity: 'critical',
        findingStatus: 'needs_review',
      }),
    })
    const text = collectText(page)
    const controlNames = collectControlNames(page)

    expect(controlNames).toEqual(expect.arrayContaining(['findingStatus', 'findingSeverity', 'findingCategory']))
    expect(text).toContain('Critical overage rate issue')
    expect(text).not.toContain('Draft usage issue')
    expect(text).not.toContain('Medium overage issue')
    expect(text).not.toContain('Critical cost issue')
    expect(text).not.toContain('Approved customer-visible issue')
  })

  it('exposes a manual contract term form before extraction has candidates', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_june_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'June 2026 audit',
          auditPeriod: 'June 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          status: 'review',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
    )

    const page = await AdminPage()
    const text = collectText(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Add manual term')
    expect(controlNames).toEqual(
      expect.arrayContaining([
        'type',
        'customerId',
        'meter',
        'unit',
        'rate',
        'allowance',
        'creditAmount',
        'minimumAmount',
        'discountPercent',
        'currency',
        'effectiveFrom',
        'effectiveTo',
        'evidenceSourceFileId',
        'evidencePage',
        'evidenceSnippet',
        'note',
      ]),
    )
  })

  it('keeps contract term extraction in needs review until all terms are approved', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getContractTermStore().saveMany([
      contractTerm({
        id: 'term_northstar_candidate_overage',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'candidate',
      }),
    ])

    const page = await AdminPage()
    const text = collectText(page)

    expect(text).toContain('June 2026 contract term extractionneeds review')
    expect(text).not.toContain('June 2026 contract term extractioncomplete')
  })

  it('marks a clean reconciliation run complete when checks produced no findings', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getAuditLogStore().append(
      createAuditLogEvent(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          actorId: 'internal_admin',
          action: 'check_run',
          targetType: 'workspace',
          targetId: workspace.id,
          metadata: {
            findingCount: 0,
          },
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
    )

    const page = await AdminPage()
    const text = collectText(page)

    expect(text).toContain('June 2026 reconciliationcomplete')
    expect(text).not.toContain('June 2026 reconciliationneeds review')
  })

  it('does not flag missing optional uploads as attention items', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_june_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'June 2026 audit',
          auditPeriod: 'June 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          status: 'uploads',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
    )

    const page = await AdminPage()
    const text = collectText(page)

    expect(text).toContain('Product usage CSV')
    expect(text).not.toContain('Credits/allowances CSV')
    expect(text).not.toContain('Provider cost CSV')
    expect(text).not.toContain('Other supporting docs')
  })
})

function finding(input: Partial<Finding> & { id: string; organizationId: string; workspaceId: string; title: string; status: Finding['status'] }): Finding {
  return findingSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    category: input.category ?? 'usage_exists_no_invoice',
    severity: input.severity ?? 'medium',
    title: input.title,
    expectedAmount: 12_300,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.72,
    status: input.status,
    evidenceRefs: [{ type: 'usage_record', sourceId: `${input.id}_usage` }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: {
      customerName: 'Northstar AI',
    },
  })
}

function contractTerm(overrides: Partial<ContractTerm>): ContractTerm {
  return contractTermSchema.parse({
    id: 'term_northstar_overage',
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    customerId: 'acct_northstar',
    type: 'overage_rate',
    meter: 'api_calls',
    unit: '1k_calls',
    rate: 2.75,
    currency: 'eur',
    status: 'candidate',
    evidence: {
      sourceFileId: 'src_contract',
      page: 4,
      snippet: 'Overage charged at EUR 2.75 per 1k API calls.',
    },
    metadata: {},
    ...overrides,
  })
}

function parsedUsageRecord(input: {
  organizationId: string
  workspaceId: string
  jobId: string
  uploadId: string
  sourceFileId: string
}): ParsedRecord {
  return {
    id: 'parsed_northstar_usage_17',
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    uploadId: input.uploadId,
    sourceFileId: input.sourceFileId,
    recordType: 'usage',
    sourceRowNumber: 17,
    data: {
      customerName: 'Northstar AI',
      accountId: 'acct_northstar',
      meter: 'api_calls',
      quantity: 42000,
      unit: 'calls',
      sourceRefs: [{ sourceFileId: input.sourceFileId, rowNumber: 17 }],
    },
  }
}

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join('')
  }

  if (!isValidElement(node)) {
    return ''
  }

  return collectText((node.props as { children?: ReactNode }).children)
}

function collectHrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectHrefs)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; href?: string }

  return [...(props.href ? [props.href] : []), ...collectHrefs(props.children)]
}

function collectIds(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectIds)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; id?: string }

  return [...(props.id ? [props.id] : []), ...collectIds(props.children)]
}

function collectControlNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectControlNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }

  return [...(props.name ? [props.name] : []), ...collectControlNames(props.children)]
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
