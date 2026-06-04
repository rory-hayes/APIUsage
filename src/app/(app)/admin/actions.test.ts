import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_WORKSPACE_ID,
  getAccountMappingStore,
  getAppBillingStore,
  getAuditLogStore,
  getContractTermStore,
  getDataDictionaryStore,
  getFindingStore,
  getFindingSuppressionStore,
  getParsedRecordStore,
  getPilotConversionStore,
  getPricingRuleStore,
  getReminderEmailStore,
  getRuleRunStore,
  getReportBuilderConfigStore,
  getInviteStore,
  getUploadStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { type Finding, findingSchema } from '@/lib/audit/schemas'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { createPricingRule, updatePricingRule } from '@/lib/audit/pricing-rules'
import { createUploadRecord, reviewUploadRecord } from '@/lib/audit/uploads'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { createWorkspaceInvite } from '@/lib/auth/invites'
import { type Session } from '@/lib/auth/access'

import {
  addMonitoringPeriodAction,
  approveAccountMappingAction,
  createManualContractTermAction,
  saveDataDictionaryEntryAction,
  createWorkspaceAction,
  generateEvidencePackAction,
  mergeFindingAction,
  reviewFindingAction,
  reviewContractTermAction,
  runReconciliationAction,
  saveManualAccountMappingAction,
  saveAppBillingAction,
  savePilotConversionAction,
  saveReportBuilderAction,
  sendMissingUploadReminderAction,
  sendReadoutReminderAction,
  suggestAccountMappingsAction,
  updateFindingIssueStatusAction,
} from './actions'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`)
  }),
}))

const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  requireInternalAdmin: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: navigation.redirect,
}))

vi.mock('next/cache', () => ({
  revalidatePath: cache.revalidatePath,
}))

const ORIGINAL_ENV = {
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_APP_BILLING_PATH: process.env.AUDIT_APP_BILLING_PATH,
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_DATA_DICTIONARY_PATH: process.env.AUDIT_DATA_DICTIONARY_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_FINDING_SUPPRESSION_PATH: process.env.AUDIT_FINDING_SUPPRESSION_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PILOT_CONVERSION_PATH: process.env.AUDIT_PILOT_CONVERSION_PATH,
  AUDIT_PRICING_RULE_PATH: process.env.AUDIT_PRICING_RULE_PATH,
  AUDIT_REMINDER_EMAIL_PATH: process.env.AUDIT_REMINDER_EMAIL_PATH,
  AUDIT_REPORT_BUILDER_PATH: process.env.AUDIT_REPORT_BUILDER_PATH,
  AUDIT_RULE_RUN_PATH: process.env.AUDIT_RULE_RUN_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin actions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-actions-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_APP_BILLING_PATH = join(tempDir, 'app-billing.json')
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_DATA_DICTIONARY_PATH = join(tempDir, 'data-dictionary.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_FINDING_SUPPRESSION_PATH = join(tempDir, 'finding-suppressions.json')
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PILOT_CONVERSION_PATH = join(tempDir, 'pilot-conversions.json')
    process.env.AUDIT_PRICING_RULE_PATH = join(tempDir, 'pricing-rules.json')
    process.env.AUDIT_REMINDER_EMAIL_PATH = join(tempDir, 'reminder-emails.json')
    process.env.AUDIT_REPORT_BUILDER_PATH = join(tempDir, 'report-builder.json')
    process.env.AUDIT_RULE_RUN_PATH = join(tempDir, 'rule-runs.json')
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
    vi.clearAllMocks()
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates an invite-only customer workspace and refreshes the app shell workspace list', async () => {
    const formData = new FormData()
    formData.set('organizationId', 'org_aurora')
    formData.set('organizationName', 'Aurora API')
    formData.set('name', 'June 2026 audit')
    formData.set('auditPeriod', 'June 2026')
    formData.set('billingSystem', 'Stripe')
    formData.set('usageSource', 'Snowflake export')

    await expect(createWorkspaceAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin/workspaces')

    await expect(getWorkspaceStore().list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace_aurora_api_june_2026',
          organizationId: 'org_aurora',
          organizationName: 'Aurora API',
          name: 'June 2026 audit',
          auditPeriod: 'June 2026',
          billingSystem: 'Stripe',
          usageSource: 'Snowflake export',
          status: 'intake',
          createdBy: 'internal_admin',
        }),
      ]),
    )
    await expect(getAuditLogStore().listByWorkspace('workspace_aurora_api_june_2026')).resolves.toEqual([
      expect.objectContaining({
        action: 'workspace_created',
        actorId: 'internal_admin',
        organizationId: 'org_aurora',
        workspaceId: 'workspace_aurora_api_june_2026',
        targetId: 'workspace_aurora_api_june_2026',
        targetType: 'workspace',
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/workspaces')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/')
  })

  it('adds a monthly monitoring period to an existing workspace', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_may_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    const formData = new FormData()
    formData.set('workspaceId', workspace.id)
    formData.set('label', 'June 2026')
    formData.set('periodStart', '2026-06-01')
    formData.set('periodEnd', '2026-06-30')
    formData.set('status', 'planned')

    await expect(addMonitoringPeriodAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_may_2026',
    )

    await expect(getWorkspaceStore().getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      monitoringPeriods: [
        {
          id: 'period_may_2026',
          label: 'May 2026',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          status: 'active',
        },
        {
          id: 'period_june_2026',
          label: 'June 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          status: 'planned',
        },
      ],
    })
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'workspace_period_added',
        actorId: 'internal_admin',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        targetId: 'period_june_2026',
        targetType: 'workspace',
        metadata: expect.objectContaining({
          label: 'June 2026',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          status: 'planned',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/workspaces')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/workspaces/workspace_northstar_may_2026')
  })

  it('saves customer pilot conversion tracking from the admin customers page', async () => {
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
    const formData = new FormData()
    formData.set('organizationId', 'org_northstar')
    formData.set('organizationName', 'Northstar AI')
    formData.set('currency', 'eur')
    formData.set('auditFeeAmount', '12500')
    formData.set('monitoringOfferAmount', '3000')
    formData.set('conversionStatus', 'converted')
    formData.set('renewalDate', '2026-12-31')

    await expect(savePilotConversionAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin/customers')

    await expect(getPilotConversionStore().getByOrganization('org_northstar')).resolves.toMatchObject({
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      currency: 'eur',
      auditFeeAmount: 1250000,
      monitoringOfferAmount: 300000,
      conversionStatus: 'converted',
      renewalDate: '2026-12-31',
      updatedBy: 'internal_admin',
    })
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'pilot_conversion_saved',
        actorId: 'internal_admin',
        organizationId: 'org_northstar',
        workspaceId: northstarWorkspace.id,
        targetId: 'pilot_conversion_org_northstar',
        targetType: 'customer',
        metadata: expect.objectContaining({
          conversionStatus: 'converted',
          renewalDate: '2026-12-31',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/customers')
  })

  it('saves Stripe app billing tracking from the admin customers page', async () => {
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
    const formData = new FormData()
    formData.set('organizationId', 'org_northstar')
    formData.set('organizationName', 'Northstar AI')
    formData.set('planId', 'monitoring')
    formData.set('stripeCustomerId', 'cus_123')
    formData.set('stripeInvoiceId', 'in_123')
    formData.set('stripeInvoiceStatus', 'open')
    formData.set('stripeHostedInvoiceUrl', 'https://invoice.stripe.com/i/acct_test/in_123')
    formData.set('stripeSubscriptionId', 'sub_123')
    formData.set('stripeSubscriptionStatus', 'active')
    formData.set('note', 'Monitoring retainer invoice sent in Stripe.')

    await expect(saveAppBillingAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin/customers')

    await expect(getAppBillingStore().getByOrganization('org_northstar')).resolves.toMatchObject({
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      provider: 'stripe',
      planId: 'monitoring',
      stripeCustomerId: 'cus_123',
      stripeInvoiceId: 'in_123',
      stripeInvoiceStatus: 'open',
      stripeHostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/in_123',
      stripeSubscriptionId: 'sub_123',
      stripeSubscriptionStatus: 'active',
      billingStatus: 'active',
      note: 'Monitoring retainer invoice sent in Stripe.',
      updatedBy: 'internal_admin',
    })
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'app_billing_saved',
        actorId: 'internal_admin',
        organizationId: 'org_northstar',
        workspaceId: northstarWorkspace.id,
        targetType: 'customer',
        metadata: expect.objectContaining({
          planId: 'monitoring',
          stripeInvoiceStatus: 'open',
          stripeSubscriptionStatus: 'active',
          billingStatus: 'active',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/customers')
  })

  it('sends missing upload reminder emails to active workspace invitees', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        requiredUploadCategories: ['contracts_order_forms', 'usage_csv'],
        status: 'uploads',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getInviteStore().save(
      createWorkspaceInvite({
        email: 'finance@northstar.ai',
        name: 'Northstar Finance',
        organizationId: workspace.organizationId,
        organizationName: workspace.organizationName,
        role: 'customer_admin',
        workspaceId: workspace.id,
        invitedBy: 'internal_admin',
      }),
    )
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord({
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          category: 'contracts_order_forms',
          filename: 'northstar-order-form.pdf',
          byteSize: 256,
          contentType: 'application/pdf',
          storageKey: 'workspaces/workspace_northstar_june_2026/northstar-order-form.pdf',
          uploadedBy: 'user_customer',
        }),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )
    const formData = new FormData()
    formData.set('workspaceId', workspace.id)

    await expect(sendMissingUploadReminderAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026',
    )

    await expect(getReminderEmailStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        type: 'missing_uploads',
        recipientEmail: 'finance@northstar.ai',
        subject: 'Northstar AI June 2026 audit: 1 upload still needed',
        body: expect.stringContaining('Product usage CSV'),
        sentBy: 'internal_admin',
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'reminder_email_sent',
        actorId: 'internal_admin',
        targetType: 'reminder_email',
        metadata: expect.objectContaining({
          reminderType: 'missing_uploads',
          recipientCount: 1,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/workspaces/workspace_northstar_june_2026')
  })

  it('sends readout reminder emails for a scheduled readout date', async () => {
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
    await getInviteStore().save(
      createWorkspaceInvite({
        email: 'finance@northstar.ai',
        name: 'Northstar Finance',
        organizationId: workspace.organizationId,
        organizationName: workspace.organizationName,
        role: 'customer_admin',
        workspaceId: workspace.id,
        invitedBy: 'internal_admin',
      }),
    )
    const formData = new FormData()
    formData.set('workspaceId', workspace.id)
    formData.set('readoutDate', '2026-06-10')

    await expect(sendReadoutReminderAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026',
    )

    await expect(getReminderEmailStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        type: 'readout',
        recipientEmail: 'finance@northstar.ai',
        subject: 'Northstar AI June 2026 audit: readout on 10 Jun 2026',
        body: expect.stringContaining('10 Jun 2026'),
        metadata: {
          readoutDate: '2026-06-10',
        },
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'reminder_email_sent',
        targetType: 'reminder_email',
        metadata: expect.objectContaining({
          reminderType: 'readout',
          recipientCount: 1,
          readoutDate: '2026-06-10',
        }),
      }),
    ])
  })

  it('saves manual account mappings against the active workspace', async () => {
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
    const formData = new FormData()
    formData.set('displayName', 'Northstar AI')
    formData.set('usageAccountId', 'acct_northstar_usage')
    formData.set('stripeCustomerId', 'cus_northstar')
    formData.set('note', 'Matched from implementation notes')

    await expect(saveManualAccountMappingAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getAccountMappingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        displayName: 'Northstar AI',
        usageAccountId: 'acct_northstar_usage',
        stripeCustomerId: 'cus_northstar',
      },
    ])
    await expect(getAccountMappingStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        action: 'account_mapping_saved',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        actorId: 'internal_admin',
      },
    ])
  })

  it('saves manual account mappings against an explicit scoped workspace', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('displayName', 'Northstar AI')
    formData.set('usageAccountId', 'acct_northstar_usage')
    formData.set('stripeCustomerId', 'cus_northstar')
    formData.set('note', 'Matched from scoped mapping route')

    await expect(saveManualAccountMappingAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/mappings',
    )

    await expect(getAccountMappingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        displayName: 'Northstar AI',
        usageAccountId: 'acct_northstar_usage',
        stripeCustomerId: 'cus_northstar',
        note: 'Matched from scoped mapping route',
      },
    ])
    await expect(getAccountMappingStore().listByWorkspace(acmeWorkspace.id)).resolves.toEqual([])
  })

  it('saves data dictionary field meanings against an explicit scoped workspace', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('sourceCategory', 'usage_csv')
    formData.set('sourceField', 'meter_name')
    formData.set('normalizedField', 'meter')
    formData.set('dataType', 'string')
    formData.set('meaning', 'Northstar-specific usage meter from the warehouse export.')
    formData.set('exampleValue', 'llm_tokens')
    formData.set('notes', 'Confirmed with RevOps during onboarding.')

    await expect(saveDataDictionaryEntryAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/data-dictionary',
    )

    await expect(getDataDictionaryStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        sourceCategory: 'usage_csv',
        sourceField: 'meter_name',
        normalizedField: 'meter',
        dataType: 'string',
        meaning: 'Northstar-specific usage meter from the warehouse export.',
        exampleValue: 'llm_tokens',
        notes: 'Confirmed with RevOps during onboarding.',
        createdBy: 'internal_admin',
        updatedBy: 'internal_admin',
      },
    ])
    await expect(getDataDictionaryStore().listByWorkspace(acmeWorkspace.id)).resolves.toEqual([])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'data_dictionary_entry_saved',
        actorId: 'internal_admin',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        targetType: 'data_dictionary_entry',
        metadata: expect.objectContaining({
          sourceCategory: 'usage_csv',
          sourceField: 'meter_name',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith(`/admin/workspaces/${northstarWorkspace.id}/data-dictionary`)
  })

  it('suggests and approves account mappings against an explicit scoped workspace', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    await getParsedRecordStore().saveMany([
      usageIdentityRecord({
        id: 'usage_northstar',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        accountId: 'acct_northstar_usage',
        customerName: 'Northstar AI',
        domain: 'northstar.ai',
      }),
      invoiceIdentityRecord({
        id: 'invoice_northstar',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        externalCustomerId: 'cus_northstar',
        customerEmail: 'billing@northstar.ai',
      }),
      usageIdentityRecord({
        id: 'usage_acme',
        organizationId: acmeWorkspace.organizationId,
        workspaceId: acmeWorkspace.id,
        accountId: 'acct_acme_usage',
        customerName: 'Acme AI',
        domain: 'acme.ai',
      }),
      invoiceIdentityRecord({
        id: 'invoice_acme',
        organizationId: acmeWorkspace.organizationId,
        workspaceId: acmeWorkspace.id,
        externalCustomerId: 'cus_acme',
        customerEmail: 'billing@acme.ai',
      }),
    ])
    const suggestFormData = new FormData()
    suggestFormData.set('workspaceId', northstarWorkspace.id)

    await expect(suggestAccountMappingsAction(suggestFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/mappings',
    )

    const suggestedMappings = await getAccountMappingStore().listByWorkspace(northstarWorkspace.id)
    expect(suggestedMappings).toEqual([
      expect.objectContaining({
        workspaceId: northstarWorkspace.id,
        displayName: 'Northstar AI',
        status: 'suggested',
        usageAccountId: 'acct_northstar_usage',
        stripeCustomerId: 'cus_northstar',
      }),
    ])
    await expect(getAccountMappingStore().listByWorkspace(acmeWorkspace.id)).resolves.toEqual([])

    const approveFormData = new FormData()
    approveFormData.set('workspaceId', northstarWorkspace.id)
    approveFormData.set('mappingId', suggestedMappings[0].id)
    approveFormData.set('note', 'Approved from scoped mapping route')

    await expect(approveAccountMappingAction(approveFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/mappings',
    )

    await expect(getAccountMappingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: suggestedMappings[0].id,
        status: 'approved',
        reviewerId: 'internal_admin',
        note: 'Approved from scoped mapping route',
      },
    ])
  })

  it('logs a distinct publish event when an approved finding becomes customer-visible', async () => {
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
        id: 'finding_northstar_unbilled_overage',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Northstar unbilled overage',
      }),
    ])

    const formData = new FormData()
    formData.set('findingId', 'finding_northstar_unbilled_overage')
    formData.set('status', 'approved_internal')
    formData.set('internalNote', 'Evidence checked against usage and invoice exports')
    formData.set('customerNote', 'Create an adjustment invoice for missed overage usage')

    await expect(reviewFindingAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_northstar_unbilled_overage',
        status: 'approved_internal',
        reviewerId: 'internal_admin',
        customerNote: 'Create an adjustment invoice for missed overage usage',
      },
    ])
    const auditEvents = await getAuditLogStore().listByWorkspace(northstarWorkspace.id)

    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'finding_reviewed',
          actorId: 'internal_admin',
          organizationId: northstarWorkspace.organizationId,
          workspaceId: northstarWorkspace.id,
          targetId: 'finding_northstar_unbilled_overage',
          targetType: 'finding',
        }),
        expect.objectContaining({
          action: 'finding_published',
          actorId: 'internal_admin',
          organizationId: northstarWorkspace.organizationId,
          workspaceId: northstarWorkspace.id,
          targetId: 'finding_northstar_unbilled_overage',
          targetType: 'finding',
          metadata: expect.objectContaining({
            status: 'approved_internal',
            hasCustomerNote: true,
          }),
        }),
      ]),
    )
    expect(cache.revalidatePath).toHaveBeenCalledWith('/status')
  })

  it('applies operator edits to a finding before review', async () => {
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
        id: 'finding_northstar_editable',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Original system-generated title',
      }),
    ])

    const formData = new FormData()
    formData.set('findingId', 'finding_northstar_editable')
    formData.set('status', 'needs_review')
    formData.set('title', 'Edited overage finding for Northstar')
    formData.set('severity', 'critical')
    formData.set('expectedAmount', '305520')
    formData.set('actualAmount', '250000')
    formData.set('recommendedAction', 'Request usage confirmation before issuing an adjustment invoice.')
    formData.set('internalNote', 'Adjusted after checking the contract minimum.')
    formData.set('customerNote', 'Please confirm the committed usage period for this account.')

    await expect(reviewFindingAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_northstar_editable',
        status: 'needs_review',
        reviewerId: 'internal_admin',
        title: 'Edited overage finding for Northstar',
        severity: 'critical',
        expectedAmount: 305_520,
        actualAmount: 250_000,
        varianceAmount: 55_520,
        recommendedAction: 'Request usage confirmation before issuing an adjustment invoice.',
        internalNote: 'Adjusted after checking the contract minimum.',
        customerNote: 'Please confirm the committed usage period for this account.',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'finding_reviewed',
        metadata: expect.objectContaining({
          status: 'needs_review',
          changedFields: expect.arrayContaining(['actualAmount', 'expectedAmount', 'recommendedAction', 'severity', 'title']),
        }),
      }),
    ])
  })

  it('records request-more-data reviews without publishing the finding', async () => {
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
        id: 'finding_northstar_needs_input',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Northstar usage needs contract amendment',
      }),
    ])

    const formData = new FormData()
    formData.set('findingId', 'finding_northstar_needs_input')
    formData.set('status', 'needs_customer_input')
    formData.set('internalNote', 'Ask customer for the June committed-usage amendment.')
    formData.set('customerNote', 'Please send the signed June committed-usage amendment.')

    await expect(reviewFindingAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_northstar_needs_input',
        status: 'needs_customer_input',
        reviewerId: 'internal_admin',
        internalNote: 'Ask customer for the June committed-usage amendment.',
        customerNote: 'Please send the signed June committed-usage amendment.',
      },
    ])
    const auditEvents = await getAuditLogStore().listByWorkspace(northstarWorkspace.id)

    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: 'finding_reviewed',
        actorId: 'internal_admin',
        targetId: 'finding_northstar_needs_input',
        targetType: 'finding',
        metadata: expect.objectContaining({
          status: 'needs_customer_input',
          hasCustomerNote: true,
        }),
      }),
    ])
    expect(auditEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'finding_published',
        }),
      ]),
    )
  })

  it('teaches a suppression when a rejected finding is marked to suppress future matches', async () => {
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
    await getParsedRecordStore().saveMany([
      usageIdentityRecord({
        id: 'usage_manual_invoice_false_positive',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        accountId: 'acct_manual_invoice',
        customerName: 'Manual Invoice Co',
        domain: 'manual-invoice.example',
      }),
    ])
    const runFormData = new FormData()
    runFormData.set('workspaceId', northstarWorkspace.id)
    runFormData.append('ruleTemplateIds', 'usage_without_invoice')

    await expect(runReconciliationAction(runFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/runs',
    )

    const [draftFinding] = await getFindingStore().listByWorkspace(northstarWorkspace.id)
    const reviewFormData = new FormData()
    reviewFormData.set('workspaceId', northstarWorkspace.id)
    reviewFormData.set('findingId', draftFinding.id)
    reviewFormData.set('status', 'rejected')
    reviewFormData.set('internalNote', 'False positive: this account is invoiced manually.')
    reviewFormData.set('suppressFutureMatches', 'on')

    await expect(reviewFindingAction(reviewFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/findings',
    )

    await expect(getFindingSuppressionStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        category: 'usage_exists_no_invoice',
        status: 'active',
        createdBy: 'internal_admin',
        createdFromFindingId: draftFinding.id,
        reason: 'False positive: this account is invoiced manually.',
        fingerprint: {
          accountKey: 'acct_manual_invoice',
          customerName: 'Manual Invoice Co',
          meter: 'api_calls',
        },
      }),
    ])

    await expect(runReconciliationAction(runFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/runs',
    )

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: draftFinding.id,
        status: 'rejected',
      },
    ])
    const ruleRuns = await getRuleRunStore().listByWorkspace(northstarWorkspace.id)
    expect(ruleRuns[0]).toMatchObject({
      output: {
        findingCount: 0,
        findingIds: [],
        findingCategories: [],
        suppressedFindingCount: 1,
      },
    })
  })

  it('reviews findings against an explicit scoped workspace and redirects back to scoped findings', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_scoped_review',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Northstar scoped review',
        status: 'needs_review',
      }),
      finding({
        id: 'finding_acme_scoped_review',
        organizationId: acmeWorkspace.organizationId,
        workspaceId: acmeWorkspace.id,
        title: 'Acme scoped review should stay draft',
        status: 'needs_review',
      }),
    ])

    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('findingId', 'finding_northstar_scoped_review')
    formData.set('status', 'approved_internal')
    formData.set('title', 'Approved scoped Northstar review')
    formData.set('severity', 'critical')
    formData.set('expectedAmount', '500000')
    formData.set('actualAmount', '125000')
    formData.set('recommendedAction', 'Issue a scoped adjustment invoice.')
    formData.set('internalNote', 'Reviewed from workspace-scoped findings page.')
    formData.set('customerNote', 'Please approve the adjustment invoice.')

    await expect(reviewFindingAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/findings',
    )

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_northstar_scoped_review',
        status: 'approved_internal',
        reviewerId: 'internal_admin',
        title: 'Approved scoped Northstar review',
        severity: 'critical',
        expectedAmount: 500000,
        actualAmount: 125000,
        varianceAmount: 375000,
        recommendedAction: 'Issue a scoped adjustment invoice.',
        internalNote: 'Reviewed from workspace-scoped findings page.',
        customerNote: 'Please approve the adjustment invoice.',
      },
    ])
    await expect(getFindingStore().listByWorkspace(acmeWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_acme_scoped_review',
        status: 'needs_review',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'finding_reviewed',
          targetId: 'finding_northstar_scoped_review',
        }),
        expect.objectContaining({
          action: 'finding_published',
          targetId: 'finding_northstar_scoped_review',
        }),
      ]),
    )
  })

  it('merges a duplicate draft finding into a target finding', async () => {
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
        id: 'finding_duplicate_source',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Duplicate source finding',
        status: 'draft',
      }),
      finding({
        id: 'finding_merge_target',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Primary target finding',
        status: 'needs_review',
      }),
    ])

    const formData = new FormData()
    formData.set('sourceFindingId', 'finding_duplicate_source')
    formData.set('targetFindingId', 'finding_merge_target')
    formData.set('note', 'Same customer, same usage record family.')

    await expect(mergeFindingAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    const findings = await getFindingStore().listByWorkspace(northstarWorkspace.id)
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'finding_merge_target',
          status: 'needs_review',
          evidenceRefs: expect.arrayContaining([
            { type: 'usage_record', sourceId: 'finding_merge_target_usage' },
            { type: 'usage_record', sourceId: 'finding_duplicate_source_usage' },
          ]),
          internalNote: 'Merged finding_duplicate_source into this finding. Same customer, same usage record family.',
          metadata: expect.objectContaining({
            mergedBy: 'internal_admin',
            mergedFindingIds: ['finding_duplicate_source'],
          }),
        }),
        expect.objectContaining({
          id: 'finding_duplicate_source',
          status: 'ignored',
          metadata: expect.objectContaining({
            mergedBy: 'internal_admin',
            mergedInto: 'finding_merge_target',
          }),
        }),
      ]),
    )
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'finding_reviewed',
        actorId: 'internal_admin',
        targetId: 'finding_duplicate_source',
        targetType: 'finding',
        metadata: expect.objectContaining({
          mode: 'merge',
          sourceFindingId: 'finding_duplicate_source',
          targetFindingId: 'finding_merge_target',
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/status')
  })

  it('moves a reviewed finding through the customer issue lifecycle', async () => {
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
        id: 'finding_northstar_lifecycle',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Northstar open overage issue',
        status: 'open',
      }),
    ])

    const formData = new FormData()
    formData.set('findingId', 'finding_northstar_lifecycle')
    formData.set('status', 'monitoring')
    formData.set('issueStatusNote', 'Finance will monitor the next invoice run before closing this out.')

    await expect(updateFindingIssueStatusAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_northstar_lifecycle',
        status: 'monitoring',
        reviewerId: 'internal_admin',
        internalNote: 'Finance will monitor the next invoice run before closing this out.',
        metadata: expect.objectContaining({
          issueStatusHistory: [
            expect.objectContaining({
              fromStatus: 'open',
              toStatus: 'monitoring',
              note: 'Finance will monitor the next invoice run before closing this out.',
              actorId: 'internal_admin',
            }),
          ],
        }),
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'finding_issue_status_changed',
        actorId: 'internal_admin',
        targetId: 'finding_northstar_lifecycle',
        targetType: 'finding',
        metadata: expect.objectContaining({
          fromStatus: 'open',
          status: 'monitoring',
          hasNote: true,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/status')
  })

  it('counts open and monitoring issues as customer-visible when generating evidence packs', async () => {
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
        id: 'finding_open_issue',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Open issue',
        status: 'open',
      }),
      finding({
        id: 'finding_monitoring_issue',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Monitoring issue',
        status: 'monitoring',
      }),
      finding({
        id: 'finding_ignored_issue',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Ignored issue',
        status: 'ignored',
      }),
    ])

    await expect(generateEvidencePackAction(new FormData())).rejects.toThrow('NEXT_REDIRECT:/evidence-pack')

    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'evidence_pack_generated',
        metadata: expect.objectContaining({
          customerVisibleCount: 2,
        }),
      }),
    ])
  })

  it('saves the report builder finding and note selection for a workspace', async () => {
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

    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.append('findingId', 'finding_selected_with_note')
    formData.append('findingId', 'finding_selected_without_note')
    formData.append('noteFindingId', 'finding_selected_with_note')

    await expect(saveReportBuilderAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/report-builder',
    )

    await expect(getReportBuilderConfigStore().getByWorkspace(northstarWorkspace.id)).resolves.toMatchObject({
      workspaceId: northstarWorkspace.id,
      selectedFindingIds: ['finding_selected_with_note', 'finding_selected_without_note'],
      noteFindingIds: ['finding_selected_with_note'],
      updatedBy: 'internal_admin',
    })
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'report_builder_saved',
        actorId: 'internal_admin',
        targetId: northstarWorkspace.id,
        targetType: 'evidence_pack',
        metadata: expect.objectContaining({
          selectedFindingCount: 2,
          selectedNoteCount: 1,
        }),
      }),
    ])
  })

  it('merges findings against an explicit scoped workspace', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_scoped_duplicate_source',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Scoped duplicate source',
        status: 'draft',
      }),
      finding({
        id: 'finding_scoped_merge_target',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Scoped merge target',
        status: 'needs_review',
      }),
      finding({
        id: 'finding_acme_merge_target',
        organizationId: acmeWorkspace.organizationId,
        workspaceId: acmeWorkspace.id,
        title: 'Acme merge target should stay separate',
        status: 'needs_review',
      }),
    ])

    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('sourceFindingId', 'finding_scoped_duplicate_source')
    formData.set('targetFindingId', 'finding_scoped_merge_target')
    formData.set('note', 'Same evidence family in scoped review.')

    await expect(mergeFindingAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/findings',
    )

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'finding_scoped_merge_target',
          status: 'needs_review',
          metadata: expect.objectContaining({
            mergedBy: 'internal_admin',
            mergedFindingIds: ['finding_scoped_duplicate_source'],
          }),
        }),
        expect.objectContaining({
          id: 'finding_scoped_duplicate_source',
          status: 'ignored',
          metadata: expect.objectContaining({
            mergedInto: 'finding_scoped_merge_target',
          }),
        }),
      ]),
    )
    await expect(getFindingStore().listByWorkspace(acmeWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_acme_merge_target',
        status: 'needs_review',
      },
    ])
  })

  it('creates an approved manual contract term for the active workspace', async () => {
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

    const formData = new FormData()
    formData.set('type', 'overage_rate')
    formData.set('customerId', 'acct_northstar')
    formData.set('meter', 'api_calls')
    formData.set('unit', '1k_api_calls')
    formData.set('rate', '2.75')
    formData.set('currency', 'EUR')
    formData.set('billingPeriod', 'monthly')
    formData.set('threshold', '2500')
    formData.set('effectiveFrom', '2026-06-01')
    formData.set('effectiveTo', '2027-05-31')
    formData.set('evidenceSourceFileId', 'src_order_form')
    formData.set('evidencePage', '4')
    formData.set('evidenceSnippet', 'Overage charged at EUR 2.75 per 1k API calls.')
    formData.set('note', 'Added manually from signed order form.')

    await expect(createManualContractTermAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    const terms = await getContractTermStore().listByWorkspace(northstarWorkspace.id)
    expect(terms).toMatchObject([
      {
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        customerId: 'acct_northstar',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        rate: 2.75,
        currency: 'eur',
        billingPeriod: 'monthly',
        threshold: 2500,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2027-05-31',
        status: 'approved',
        evidence: {
          sourceFileId: 'src_order_form',
          page: 4,
          snippet: 'Overage charged at EUR 2.75 per 1k API calls.',
        },
        metadata: expect.objectContaining({
          source: 'manual',
          reviewerId: 'internal_admin',
          reviewNote: 'Added manually from signed order form.',
        }),
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'contract_term_reviewed',
        actorId: 'internal_admin',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        targetType: 'contract_term',
        targetId: terms[0].id,
        metadata: expect.objectContaining({
          mode: 'manual_create',
          status: 'approved',
          type: 'overage_rate',
        }),
      }),
    ])
  })

  it('creates an approved manual contract term against an explicit scoped workspace', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)

    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('type', 'minimum')
    formData.set('customerId', 'contract_northstar')
    formData.set('minimumAmount', '20000')
    formData.set('currency', 'EUR')
    formData.set('effectiveFrom', '2026-06-01')
    formData.set('evidenceSourceFileId', 'src_northstar_order_form')
    formData.set('evidencePage', '5')
    formData.set('evidenceSnippet', 'Monthly minimum commitment: EUR 20,000.')
    formData.set('note', 'Added from scoped contract-terms route.')

    await expect(createManualContractTermAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/contract-terms',
    )

    await expect(getContractTermStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        customerId: 'contract_northstar',
        type: 'minimum',
        minimumAmount: 20000,
        currency: 'eur',
        status: 'approved',
        evidence: {
          sourceFileId: 'src_northstar_order_form',
          page: 5,
          snippet: 'Monthly minimum commitment: EUR 20,000.',
        },
      },
    ])
    await expect(getContractTermStore().listByWorkspace(acmeWorkspace.id)).resolves.toEqual([])
  })

  it('reviews contract terms against an explicit scoped workspace and records a version', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    await getContractTermStore().saveMany([
      {
        id: 'term_northstar_overage',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        customerId: 'contract_northstar',
        type: 'overage_rate',
        rate: 2.5,
        currency: 'eur',
        unit: '1k_api_calls',
        status: 'candidate',
        evidence: {
          sourceFileId: 'src_northstar_order_form',
          page: 4,
          snippet: 'Overage charged at EUR 2.50 per 1k API calls.',
        },
        metadata: {},
      },
      {
        id: 'term_acme_overage',
        organizationId: acmeWorkspace.organizationId,
        workspaceId: acmeWorkspace.id,
        customerId: 'contract_acme',
        type: 'overage_rate',
        rate: 1.25,
        currency: 'eur',
        unit: '1k_api_calls',
        status: 'candidate',
        metadata: {},
      },
    ])

    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.set('termId', 'term_northstar_overage')
    formData.set('status', 'approved')
    formData.set('rate', '2.75')
    formData.set('billingPeriod', 'monthly')
    formData.set('threshold', '500')
    formData.set('note', 'Approved after checking signed amendment.')

    await expect(reviewContractTermAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/contract-terms',
    )

    await expect(getContractTermStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'term_northstar_overage',
        status: 'approved',
        rate: 2.75,
        billingPeriod: 'monthly',
        threshold: 500,
        metadata: expect.objectContaining({
          reviewerId: 'internal_admin',
          reviewNote: 'Approved after checking signed amendment.',
        }),
      },
    ])
    await expect(getContractTermStore().listByWorkspace(acmeWorkspace.id)).resolves.toMatchObject([
      {
        id: 'term_acme_overage',
        status: 'candidate',
        rate: 1.25,
      },
    ])
    await expect(getContractTermStore().listVersions('term_northstar_overage')).resolves.toMatchObject([
      {
        termId: 'term_northstar_overage',
        reviewerId: 'internal_admin',
        changedFields: expect.arrayContaining(['billingPeriod', 'rate', 'status', 'threshold']),
        note: 'Approved after checking signed amendment.',
      },
    ])
    await expect(getContractTermStore().listFeedbackForTerm('term_northstar_overage')).resolves.toMatchObject([
      {
        termId: 'term_northstar_overage',
        reviewerId: 'internal_admin',
        outcome: 'approved',
        note: 'Approved after checking signed amendment.',
        correctionCount: 4,
        corrections: expect.arrayContaining([
          {
            field: 'billingPeriod',
            after: 'monthly',
          },
          {
            field: 'rate',
            before: 2.5,
            after: 2.75,
          },
          {
            field: 'status',
            before: 'candidate',
            after: 'approved',
          },
          {
            field: 'threshold',
            after: 500,
          },
        ]),
        extractionContext: {
          type: 'overage_rate',
          sourceFileId: 'src_northstar_order_form',
          page: 4,
        },
      },
    ])
  })

  it('audits every reconciliation check ID that the operator run executes', async () => {
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
    await getInviteStore().save(
      createWorkspaceInvite({
        email: 'finance@northstar.ai',
        name: 'Northstar Finance',
        organizationId: northstarWorkspace.organizationId,
        organizationName: northstarWorkspace.organizationName,
        role: 'customer_admin',
        workspaceId: northstarWorkspace.id,
        invitedBy: 'internal_admin',
      }),
    )
    await getParsedRecordStore().saveMany([
      invoiceLineRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        externalCustomerId: 'acct_northstar_credit',
        amount: -70000,
      }),
    ])
    await getContractTermStore().saveMany([
      {
        id: 'term_northstar_credit',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        customerId: 'acct_northstar_credit',
        type: 'credit',
        creditAmount: 100000,
        currency: 'eur',
        status: 'approved',
        metadata: {},
      },
    ])

    await expect(runReconciliationAction()).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        category: 'credit_burn_mismatch',
        customerId: 'acct_northstar_credit',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'check_run',
          metadata: expect.objectContaining({
            checkIds: expect.arrayContaining([
              'usage_without_invoice',
              'invoice_without_usage',
              'missing_usage',
              'late_usage_after_invoice_finalization',
              'duplicate_usage',
              'internal_usage_billed',
              'paid_usage_marked_free',
              'account_mapping_mismatch',
              'usage_above_allowance',
              'wrong_overage_rate',
              'credit_burn_mismatch',
              'minimum_not_enforced',
              'expired_discount_active',
              'contract_terms_not_in_billing',
              'cost_exceeds_revenue',
              'cancelled_account_usage',
            ]),
            findingCount: 1,
          }),
        }),
        expect.objectContaining({
          action: 'reminder_email_sent',
          targetType: 'reminder_email',
          metadata: expect.objectContaining({
            reminderType: 'high_severity_findings',
            recipientCount: 2,
            highSeverityCount: 1,
          }),
        }),
      ]),
    )
    await expect(getReminderEmailStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        type: 'high_severity_findings',
        recipientEmail: 'finance@northstar.ai',
        subject: 'Northstar AI June 2026 audit: 1 high-severity finding needs review',
      }),
      expect.objectContaining({
        type: 'high_severity_findings',
        recipientEmail: 'internal@usageintegrity.local',
        recipientName: 'Rory',
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/status')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/runs')
  })

  it('runs reconciliation against an explicit scoped workspace', async () => {
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
    const acmeWorkspace = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    sessionState.current = {
      ...sessionState.current!,
      workspaceIds: [acmeWorkspace.id],
    }
    await getWorkspaceStore().save(northstarWorkspace)
    await getWorkspaceStore().save(acmeWorkspace)
    await getParsedRecordStore().saveMany([
      invoiceLineRecord({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        externalCustomerId: 'acct_northstar_credit',
        amount: -70000,
      }),
    ])
    await getContractTermStore().saveMany([
      {
        id: 'term_northstar_credit',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        customerId: 'acct_northstar_credit',
        type: 'credit',
        creditAmount: 100000,
        currency: 'eur',
        status: 'approved',
        metadata: {},
      },
    ])

    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)

    await expect(runReconciliationAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/runs',
    )

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        category: 'credit_burn_mismatch',
        customerId: 'acct_northstar_credit',
      },
    ])
    await expect(getFindingStore().listByWorkspace(acmeWorkspace.id)).resolves.toEqual([])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'check_run',
          metadata: expect.objectContaining({
            findingCount: 1,
          }),
        }),
      ]),
    )
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/workspaces/workspace_northstar_june_2026/runs')
  })

  it('runs reconciliation with selected rule templates from the scoped run form', async () => {
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
    await getParsedRecordStore().saveMany([
      usageIdentityRecord({
        id: 'usage_template_selected',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        accountId: 'acct_usage_only',
        customerName: 'Usage Only Co',
        domain: 'usage-only.example',
      }),
      invoiceIdentityRecord({
        id: 'invoice_template_not_selected',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        externalCustomerId: 'acct_invoice_only',
        customerEmail: 'billing@invoice-only.example',
      }),
    ])
    const activePricingRule = updatePricingRule(
      createPricingRule(
        {
          organizationId: northstarWorkspace.organizationId,
          workspaceId: northstarWorkspace.id,
          name: 'Northstar API overage',
          type: 'overage_rate',
          meter: 'api_calls',
          unit: '1k_api_calls',
          rate: 1.25,
          threshold: 100_000,
          currency: 'EUR',
          createdBy: 'user_northstar_finance',
        },
        new Date('2026-06-03T09:00:00.000Z'),
      ),
      {
        name: 'Northstar API overage',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        rate: 1.5,
        threshold: 100_000,
        currency: 'EUR',
        updatedBy: 'user_northstar_finance',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )
    const pendingPricingRule = createPricingRule(
      {
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        name: 'Pending API overage',
        type: 'overage_rate',
        rate: 2,
        currency: 'EUR',
        status: 'pending_customer_approval',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T11:00:00.000Z'),
    )
    await getPricingRuleStore().saveMany([activePricingRule, pendingPricingRule])
    const formData = new FormData()
    formData.set('workspaceId', northstarWorkspace.id)
    formData.append('ruleTemplateIds', 'usage_without_invoice')

    await expect(runReconciliationAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/runs',
    )

    const findings = await getFindingStore().listByWorkspace(northstarWorkspace.id)
    expect(findings.map((finding) => finding.category)).toEqual(['usage_exists_no_invoice'])
    await expect(getAuditLogStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'check_run',
        metadata: expect.objectContaining({
          checkIds: ['usage_without_invoice'],
          ruleTemplateCount: 1,
          findingCount: 1,
        }),
      }),
    ])
    await expect(getRuleRunStore().listByWorkspace(northstarWorkspace.id)).resolves.toEqual([
      expect.objectContaining({
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        actorId: 'internal_admin',
        ruleVersion: 'reconciliation_rules_v1',
        status: 'reviewing',
        inputs: {
          ruleTemplateIds: ['usage_without_invoice'],
          parsedRecordCount: 2,
          contractTermCount: 0,
          accountMappingCount: 0,
          pricingRuleVersions: [
            {
              pricingRuleId: activePricingRule.id,
              name: 'Northstar API overage',
              version: 2,
              status: 'active',
            },
          ],
        },
        output: {
          findingCount: 1,
          findingIds: [findings[0].id],
          findingCategories: ['usage_exists_no_invoice'],
          suppressedFindingCount: 0,
        },
        errors: [],
      }),
    ])
  })

  it('replaces stale draft reconciliation findings while preserving reviewed findings', async () => {
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
        id: 'finding_stale_draft',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Stale draft finding from prior run',
        status: 'draft',
      }),
      finding({
        id: 'finding_reviewed_visible',
        organizationId: northstarWorkspace.organizationId,
        workspaceId: northstarWorkspace.id,
        title: 'Reviewed finding that should remain',
        status: 'approved_internal',
      }),
    ])

    await expect(runReconciliationAction()).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getFindingStore().listByWorkspace(northstarWorkspace.id)).resolves.toMatchObject([
      {
        id: 'finding_reviewed_visible',
        status: 'approved_internal',
      },
    ])
  })
})

function finding(input: { id: string; organizationId: string; workspaceId: string; title: string; status?: Finding['status'] }): Finding {
  return findingSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    customerId: 'cus_northstar',
    category: 'usage_above_allowance_no_overage',
    severity: 'high',
    title: input.title,
    expectedAmount: 250_000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: input.status ?? 'needs_review',
    evidenceRefs: [{ type: 'usage_record', sourceId: `${input.id}_usage` }],
    recommendedAction: 'Create adjustment invoice for missed overage usage.',
    metadata: {
      customerName: 'Northstar AI',
      ranAt: '2026-06-08T09:00:00.000Z',
    },
  })
}

function invoiceLineRecord(input: { organizationId: string; workspaceId: string; externalCustomerId: string; amount: number }): ParsedRecord {
  return {
    id: 'parsed_invoice_credit_shortfall',
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    jobId: 'parse_invoice',
    uploadId: 'upload_invoice',
    sourceFileId: 'source_invoice',
    recordType: 'invoice_line',
    sourceRowNumber: 2,
    data: {
      id: 'line_credit_shortfall',
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      invoiceId: 'invoice_northstar_may',
      externalCustomerId: input.externalCustomerId,
      description: 'May prepaid credit balance applied',
      amount: input.amount,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-31T00:00:00.000Z',
      sourceRefs: [{ sourceFileId: 'source_invoice', rowNumber: 2 }],
      metadata: {},
    },
  }
}

function usageIdentityRecord(input: {
  id: string
  organizationId: string
  workspaceId: string
  accountId: string
  customerName: string
  domain: string
}): ParsedRecord {
  return {
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    jobId: `parse_${input.id}`,
    uploadId: `upload_${input.id}`,
    sourceFileId: `source_${input.id}`,
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      customerName: input.customerName,
      meter: 'api_calls',
      quantity: 1000,
      unit: 'calls',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T23:59:59.000Z',
      sourceRefs: [{ sourceFileId: `source_${input.id}`, rowNumber: 2 }],
      metadata: {
        domain: input.domain,
      },
    },
  }
}

function invoiceIdentityRecord(input: {
  id: string
  organizationId: string
  workspaceId: string
  externalCustomerId: string
  customerEmail: string
}): ParsedRecord {
  return {
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    jobId: `parse_${input.id}`,
    uploadId: `upload_${input.id}`,
    sourceFileId: `source_${input.id}`,
    recordType: 'invoice_line',
    sourceRowNumber: 2,
    data: {
      id: input.id,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      invoiceId: `in_${input.id}`,
      externalCustomerId: input.externalCustomerId,
      customerEmail: input.customerEmail,
      description: 'June API calls',
      amount: 25000,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T23:59:59.000Z',
      sourceRefs: [{ sourceFileId: `source_${input.id}`, rowNumber: 2 }],
      metadata: {},
    },
  }
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
