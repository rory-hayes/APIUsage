import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createUploadRecord, JsonUploadStore, LocalUploadStorage } from './uploads'
import { JsonParsedRecordStore, JsonParseJobStore, runParseForUpload, runParseForUploadWithRecords } from './parse-jobs'

describe('audit parse jobs', () => {
  let tempDir: string
  let storage: LocalUploadStorage

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-parse-jobs-'))
    storage = new LocalUploadStorage(join(tempDir, 'files'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('runs the Stripe invoice parser against an uploaded file and records row errors', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'stripe_invoices_export',
      filename: 'stripe-invoices.csv',
      bytes: Buffer.from(
        [
          'id,customer,customer_email,description,amount_due,currency,status,period_start,period_end',
          'in_001,cus_123,finance@acme.ai,May token overage,199.50,EUR,open,2026-05-01,2026-05-31',
          'in_bad,cus_456,finance@example.com,Bad row,not-a-number,EUR,open,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'stripe_invoices_export',
        filename: 'stripe-invoices.csv',
        uploadedBy: 'user_finance',
        ...saved,
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )

    const job = await runParseForUpload(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(job).toMatchObject({
      id: `parse_${upload.id}`,
      uploadId: upload.id,
      parser: 'stripe_invoices_export',
      status: 'completed_with_errors',
      recordCount: 1,
      errorCount: 1,
      ranAt: '2026-06-01T11:00:00.000Z',
    })
    expect(job.errors[0]).toEqual(expect.objectContaining({ rowNumber: 3 }))
  })

  it('runs the usage CSV parser with the default V0 mapping', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      bytes: Buffer.from(
        [
          'account_id,customer_name,meter_name,total,unit,start,end',
          'acct_001,Acme AI,llm_tokens,250000,tokens,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      uploadedBy: 'user_engineering',
      ...saved,
    })

    const job = await runParseForUpload(upload, storage)

    expect(job).toMatchObject({
      parser: 'usage_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
  })

  it('returns normalized usage records from a parse run', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      bytes: Buffer.from(
        [
          'account_id,customer_name,meter_name,total,unit,start,end',
          'acct_001,Acme AI,llm_tokens,250000,tokens,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      uploadedBy: 'user_engineering',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      id: `parse_${upload.id}`,
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records).toHaveLength(1)
    expect(execution.records[0]).toMatchObject({
      id: `parsed_${execution.job.id}_1`,
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      jobId: execution.job.id,
      uploadId: upload.id,
      sourceFileId: upload.sourceFileId,
      recordType: 'usage',
      sourceRowNumber: 2,
      data: {
        accountId: 'acct_001',
        customerName: 'Acme AI',
        meter: 'llm_tokens',
        quantity: 250000,
        unit: 'tokens',
      },
    })
  })

  it('honors upload-provided usage CSV column mappings for customer-specific exports', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'customer-specific-usage.csv',
      bytes: Buffer.from(
        [
          'tenant,company,metric,units_used,uom,from_date,to_date',
          'acct_northstar,Northstar AI,api_calls,14600000,calls,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'customer-specific-usage.csv',
      uploadedBy: 'user_engineering',
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
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      parser: 'usage_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'usage',
      sourceRowNumber: 2,
      data: {
        accountId: 'acct_northstar',
        customerName: 'Northstar AI',
        meter: 'api_calls',
        quantity: 14_600_000,
        unit: 'calls',
      },
    })
  })

  it('returns normalized invoice line records from a parse run', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'stripe_invoices_export',
      filename: 'stripe-invoices.csv',
      bytes: Buffer.from(
        [
          'id,customer,customer_email,description,amount_due,currency,status,period_start,period_end',
          'in_001,cus_123,finance@acme.ai,May token overage,199.50,EUR,paid,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'stripe_invoices_export',
      filename: 'stripe-invoices.csv',
      uploadedBy: 'user_finance',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'invoice_line',
      sourceRowNumber: 2,
      data: {
        invoiceId: 'in_001',
        externalCustomerId: 'cus_123',
        amount: 19950,
        currency: 'eur',
        status: 'paid',
      },
    })
  })

  it('runs the Stripe customer parser and returns normalized customer records', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'stripe_customers_export',
      filename: 'stripe-customers.csv',
      bytes: Buffer.from(
        [
          'id,email,name,created,currency',
          'cus_123,finance@acme.ai,Acme AI,2026-04-01,EUR',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'stripe_customers_export',
      filename: 'stripe-customers.csv',
      uploadedBy: 'user_finance',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      id: `parse_${upload.id}`,
      parser: 'stripe_customers_export',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'customer',
      sourceRowNumber: 2,
      data: {
        id: `${upload.sourceFileId}:2:cus_123`,
        workspaceId: 'workspace_001',
        displayName: 'Acme AI',
        primaryEmail: 'finance@acme.ai',
        externalIds: {
          stripeCustomerId: 'cus_123',
        },
      },
    })
  })

  it('runs the provider cost CSV parser and returns normalized cost records', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'provider_cost_csv',
      filename: 'provider-costs.csv',
      bytes: Buffer.from(
        [
          'account_id,customer_name,provider,product,model,cost,currency,start,end',
          'acct_001,Acme AI,OpenAI,Responses API,gpt-4.1,240.75,EUR,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'provider_cost_csv',
      filename: 'provider-costs.csv',
      uploadedBy: 'user_finance',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      id: `parse_${upload.id}`,
      parser: 'provider_cost_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'cost',
      sourceRowNumber: 2,
      data: {
        accountId: 'acct_001',
        customerName: 'Acme AI',
        provider: 'OpenAI',
        product: 'Responses API',
        model: 'gpt-4.1',
        costAmount: 24075,
        currency: 'eur',
      },
    })
  })

  it('honors upload-provided provider cost CSV column mappings for customer-specific exports', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'provider_cost_csv',
      filename: 'customer-specific-costs.csv',
      bytes: Buffer.from(
        [
          'tenant,company,vendor_name,service_name,model_name,spend,currency_code,from_date,to_date',
          'acct_northstar,Northstar AI,OpenAI,Responses API,gpt-4.1,240.75,EUR,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'provider_cost_csv',
      filename: 'customer-specific-costs.csv',
      uploadedBy: 'user_finance',
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
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      parser: 'provider_cost_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'cost',
      sourceRowNumber: 2,
      data: {
        accountId: 'acct_northstar',
        customerName: 'Northstar AI',
        provider: 'OpenAI',
        product: 'Responses API',
        model: 'gpt-4.1',
        costAmount: 24075,
        currency: 'eur',
      },
    })
  })

  it('runs the customer account mapping CSV parser and returns mapping records', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'account_mapping_csv',
      filename: 'account-mappings.csv',
      bytes: Buffer.from(
        [
          'display_name,usage_account_id,usage_customer_id,usage_customer_name,stripe_customer_id,stripe_customer_email,contract_customer_id,cost_account_id,note',
          'Northstar AI,acct_northstar,usage_northstar,Northstar AI,cus_northstar,billing@northstar.ai,contract_northstar,cost_northstar,Customer supplied mapping',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'account_mapping_csv',
      filename: 'account-mappings.csv',
      uploadedBy: 'user_engineering',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      id: `parse_${upload.id}`,
      parser: 'account_mapping_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'mapping',
      sourceRowNumber: 2,
      data: {
        displayName: 'Northstar AI',
        usageAccountId: 'acct_northstar',
        usageCustomerId: 'usage_northstar',
        usageCustomerName: 'Northstar AI',
        stripeCustomerId: 'cus_northstar',
        stripeCustomerEmail: 'billing@northstar.ai',
        contractCustomerId: 'contract_northstar',
        costAccountId: 'cost_northstar',
        note: 'Customer supplied mapping',
      },
    })
  })

  it('runs the credits and allowances CSV parser and returns contract term records', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'credits_allowances_csv',
      filename: 'credits-allowances.csv',
      bytes: Buffer.from(
        [
          'customer_id,type,meter,unit,allowance,credit_amount,currency,effective_from,effective_to,evidence_snippet',
          'acct_northstar,allowance,api_calls,calls,100000,,EUR,2026-06-01,2026-06-30,Monthly included API-call allowance',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'credits_allowances_csv',
      filename: 'credits-allowances.csv',
      uploadedBy: 'user_finance',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      id: `parse_${upload.id}`,
      parser: 'credits_allowances_csv',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'contract_term',
      sourceRowNumber: 2,
      data: {
        customerId: 'acct_northstar',
        type: 'allowance',
        meter: 'api_calls',
        unit: 'calls',
        allowance: 100000,
        status: 'candidate',
      },
    })
  })

  it('runs the Stripe subscription parser and returns normalized subscription records', async () => {
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'stripe_subscriptions_export',
      filename: 'stripe-subscriptions.csv',
      bytes: Buffer.from(
        [
          'id,customer,status,current_period_start,current_period_end,canceled_at,product,plan',
          'sub_001,cus_123,canceled,2026-05-01,2026-05-31,2026-05-15,API Platform,enterprise',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'stripe_subscriptions_export',
      filename: 'stripe-subscriptions.csv',
      uploadedBy: 'user_finance',
      ...saved,
    })

    const execution = await runParseForUploadWithRecords(upload, storage, new Date('2026-06-01T11:00:00.000Z'))

    expect(execution.job).toMatchObject({
      id: `parse_${upload.id}`,
      parser: 'stripe_subscriptions_export',
      status: 'complete',
      recordCount: 1,
      errorCount: 0,
    })
    expect(execution.records[0]).toMatchObject({
      recordType: 'subscription',
      sourceRowNumber: 2,
      data: {
        subscriptionId: 'sub_001',
        externalCustomerId: 'cus_123',
        status: 'canceled',
        canceledAt: '2026-05-15T00:00:00.000Z',
        product: 'API Platform',
        plan: 'enterprise',
      },
    })
  })

  it('persists parsed records and reloads them by job and workspace', async () => {
    const recordStore = new JsonParsedRecordStore(join(tempDir, 'parsed-records.json'))
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      bytes: Buffer.from(
        [
          'account_id,customer_name,meter_name,total,unit,start,end',
          'acct_001,Acme AI,llm_tokens,250000,tokens,2026-05-01,2026-05-31',
        ].join('\n'),
      ),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      uploadedBy: 'user_engineering',
      ...saved,
    })
    const execution = await runParseForUploadWithRecords(upload, storage)

    await recordStore.saveMany(execution.records)

    await expect(recordStore.listByJob(execution.job.id)).resolves.toEqual(execution.records)
    await expect(recordStore.listByWorkspace('workspace_001')).resolves.toEqual(execution.records)
    await expect(recordStore.listByWorkspace('other_workspace')).resolves.toEqual([])
  })

  it('marks unsupported upload categories without reading a parser', async () => {
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'pricing_docs',
      filename: 'pricing.pdf',
      byteSize: 100,
      contentType: 'application/pdf',
      storageKey: 'workspaces/workspace_001/pricing_docs/pricing.pdf',
      uploadedBy: 'user_revops',
    })

    const job = await runParseForUpload(upload, storage)

    expect(job).toMatchObject({
      parser: 'unsupported',
      status: 'unsupported',
      recordCount: 0,
      errorCount: 1,
    })
  })

  it('persists parse jobs and reloads them by workspace', async () => {
    const uploadStore = new JsonUploadStore(join(tempDir, 'uploads.json'))
    const parseStore = new JsonParseJobStore(join(tempDir, 'parse-jobs.json'))
    const saved = await storage.save({
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      bytes: Buffer.from('account_id,customer_name,meter_name,total,unit,start,end\nacct_001,Acme AI,llm_tokens,1,tokens,2026-05-01,2026-05-31\n'),
    })
    const upload = createUploadRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      category: 'usage_csv',
      filename: 'usage.csv',
      uploadedBy: 'user_engineering',
      ...saved,
    })
    await uploadStore.save(upload)

    const job = await runParseForUpload(upload, storage)
    await parseStore.save(job)

    await expect(parseStore.listByWorkspace('workspace_001')).resolves.toEqual([job])
    await expect(parseStore.listByWorkspace('other_workspace')).resolves.toEqual([])
  })
})
