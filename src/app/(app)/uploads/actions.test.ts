import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_WORKSPACE_ID,
  getAccountMappingStore,
  getAuditLogStore,
  getContractTermStore,
  getParsedRecordStore,
  getParseJobStore,
  getUploadTaskCommentStore,
  getUploadStorage,
  getUploadStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { createUploadRecord } from '@/lib/audit/uploads'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import { addUploadTaskCommentAction, reviewUploadAction, runParseAction, uploadFileAction } from './actions'

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
  requireSession: vi.fn(async () => {
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
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_UPLOAD_COMMENT_PATH: process.env.AUDIT_UPLOAD_COMMENT_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_UPLOAD_STORAGE_ROOT: process.env.AUDIT_UPLOAD_STORAGE_ROOT,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('upload actions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-upload-actions-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
    process.env.AUDIT_UPLOAD_COMMENT_PATH = join(tempDir, 'upload-comments.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_UPLOAD_STORAGE_ROOT = join(tempDir, 'files')
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

  it('saves customer uploads and audits the exact stored file fingerprint', async () => {
    sessionState.current = {
      userId: 'user_customer_admin',
      email: 'customer@acme.ai',
      name: 'Acme Finance Admin',
      organizationId: DEFAULT_ORGANIZATION_ID,
      organizationName: 'Acme AI',
      role: 'customer_admin',
      workspaceIds: [DEFAULT_WORKSPACE_ID],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const bytes = Buffer.from('account_id,total\nacct_1,42\n')
    const formData = new FormData()
    formData.set('category', 'usage_csv')
    formData.set('file', new File([bytes], 'usage.csv', { type: 'text/csv' }))

    await expect(uploadFileAction(formData)).rejects.toThrow('NEXT_REDIRECT:/uploads')

    const uploads = await getUploadStore().listByWorkspace(DEFAULT_WORKSPACE_ID)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      organizationId: DEFAULT_ORGANIZATION_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      category: 'usage_csv',
      filename: 'usage.csv',
      byteSize: bytes.byteLength,
      contentType: 'text/csv',
      uploadedBy: 'user_customer_admin',
      status: 'needs_review',
      metadata: {
        monitoringPeriodId: 'period_may_2026',
        periodLabel: 'May 2026',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
      },
    })
    await expect(getUploadStorage().readBytes(uploads[0].storageKey)).resolves.toEqual(bytes)

    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toMatchObject([
      {
        action: 'file_uploaded',
        actorId: 'user_customer_admin',
        targetId: uploads[0].id,
        targetType: 'upload',
        metadata: {
          category: 'usage_csv',
          filename: 'usage.csv',
          byteSize: bytes.byteLength,
          contentType: 'text/csv',
          checksum: uploads[0].checksum,
          sourceFileId: uploads[0].sourceFileId,
          monitoringPeriodId: 'period_may_2026',
          periodLabel: 'May 2026',
        },
      },
    ])
  })

  it('saves customer uploads against an explicit scoped workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    const acme = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'uploads',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(acme)
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: northstar.organizationId,
      organizationName: northstar.organizationName,
      role: 'customer_admin',
      workspaceIds: [acme.id, northstar.id],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const bytes = Buffer.from('account_id,total\nacct_northstar,84\n')
    const formData = new FormData()
    formData.set('workspaceId', northstar.id)
    formData.set('category', 'usage_csv')
    formData.set('file', new File([bytes], 'northstar-usage.csv', { type: 'text/csv' }))

    await expect(uploadFileAction(formData)).rejects.toThrow('NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/uploads')

    const northstarUploads = await getUploadStore().listByWorkspace(northstar.id)
    expect(northstarUploads).toHaveLength(1)
    expect(northstarUploads[0]).toMatchObject({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      byteSize: bytes.byteLength,
      uploadedBy: 'user_northstar_finance',
    })
    await expect(getUploadStore().listByWorkspace(acme.id)).resolves.toEqual([])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'file_uploaded',
        actorId: 'user_northstar_finance',
        targetId: northstarUploads[0].id,
      },
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/uploads')
  })

  it('does not save customer uploads against inaccessible scoped workspaces', async () => {
    const northstar = await saveNorthstarWorkspace()
    sessionState.current = {
      userId: 'user_acme_finance',
      email: 'finance@acme.ai',
      name: 'Acme Finance',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const formData = new FormData()
    formData.set('workspaceId', northstar.id)
    formData.set('category', 'usage_csv')
    formData.set('file', new File([Buffer.from('account_id,total\nacct_northstar,84\n')], 'northstar-usage.csv', { type: 'text/csv' }))

    await expect(uploadFileAction(formData)).rejects.toThrow('Workspace access denied')

    await expect(getUploadStore().listByWorkspace(northstar.id)).resolves.toEqual([])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([])
  })

  it('lets customers add scoped upload task comments and audits the conversation event', async () => {
    const northstar = await saveNorthstarWorkspace()
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: northstar.organizationId,
      organizationName: northstar.organizationName,
      role: 'customer_admin',
      workspaceIds: [northstar.id],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const formData = new FormData()
    formData.set('workspaceId', northstar.id)
    formData.set('category', 'usage_csv')
    formData.set('body', 'We can resend the usage export once Engineering adds period_end.')

    await expect(addUploadTaskCommentAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/uploads',
    )

    await expect(getUploadTaskCommentStore().listByCategory(northstar.id, 'usage_csv')).resolves.toMatchObject([
      {
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        category: 'usage_csv',
        body: 'We can resend the usage export once Engineering adds period_end.',
        authorId: 'user_northstar_finance',
        authorName: 'Northstar Finance',
        authorRole: 'customer_admin',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'upload_task_commented',
        actorId: 'user_northstar_finance',
        targetId: 'usage_csv',
        targetType: 'upload_task',
        metadata: {
          category: 'usage_csv',
          bodyLength: 64,
        },
      },
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/uploads')
  })

  it('does not let customers comment on upload tasks outside their scoped workspaces', async () => {
    const northstar = await saveNorthstarWorkspace()
    sessionState.current = {
      userId: 'user_acme_finance',
      email: 'finance@acme.ai',
      name: 'Acme Finance',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const formData = new FormData()
    formData.set('workspaceId', northstar.id)
    formData.set('category', 'usage_csv')
    formData.set('body', 'This should not be saved.')

    await expect(addUploadTaskCommentAction(formData)).rejects.toThrow('Workspace access denied')

    await expect(getUploadTaskCommentStore().listByWorkspace(northstar.id)).resolves.toEqual([])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([])
  })

  it('marks active workspace uploads as duplicate', async () => {
    const northstar = await saveNorthstarWorkspace()
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-usage-copy.csv',
      byteSize: 256,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage-copy.csv',
      uploadedBy: 'user_northstar_finance',
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('uploadId', upload.id)
    formData.set('status', 'duplicate')
    formData.set('reviewNote', 'Same as the earlier usage export')

    await expect(reviewUploadAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getUploadStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        id: upload.id,
        status: 'duplicate',
        reviewedBy: 'internal_admin',
        reviewNote: 'Same as the earlier usage export',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        action: 'file_reviewed',
        actorId: 'internal_admin',
        targetId: upload.id,
        metadata: {
          status: 'duplicate',
          reviewNote: 'Same as the earlier usage export',
        },
      },
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/status')
  })

  it('runs the parser for an active workspace upload and refreshes run history', async () => {
    const northstar = await saveNorthstarWorkspace()
    const saved = await getUploadStorage().save({
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      contentType: 'text/csv',
      bytes: Buffer.from(
        [
          'account_id,customer_name,meter_name,total,unit,start,end',
          'acct_northstar,Northstar AI,api_calls,14600000,calls,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      uploadedBy: 'user_northstar_finance',
      ...saved,
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('uploadId', upload.id)

    await expect(runParseAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getParseJobStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        parser: 'usage_csv',
        status: 'complete',
        recordCount: 1,
        errorCount: 0,
      },
    ])
    await expect(getParsedRecordStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        sourceFileId: upload.sourceFileId,
        recordType: 'usage',
        sourceRowNumber: 2,
        data: {
          accountId: 'acct_northstar',
          customerName: 'Northstar AI',
          meter: 'api_calls',
          quantity: 14_600_000,
        },
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'parse_run',
        actorId: 'internal_admin',
        targetId: upload.id,
        targetType: 'upload',
        metadata: expect.objectContaining({
          parser: 'usage_csv',
          status: 'complete',
          recordCount: 1,
          errorCount: 0,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/admin/runs')
  })

  it('runs usage parser with operator-provided source column mappings and persists them on the upload', async () => {
    const northstar = await saveNorthstarWorkspace()
    const saved = await getUploadStorage().save({
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-custom-usage.csv',
      contentType: 'text/csv',
      bytes: Buffer.from(
        [
          'tenant,company,metric,units_used,uom,from_date,to_date',
          'acct_northstar,Northstar AI,api_calls,14600000,calls,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-custom-usage.csv',
      uploadedBy: 'user_northstar_finance',
      ...saved,
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('uploadId', upload.id)
    formData.set('usageAccountIdColumn', 'tenant')
    formData.set('usageCustomerNameColumn', 'company')
    formData.set('usageMeterColumn', 'metric')
    formData.set('usageQuantityColumn', 'units_used')
    formData.set('usageUnitColumn', 'uom')
    formData.set('usagePeriodStartColumn', 'from_date')
    formData.set('usagePeriodEndColumn', 'to_date')

    await expect(runParseAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getParseJobStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        parser: 'usage_csv',
        status: 'complete',
        recordCount: 1,
        errorCount: 0,
      },
    ])
    await expect(getParsedRecordStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        recordType: 'usage',
        data: {
          accountId: 'acct_northstar',
          customerName: 'Northstar AI',
          meter: 'api_calls',
          quantity: 14_600_000,
          unit: 'calls',
        },
      },
    ])
    await expect(getUploadStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        id: upload.id,
        metadata: {
          usageCsvMapping: {
            accountId: 'tenant',
            customerName: 'company',
            meter: 'metric',
            quantity: 'units_used',
            unit: 'uom',
            periodStart: 'from_date',
            periodEnd: 'to_date',
          },
        },
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'parse_run',
        metadata: expect.objectContaining({
          parser: 'usage_csv',
          status: 'complete',
          usageCsvMappingProvided: true,
        }),
      }),
    ])
  })

  it('runs provider cost parser with operator-provided source column mappings and persists them on the upload', async () => {
    const northstar = await saveNorthstarWorkspace()
    const saved = await getUploadStorage().save({
      workspaceId: northstar.id,
      category: 'provider_cost_csv',
      filename: 'northstar-custom-costs.csv',
      contentType: 'text/csv',
      bytes: Buffer.from(
        [
          'tenant,company,vendor_name,service_name,model_name,spend,currency_code,from_date,to_date',
          'acct_northstar,Northstar AI,OpenAI,Responses API,gpt-4.1,240.75,EUR,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'provider_cost_csv',
      filename: 'northstar-custom-costs.csv',
      uploadedBy: 'user_northstar_finance',
      ...saved,
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('uploadId', upload.id)
    formData.set('costAccountIdColumn', 'tenant')
    formData.set('costCustomerNameColumn', 'company')
    formData.set('costProviderColumn', 'vendor_name')
    formData.set('costProductColumn', 'service_name')
    formData.set('costModelColumn', 'model_name')
    formData.set('costAmountColumn', 'spend')
    formData.set('costCurrencyColumn', 'currency_code')
    formData.set('costPeriodStartColumn', 'from_date')
    formData.set('costPeriodEndColumn', 'to_date')

    await expect(runParseAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getParseJobStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        parser: 'provider_cost_csv',
        status: 'complete',
        recordCount: 1,
        errorCount: 0,
      },
    ])
    await expect(getParsedRecordStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        recordType: 'cost',
        data: {
          accountId: 'acct_northstar',
          customerName: 'Northstar AI',
          provider: 'OpenAI',
          product: 'Responses API',
          model: 'gpt-4.1',
          costAmount: 24075,
          currency: 'eur',
        },
      },
    ])
    await expect(getUploadStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        id: upload.id,
        metadata: {
          providerCostCsvMapping: {
            accountId: 'tenant',
            customerName: 'company',
            provider: 'vendor_name',
            product: 'service_name',
            model: 'model_name',
            costAmount: 'spend',
            currency: 'currency_code',
            periodStart: 'from_date',
            periodEnd: 'to_date',
          },
        },
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'parse_run',
        metadata: expect.objectContaining({
          parser: 'provider_cost_csv',
          status: 'complete',
          providerCostCsvMappingProvided: true,
        }),
      }),
    ])
  })

  it('runs account mapping parser and saves reviewed manual mappings for the active workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    const saved = await getUploadStorage().save({
      workspaceId: northstar.id,
      category: 'account_mapping_csv',
      filename: 'northstar-account-mappings.csv',
      contentType: 'text/csv',
      bytes: Buffer.from(
        [
          'display_name,usage_account_id,usage_customer_id,usage_customer_name,stripe_customer_id,stripe_customer_email,contract_customer_id,cost_account_id,note',
          'Northstar AI,acct_northstar,usage_northstar,Northstar AI,cus_northstar,billing@northstar.ai,contract_northstar,cost_northstar,Customer supplied mapping',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'account_mapping_csv',
      filename: 'northstar-account-mappings.csv',
      uploadedBy: 'user_northstar_finance',
      ...saved,
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('uploadId', upload.id)

    await expect(runParseAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getParseJobStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        parser: 'account_mapping_csv',
        status: 'complete',
        recordCount: 1,
        errorCount: 0,
      },
    ])
    await expect(getParsedRecordStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        sourceFileId: upload.sourceFileId,
        recordType: 'mapping',
        sourceRowNumber: 2,
        data: {
          displayName: 'Northstar AI',
          usageAccountId: 'acct_northstar',
          stripeCustomerId: 'cus_northstar',
        },
      },
    ])
    await expect(getAccountMappingStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        displayName: 'Northstar AI',
        status: 'manual_override',
        source: 'manual',
        reviewerId: 'internal_admin',
        usageAccountId: 'acct_northstar',
        usageCustomerId: 'usage_northstar',
        usageCustomerName: 'Northstar AI',
        stripeCustomerId: 'cus_northstar',
        stripeCustomerEmail: 'billing@northstar.ai',
        contractCustomerId: 'contract_northstar',
        costAccountId: 'cost_northstar',
        note: 'Customer supplied mapping',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'parse_run',
          metadata: expect.objectContaining({
            parser: 'account_mapping_csv',
            status: 'complete',
            recordCount: 1,
            errorCount: 0,
            accountMappingCount: 1,
          }),
        }),
        expect.objectContaining({
          action: 'account_mapping_saved',
          targetType: 'workspace',
          targetId: northstar.id,
          metadata: expect.objectContaining({
            mode: 'csv_upload',
            mappingCount: 1,
            uploadId: upload.id,
          }),
        }),
      ]),
    )
  })

  it('runs credits and allowances parser and saves candidate contract terms for review', async () => {
    const northstar = await saveNorthstarWorkspace()
    const saved = await getUploadStorage().save({
      workspaceId: northstar.id,
      category: 'credits_allowances_csv',
      filename: 'northstar-credits-allowances.csv',
      contentType: 'text/csv',
      bytes: Buffer.from(
        [
          'customer_id,type,meter,unit,allowance,credit_amount,currency,effective_from,effective_to,evidence_snippet',
          'acct_northstar,allowance,api_calls,calls,100000,,EUR,2026-06-01,2026-06-30,Monthly included API-call allowance',
          'acct_northstar,credit,,, ,50000,EUR,2026-06-01,,Prepaid credit ledger balance',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'credits_allowances_csv',
      filename: 'northstar-credits-allowances.csv',
      uploadedBy: 'user_northstar_finance',
      ...saved,
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('uploadId', upload.id)

    await expect(runParseAction(formData)).rejects.toThrow('NEXT_REDIRECT:/admin')

    await expect(getParseJobStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        parser: 'credits_allowances_csv',
        status: 'complete',
        recordCount: 2,
        errorCount: 0,
      },
    ])
    await expect(getParsedRecordStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        recordType: 'contract_term',
        data: {
          customerId: 'acct_northstar',
          type: 'allowance',
          allowance: 100000,
          status: 'candidate',
        },
      },
      {
        uploadId: upload.id,
        recordType: 'contract_term',
        data: {
          customerId: 'acct_northstar',
          type: 'credit',
          creditAmount: 50000,
          status: 'candidate',
        },
      },
    ])
    await expect(getContractTermStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        customerId: 'acct_northstar',
        type: 'allowance',
        allowance: 100000,
        status: 'candidate',
      },
      {
        customerId: 'acct_northstar',
        type: 'credit',
        creditAmount: 50000,
        currency: 'eur',
        status: 'candidate',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'parse_run',
          metadata: expect.objectContaining({
            parser: 'credits_allowances_csv',
            status: 'complete',
            contractTermCount: 2,
          }),
        }),
        expect.objectContaining({
          action: 'contract_terms_extracted',
          targetType: 'upload',
          targetId: upload.id,
          metadata: expect.objectContaining({
            mode: 'csv_upload',
            termCount: 2,
          }),
        }),
      ]),
    )
  })

  it('does not review uploads outside the active workspace', async () => {
    await saveNorthstarWorkspace()
    const acmeUpload = createUploadRecord({
      organizationId: 'org_acme',
      workspaceId: 'workspace_acme_may_2026',
      category: 'usage_csv',
      filename: 'acme-usage.csv',
      byteSize: 128,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_acme_may_2026/usage_csv/acme-usage.csv',
      uploadedBy: 'user_customer',
    })
    await getUploadStore().save(acmeUpload)
    const formData = new FormData()
    formData.set('uploadId', acmeUpload.id)
    formData.set('status', 'accepted')

    await expect(reviewUploadAction(formData)).rejects.toThrow(`Upload not found: ${acmeUpload.id}`)

    await expect(getUploadStore().listByWorkspace(acmeUpload.workspaceId)).resolves.toMatchObject([
      {
        id: acmeUpload.id,
        status: 'needs_review',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(acmeUpload.workspaceId)).resolves.toEqual([])
  })

  it('reviews uploads against an explicit scoped workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    const acme = createAuditWorkspace(
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
      workspaceIds: [acme.id],
    }
    await getWorkspaceStore().save(acme)
    const northstarUpload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-usage.csv',
      byteSize: 256,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_northstar_june_2026/usage_csv/northstar-usage.csv',
      uploadedBy: 'user_northstar_finance',
    })
    const acmeUpload = createUploadRecord({
      organizationId: acme.organizationId,
      workspaceId: acme.id,
      category: 'usage_csv',
      filename: 'acme-usage.csv',
      byteSize: 128,
      contentType: 'text/csv',
      storageKey: 'workspaces/workspace_acme_may_2026/usage_csv/acme-usage.csv',
      uploadedBy: 'user_acme_finance',
    })
    await getUploadStore().save(northstarUpload)
    await getUploadStore().save(acmeUpload)

    const formData = new FormData()
    formData.set('workspaceId', northstar.id)
    formData.set('uploadId', northstarUpload.id)
    formData.set('status', 'accepted')
    formData.set('reviewNote', 'Scoped review accepted this usage export.')

    await expect(reviewUploadAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/uploads',
    )

    await expect(getUploadStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        id: northstarUpload.id,
        status: 'accepted',
        reviewedBy: 'internal_admin',
        reviewNote: 'Scoped review accepted this usage export.',
      },
    ])
    await expect(getUploadStore().listByWorkspace(acme.id)).resolves.toMatchObject([
      {
        id: acmeUpload.id,
        status: 'needs_review',
      },
    ])
    await expect(getAuditLogStore().listByWorkspace(northstar.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'file_reviewed',
        targetId: northstarUpload.id,
        metadata: expect.objectContaining({
          status: 'accepted',
        }),
      }),
    ])
  })

  it('runs parsers against an explicit scoped workspace', async () => {
    const northstar = await saveNorthstarWorkspace()
    const acme = createAuditWorkspace(
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
      workspaceIds: [acme.id],
    }
    await getWorkspaceStore().save(acme)
    const saved = await getUploadStorage().save({
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-scoped-usage.csv',
      contentType: 'text/csv',
      bytes: Buffer.from(
        [
          'tenant,company,metric,units_used,uom,from_date,to_date',
          'acct_northstar,Northstar AI,api_calls,14600000,calls,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      category: 'usage_csv',
      filename: 'northstar-scoped-usage.csv',
      uploadedBy: 'user_northstar_finance',
      ...saved,
    })
    await getUploadStore().save(upload)

    const formData = new FormData()
    formData.set('workspaceId', northstar.id)
    formData.set('uploadId', upload.id)
    formData.set('usageAccountIdColumn', 'tenant')
    formData.set('usageCustomerNameColumn', 'company')
    formData.set('usageMeterColumn', 'metric')
    formData.set('usageQuantityColumn', 'units_used')
    formData.set('usageUnitColumn', 'uom')
    formData.set('usagePeriodStartColumn', 'from_date')
    formData.set('usagePeriodEndColumn', 'to_date')

    await expect(runParseAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/admin/workspaces/workspace_northstar_june_2026/uploads',
    )

    await expect(getParseJobStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        parser: 'usage_csv',
        status: 'complete',
        recordCount: 1,
      },
    ])
    await expect(getParsedRecordStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        uploadId: upload.id,
        recordType: 'usage',
        data: {
          accountId: 'acct_northstar',
          customerName: 'Northstar AI',
          meter: 'api_calls',
          quantity: 14_600_000,
        },
      },
    ])
    await expect(getUploadStore().listByWorkspace(northstar.id)).resolves.toMatchObject([
      {
        id: upload.id,
        metadata: {
          usageCsvMapping: {
            accountId: 'tenant',
            customerName: 'company',
            meter: 'metric',
            quantity: 'units_used',
            unit: 'uom',
            periodStart: 'from_date',
            periodEnd: 'to_date',
          },
        },
      },
    ])
  })
})

async function saveNorthstarWorkspace() {
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

  return workspace
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
