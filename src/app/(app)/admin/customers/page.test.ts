import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAppBillingRecord } from '@/lib/audit/app-billing'
import { createPilotConversionRecord } from '@/lib/audit/pilot-conversions'
import { parsedRecordSchema } from '@/lib/audit/parse-jobs'
import { createRuleRunRecord, RECONCILIATION_RULE_VERSION } from '@/lib/audit/rule-runs'
import {
  getFindingStore,
  getAppBillingStore,
  getContractTermStore,
  getInviteStore,
  getParsedRecordStore,
  getPilotConversionStore,
  getRuleRunStore,
  getStripeConnectionStore,
  getUploadStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { contractTermSchema, findingSchema } from '@/lib/audit/schemas'
import { createStripeConnection } from '@/lib/audit/stripe-connector'
import { createUploadRecord, reviewUploadRecord } from '@/lib/audit/uploads'
import { createWarehouseCsvConnection } from '@/lib/audit/warehouse-connector'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { createWorkspaceInvite } from '@/lib/auth/invites'

import AdminCustomersPage from './page'

const ORIGINAL_ENV = {
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_APP_BILLING_PATH: process.env.AUDIT_APP_BILLING_PATH,
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PILOT_CONVERSION_PATH: process.env.AUDIT_PILOT_CONVERSION_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_RULE_RUN_PATH: process.env.AUDIT_RULE_RUN_PATH,
  AUDIT_STRIPE_CONNECTION_PATH: process.env.AUDIT_STRIPE_CONNECTION_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WAREHOUSE_CONNECTION_PATH: process.env.AUDIT_WAREHOUSE_CONNECTION_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin customers page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-customers-page-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_APP_BILLING_PATH = join(tempDir, 'app-billing.json')
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PILOT_CONVERSION_PATH = join(tempDir, 'pilot-conversions.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
    process.env.AUDIT_RULE_RUN_PATH = join(tempDir, 'rule-runs.json')
    process.env.AUDIT_STRIPE_CONNECTION_PATH = join(tempDir, 'stripe-connections.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_WAREHOUSE_CONNECTION_PATH = join(tempDir, 'warehouse-connections.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('summarizes customer organizations with workspace and invite links', async () => {
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
          requiredUploadCategories: ['contracts_order_forms', 'usage_csv'],
          status: 'review',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
    )
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_july_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'July 2026 audit',
          auditPeriod: 'July 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          requiredUploadCategories: ['contracts_order_forms', 'usage_csv'],
          status: 'intake',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-03T09:00:00.000Z'),
      ),
    )
    await getInviteStore().save(
      createWorkspaceInvite(
        {
          email: 'finance@northstar.ai',
          name: 'Northstar Finance',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          role: 'customer_admin',
          workspaceId: 'workspace_northstar_june_2026',
          invitedBy: 'internal_admin',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
    )
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord(
          {
            organizationId: 'org_northstar',
            workspaceId: 'workspace_northstar_july_2026',
            category: 'contracts_order_forms',
            filename: 'northstar-order-form.pdf',
            byteSize: 256,
            contentType: 'application/pdf',
            storageKey: 'workspaces/workspace_northstar_july_2026/northstar-order-form.pdf',
            uploadedBy: 'user_customer',
          },
          new Date('2026-06-03T10:00:00.000Z'),
        ),
        { status: 'accepted', reviewedBy: 'internal_admin' },
        new Date('2026-06-03T11:00:00.000Z'),
      ),
    )
    await getUploadStore().save(
      createUploadRecord(
        {
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_july_2026',
          category: 'usage_csv',
          filename: 'northstar-usage.csv',
          byteSize: 256,
          contentType: 'text/csv',
          storageKey: 'workspaces/workspace_northstar_july_2026/northstar-usage.csv',
          uploadedBy: 'user_customer',
        },
        new Date('2026-06-03T10:15:00.000Z'),
      ),
    )
    await getFindingStore().saveMany([
      findingSchema.parse({
        id: 'finding_northstar_high_value_usage',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        category: 'usage_exists_no_invoice',
        severity: 'high',
        title: 'High value usage variance',
        expectedAmount: 900000,
        actualAmount: 100000,
        currency: 'eur',
        confidence: 0.91,
        status: 'accepted',
        evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
        recommendedAction: 'Review billing configuration before close.',
      }),
    ])
    await getRuleRunStore().save(
      createRuleRunRecord({
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        actorId: 'internal_admin',
        status: 'reviewing',
        ruleVersion: RECONCILIATION_RULE_VERSION,
        inputs: {
          ruleTemplateIds: ['usage_without_invoice'],
          parsedRecordCount: 10,
          contractTermCount: 1,
          accountMappingCount: 1,
        },
        output: {
          findingCount: 1,
          findingIds: ['finding_northstar_high_value_usage'],
          findingCategories: ['usage_exists_no_invoice'],
          suppressedFindingCount: 0,
        },
        errors: [],
        startedAt: new Date('2026-06-03T12:25:00.000Z'),
        completedAt: new Date('2026-06-03T12:30:00.000Z'),
      }),
    )
    await getPilotConversionStore().save(
      createPilotConversionRecord(
        {
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          auditFeeAmount: 1250000,
          monitoringOfferAmount: 300000,
          conversionStatus: 'converted',
          renewalDate: '2026-12-31',
          updatedBy: 'internal_admin',
        },
        new Date('2026-06-03T12:00:00.000Z'),
      ),
    )
    await getAppBillingStore().save(
      createAppBillingRecord(
        {
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          planId: 'monitoring',
          stripeCustomerId: 'cus_123',
          stripeInvoiceId: 'in_123',
          stripeInvoiceStatus: 'open',
          stripeHostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/in_123',
          stripeSubscriptionId: 'sub_123',
          stripeSubscriptionStatus: 'active',
          note: 'Monitoring retainer invoice sent in Stripe.',
          updatedBy: 'internal_admin',
        },
        new Date('2026-06-03T12:05:00.000Z'),
      ),
    )
    await getParsedRecordStore().saveMany([
      parsedRecordSchema.parse({
        id: 'parsed_northstar_invoice_1',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        jobId: 'parse_northstar',
        uploadId: 'upl_northstar_invoices',
        sourceFileId: 'src_northstar_invoices',
        recordType: 'invoice_line',
        data: {
          id: 'in_001:line_1',
          invoiceId: 'in_001',
        },
      }),
      parsedRecordSchema.parse({
        id: 'parsed_northstar_invoice_1_line_2',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        jobId: 'parse_northstar',
        uploadId: 'upl_northstar_invoices',
        sourceFileId: 'src_northstar_invoices',
        recordType: 'invoice_line',
        data: {
          id: 'in_001:line_2',
          invoiceId: 'in_001',
        },
      }),
      parsedRecordSchema.parse({
        id: 'parsed_northstar_invoice_2',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        jobId: 'parse_northstar',
        uploadId: 'upl_northstar_invoices',
        sourceFileId: 'src_northstar_invoices',
        recordType: 'invoice_line',
        data: {
          id: 'in_002:line_1',
          invoiceId: 'in_002',
        },
      }),
      parsedRecordSchema.parse({
        id: 'parsed_northstar_usage_1',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        jobId: 'parse_northstar_usage',
        uploadId: 'upl_northstar_usage',
        sourceFileId: 'src_northstar_usage',
        recordType: 'usage',
        data: {
          id: 'usage_001',
          meter: 'api_calls',
        },
      }),
      parsedRecordSchema.parse({
        id: 'parsed_northstar_usage_2',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        jobId: 'parse_northstar_usage',
        uploadId: 'upl_northstar_usage',
        sourceFileId: 'src_northstar_usage',
        recordType: 'usage',
        data: {
          id: 'usage_002',
          meter: 'api_calls',
        },
      }),
      parsedRecordSchema.parse({
        id: 'parsed_northstar_usage_3',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        jobId: 'parse_northstar_usage',
        uploadId: 'upl_northstar_usage',
        sourceFileId: 'src_northstar_usage',
        recordType: 'usage',
        data: {
          id: 'usage_003',
          meter: 'api_calls',
        },
      }),
    ])
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord(
          {
            organizationId: 'org_northstar',
            workspaceId: 'workspace_northstar_july_2026',
            category: 'contracts_order_forms',
            filename: 'northstar-amendment.pdf',
            byteSize: 128,
            contentType: 'application/pdf',
            storageKey: 'workspaces/workspace_northstar_july_2026/northstar-amendment.pdf',
            uploadedBy: 'user_customer',
          },
          new Date('2026-06-03T10:20:00.000Z'),
        ),
        { status: 'accepted', reviewedBy: 'internal_admin' },
        new Date('2026-06-03T10:25:00.000Z'),
      ),
    )
    await getContractTermStore().saveMany([
      contractTermSchema.parse({
        id: 'term_northstar_orphan_contract',
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_july_2026',
        type: 'minimum',
        minimumAmount: 500000,
        currency: 'eur',
        evidence: {
          sourceFileId: 'src_northstar_legacy_contract',
          page: 1,
          snippet: 'Minimum monthly commit: EUR 5,000.',
        },
      }),
    ])
    await getStripeConnectionStore().save(
      createStripeConnection(
        {
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_july_2026',
          accountLabel: 'Northstar Stripe live',
          secretKey: 'sk_live_northstar',
          connectedBy: 'internal_admin',
        },
        new Date('2026-06-03T10:30:00.000Z'),
      ),
    )
    await getWarehouseCsvConnectionStore().save(
      createWarehouseCsvConnection(
        {
          organizationId: 'org_northstar',
          workspaceId: 'workspace_northstar_july_2026',
          sourceLabel: 'Northstar usage warehouse',
          exportUrl: 'https://warehouse.example.com/northstar.csv',
          schedule: 'daily',
          connectedBy: 'internal_admin',
          usageCsvMapping: {
            accountId: 'account_id',
            meter: 'meter_name',
            quantity: 'total',
            unit: 'unit',
            periodStart: 'start',
            periodEnd: 'end',
          },
        },
        new Date('2026-06-03T10:35:00.000Z'),
      ),
    )

    const page = await AdminCustomersPage()
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Customers')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('org_northstar')
    expect(text).toContain('2 workspaces')
    expect(text).toContain('1 active invite')
    expect(text).toContain('July 2026')
    expect(text).toContain('Needs attention')
    expect(text).toContain('1 required upload awaiting internal review')
    expect(text).toContain('1 high risk finding')
    expect(text).toContain('Pilot conversion')
    expect(text).toContain('€12,500 audit fee')
    expect(text).toContain('€3,000 monitoring offer')
    expect(text).toContain('Converted')
    expect(text).toContain('Renewal 31 Dec 2026')
    expect(text).toContain('Stripe billing')
    expect(text).toContain('Monitoring')
    expect(text).toContain('Active')
    expect(text).toContain('cus_123')
    expect(text).toContain('Invoice in_123 · open')
    expect(text).toContain('Subscription sub_123 · active')
    expect(text).toContain('Usage metrics')
    expect(text).toContain('1h to upload')
    expect(text).toContain('3h 30m to first finding')
    expect(text).toContain('1 accepted finding')
    expect(text).toContain('€8,000 at risk')
    expect(text).toContain('Packaging metrics')
    expect(text).toContain('2 invoices')
    expect(text).toContain('3 usage rows')
    expect(text).toContain('3 contracts')
    expect(text).toContain('2 connected systems')
    expect(text).toContain('Stripe, Warehouse CSV')
    expect(controlNames).toEqual(
      expect.arrayContaining([
        'organizationId',
        'organizationName',
        'auditFeeAmount',
        'monitoringOfferAmount',
        'conversionStatus',
        'renewalDate',
        'planId',
        'stripeCustomerId',
        'stripeInvoiceId',
        'stripeInvoiceStatus',
        'stripeHostedInvoiceUrl',
        'stripeSubscriptionId',
        'stripeSubscriptionStatus',
        'note',
      ]),
    )
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/admin/workspaces/workspace_northstar_july_2026',
        '/admin/workspaces/workspace_northstar_june_2026',
      ]),
    )
  })
})

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
