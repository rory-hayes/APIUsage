import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuditLogEvent, JsonAuditLogStore } from './audit-log'
import { createManualAccountMapping, JsonAccountMappingStore } from './account-mapping'
import { extractCandidateContractTermsFromText, JsonContractTermStore } from './contract-terms'
import { createDataDictionaryEntry, JsonDataDictionaryStore } from './data-dictionary'
import { createFindingComment, JsonFindingCommentStore } from './finding-comments'
import { createFindingSuppressionFromRejectedFinding, JsonFindingSuppressionStore } from './finding-suppressions'
import { createIntakeResponse, JsonIntakeStore } from './intake'
import { JsonParsedRecordStore, JsonParseJobStore, runParseForUploadWithRecords } from './parse-jobs'
import { createPricingRule, JsonPricingRuleStore } from './pricing-rules'
import { generateUsageWithoutInvoiceFindings, JsonFindingStore } from './reconciliation'
import { createReconciliationSchedule, JsonReconciliationScheduleStore } from './reconciliation-schedules'
import { JsonReminderEmailStore, reminderEmailSchema } from './reminders'
import { createReportBuilderConfig, JsonReportBuilderConfigStore } from './report-builder'
import { createRuleRunRecord, JsonRuleRunStore } from './rule-runs'
import {
  JsonStripeConnectionStore,
  JsonStripeResourceSnapshotStore,
  JsonStripeSyncRunStore,
  createStripeConnection,
  runAndPersistStripeReadOnlySync,
} from './stripe-connector'
import { createUploadRecord, createUploadTaskComment, JsonUploadStore, JsonUploadTaskCommentStore, LocalUploadStorage } from './uploads'
import { createWarehouseCsvConnection, JsonWarehouseCsvConnectionStore } from './warehouse-connector'
import { deleteWorkspaceData } from './workspace-deletion'

describe('workspace data deletion', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-deletion-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('deletes one workspace raw files and derived data while preserving other workspaces and a minimal deletion audit event', async () => {
    const uploadStore = new JsonUploadStore(join(tempDir, 'uploads.json'))
    const uploadTaskCommentStore = new JsonUploadTaskCommentStore(join(tempDir, 'upload-comments.json'))
    const parseJobStore = new JsonParseJobStore(join(tempDir, 'parse-jobs.json'))
    const parsedRecordStore = new JsonParsedRecordStore(join(tempDir, 'parsed-records.json'))
    const findingStore = new JsonFindingStore(join(tempDir, 'findings.json'))
    const findingCommentStore = new JsonFindingCommentStore(join(tempDir, 'finding-comments.json'))
    const findingSuppressionStore = new JsonFindingSuppressionStore(join(tempDir, 'finding-suppressions.json'))
    const auditLogStore = new JsonAuditLogStore(join(tempDir, 'audit-log.json'))
    const ruleRunStore = new JsonRuleRunStore(join(tempDir, 'rule-runs.json'))
    const reconciliationScheduleStore = new JsonReconciliationScheduleStore(join(tempDir, 'reconciliation-schedules.json'))
    const reminderEmailStore = new JsonReminderEmailStore(join(tempDir, 'reminder-emails.json'))
    const stripeConnectionStore = new JsonStripeConnectionStore(join(tempDir, 'stripe-connections.json'))
    const stripeSyncRunStore = new JsonStripeSyncRunStore(join(tempDir, 'stripe-sync-runs.json'))
    const stripeResourceSnapshotStore = new JsonStripeResourceSnapshotStore(join(tempDir, 'stripe-resource-snapshots.json'))
    const warehouseCsvConnectionStore = new JsonWarehouseCsvConnectionStore(join(tempDir, 'warehouse-connections.json'))
    const reportBuilderConfigStore = new JsonReportBuilderConfigStore(join(tempDir, 'report-builder.json'))
    const intakeStore = new JsonIntakeStore(join(tempDir, 'intake.json'))
    const pricingRuleStore = new JsonPricingRuleStore(join(tempDir, 'pricing-rules.json'))
    const contractTermStore = new JsonContractTermStore(join(tempDir, 'contract-terms.json'))
    const accountMappingStore = new JsonAccountMappingStore(join(tempDir, 'account-mappings.json'))
    const dataDictionaryStore = new JsonDataDictionaryStore(join(tempDir, 'data-dictionary.json'))
    const uploadStorage = new LocalUploadStorage(join(tempDir, 'files'))

    const targetUpload = await saveUsageUpload('workspace_001', uploadStore, uploadStorage)
    const otherUpload = await saveUsageUpload('workspace_002', uploadStore, uploadStorage)
    const targetExecution = await runParseForUploadWithRecords(targetUpload, uploadStorage, new Date('2026-06-01T10:00:00.000Z'))
    const otherExecution = await runParseForUploadWithRecords(otherUpload, uploadStorage, new Date('2026-06-01T10:05:00.000Z'))
    const targetFindings = generateUsageWithoutInvoiceFindings(targetExecution.records, new Date('2026-06-01T10:10:00.000Z'))
    const otherFindings = generateUsageWithoutInvoiceFindings(otherExecution.records, new Date('2026-06-01T10:15:00.000Z'))
    const targetSuppression = createFindingSuppressionFromRejectedFinding(targetFindings[0], {
      createdBy: 'internal_admin',
      reason: 'Target workspace false positive.',
      createdAt: new Date('2026-06-01T10:16:00.000Z'),
    })
    const otherSuppression = createFindingSuppressionFromRejectedFinding(otherFindings[0], {
      createdBy: 'internal_admin',
      reason: 'Other workspace false positive.',
      createdAt: new Date('2026-06-01T10:17:00.000Z'),
    })
    const targetRuleRun = createRuleRunRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      status: 'reviewing',
      ruleVersion: 'reconciliation_rules_v1',
      inputs: {
        ruleTemplateIds: ['usage_without_invoice'],
        parsedRecordCount: 1,
        contractTermCount: 0,
        accountMappingCount: 0,
      },
      output: {
        findingCount: targetFindings.length,
        findingIds: targetFindings.map((finding) => finding.id),
        findingCategories: targetFindings.map((finding) => finding.category),
      },
      errors: [],
      startedAt: new Date('2026-06-01T10:30:00.000Z'),
      completedAt: new Date('2026-06-01T10:30:01.000Z'),
    })
    const otherRuleRun = createRuleRunRecord({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      actorId: 'internal_admin',
      status: 'reviewing',
      ruleVersion: 'reconciliation_rules_v1',
      inputs: {
        ruleTemplateIds: ['usage_without_invoice'],
        parsedRecordCount: 1,
        contractTermCount: 0,
        accountMappingCount: 0,
      },
      output: {
        findingCount: otherFindings.length,
        findingIds: otherFindings.map((finding) => finding.id),
        findingCategories: otherFindings.map((finding) => finding.category),
      },
      errors: [],
      startedAt: new Date('2026-06-01T10:35:00.000Z'),
      completedAt: new Date('2026-06-01T10:35:01.000Z'),
    })
    const targetReconciliationSchedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'Target close pre-check',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        runAt: '2026-06-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        ruleTemplateIds: ['usage_without_invoice'],
        createdBy: 'user_customer',
      },
      new Date('2026-06-01T10:36:00.000Z'),
    )
    const otherReconciliationSchedule = createReconciliationSchedule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        name: 'Other close pre-check',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        runAt: '2026-06-03T08:00:00.000Z',
        timezone: 'Europe/Dublin',
        ruleTemplateIds: ['usage_without_invoice'],
        createdBy: 'user_customer',
      },
      new Date('2026-06-01T10:37:00.000Z'),
    )
    const targetIntake = createIntakeResponse({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      answers: { billing_model: 'Enterprise plus overages' },
      updatedBy: 'user_customer',
    })
    const otherIntake = createIntakeResponse({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      answers: { billing_model: 'Flat subscription' },
      updatedBy: 'user_customer',
    })
    const targetPricingRule = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'Target overage rate',
        type: 'overage_rate',
        rate: 1.25,
        currency: 'EUR',
        createdBy: 'user_customer',
      },
      new Date('2026-06-01T10:17:30.000Z'),
    )
    const otherPricingRule = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        name: 'Other overage rate',
        type: 'overage_rate',
        rate: 2.5,
        currency: 'EUR',
        createdBy: 'user_customer',
      },
      new Date('2026-06-01T10:17:35.000Z'),
    )
    const targetTerms = extractCandidateContractTermsFromText({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceFileId: targetUpload.sourceFileId,
      text: 'Page 3: Overage charged at EUR 2.50 per 1k API calls.',
    })
    const otherTerms = extractCandidateContractTermsFromText({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      sourceFileId: otherUpload.sourceFileId,
      text: 'Page 3: Overage charged at EUR 3.00 per 1k API calls.',
    })
    const targetMapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      displayName: 'Acme AI',
      usageAccountId: 'acct_acme_usage',
      stripeCustomerId: 'cus_acme_stripe',
      reviewerId: 'internal_admin',
    })
    const otherMapping = createManualAccountMapping({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      displayName: 'Other AI',
      usageAccountId: 'acct_other_usage',
      stripeCustomerId: 'cus_other_stripe',
      reviewerId: 'internal_admin',
    })
    const targetDictionaryEntry = createDataDictionaryEntry({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      sourceCategory: 'usage_csv',
      sourceField: 'meter_name',
      meaning: 'Target workspace meter definition.',
      createdBy: 'internal_admin',
    })
    const otherDictionaryEntry = createDataDictionaryEntry({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      sourceCategory: 'usage_csv',
      sourceField: 'meter_name',
      meaning: 'Other workspace meter definition.',
      createdBy: 'internal_admin',
    })
    const targetReminder = reminderEmailSchema.parse({
      id: 'reminder_workspace_001_readout_customer_001_2026_06_01T10_40_00_000Z',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      type: 'readout',
      recipientEmail: 'finance@workspace-001.example',
      recipientName: 'Finance Lead',
      subject: 'Workspace 001 audit: readout on 10 Jun 2026',
      body: 'Readout reminder for workspace 001.',
      sentBy: 'internal_admin',
      sentAt: '2026-06-01T10:40:00.000Z',
      status: 'sent',
      metadata: {
        readoutDate: '2026-06-10',
      },
    })
    const otherReminder = reminderEmailSchema.parse({
      id: 'reminder_workspace_002_readout_customer_002_2026_06_01T10_45_00_000Z',
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      type: 'readout',
      recipientEmail: 'finance@workspace-002.example',
      recipientName: 'Finance Lead',
      subject: 'Workspace 002 audit: readout on 11 Jun 2026',
      body: 'Readout reminder for workspace 002.',
      sentBy: 'internal_admin',
      sentAt: '2026-06-01T10:45:00.000Z',
      status: 'sent',
      metadata: {
        readoutDate: '2026-06-11',
      },
    })
    const targetStripeConnection = createStripeConnection(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        accountLabel: 'Target Stripe',
        secretKey: 'sk_live_target_secret',
        connectedBy: 'user_customer',
      },
      new Date('2026-06-01T10:50:00.000Z'),
    )
    const otherStripeConnection = createStripeConnection(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        accountLabel: 'Other Stripe',
        secretKey: 'sk_live_other_secret',
        connectedBy: 'user_customer',
      },
      new Date('2026-06-01T10:55:00.000Z'),
    )
    const targetWarehouseConnection = createWarehouseCsvConnection(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        sourceLabel: 'Target warehouse usage',
        exportUrl: 'https://warehouse.example.com/target.csv?token=sensitive',
        schedule: 'daily',
        connectedBy: 'user_customer',
        usageCsvMapping: {
          accountId: 'account_id',
          customerName: 'customer_name',
          meter: 'meter_name',
          quantity: 'total',
          unit: 'unit',
          periodStart: 'start',
          periodEnd: 'end',
        },
      },
      new Date('2026-06-01T10:58:00.000Z'),
    )
    const otherWarehouseConnection = createWarehouseCsvConnection(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        sourceLabel: 'Other warehouse usage',
        exportUrl: 'https://warehouse.example.com/other.csv?token=sensitive',
        schedule: 'weekly',
        connectedBy: 'user_customer',
        usageCsvMapping: {
          accountId: 'account_id',
          customerName: 'customer_name',
          meter: 'meter_name',
          quantity: 'total',
          unit: 'unit',
          periodStart: 'start',
          periodEnd: 'end',
        },
      },
      new Date('2026-06-01T10:59:00.000Z'),
    )

    await parseJobStore.save(targetExecution.job)
    await parseJobStore.save(otherExecution.job)
    await parsedRecordStore.saveMany([...targetExecution.records, ...otherExecution.records])
    await findingStore.saveMany([...targetFindings, ...otherFindings])
    await findingSuppressionStore.save(targetSuppression)
    await findingSuppressionStore.save(otherSuppression)
    await ruleRunStore.save(targetRuleRun)
    await ruleRunStore.save(otherRuleRun)
    await reconciliationScheduleStore.save(targetReconciliationSchedule)
    await reconciliationScheduleStore.save(otherReconciliationSchedule)
    await reportBuilderConfigStore.save(
      createReportBuilderConfig({
        workspaceId: 'workspace_001',
        selectedFindingIds: [targetFindings[0].id],
        noteFindingIds: [targetFindings[0].id],
        updatedBy: 'internal_admin',
      }),
    )
    await reportBuilderConfigStore.save(
      createReportBuilderConfig({
        workspaceId: 'workspace_002',
        selectedFindingIds: [otherFindings[0].id],
        noteFindingIds: [],
        updatedBy: 'internal_admin',
      }),
    )
    await intakeStore.save(targetIntake)
    await intakeStore.save(otherIntake)
    await pricingRuleStore.saveMany([targetPricingRule, otherPricingRule])
    await contractTermStore.saveMany([...targetTerms, ...otherTerms])
    await accountMappingStore.saveMany([targetMapping, otherMapping])
    await dataDictionaryStore.saveMany([targetDictionaryEntry, otherDictionaryEntry])
    await reminderEmailStore.saveMany([targetReminder, otherReminder])
    await stripeConnectionStore.save(targetStripeConnection)
    await stripeConnectionStore.save(otherStripeConnection)
    await warehouseCsvConnectionStore.save(targetWarehouseConnection)
    await warehouseCsvConnectionStore.save(otherWarehouseConnection)
    await runAndPersistStripeReadOnlySync({
      connection: targetStripeConnection,
      secretKey: 'sk_live_target_secret',
      requestedBy: 'internal_admin',
      resources: ['invoices'],
      fetchImpl: stripeResourceFetch,
      syncRunStore: stripeSyncRunStore,
      snapshotStore: stripeResourceSnapshotStore,
      now: new Date('2026-06-01T10:56:00.000Z'),
    })
    const otherStripeSyncRun = await runAndPersistStripeReadOnlySync({
      connection: otherStripeConnection,
      secretKey: 'sk_live_other_secret',
      requestedBy: 'internal_admin',
      resources: ['customers'],
      fetchImpl: stripeResourceFetch,
      syncRunStore: stripeSyncRunStore,
      snapshotStore: stripeResourceSnapshotStore,
      now: new Date('2026-06-01T10:57:00.000Z'),
    })
    await uploadTaskCommentStore.save(
      createUploadTaskComment({
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        category: 'usage_csv',
        body: 'Please resend this upload with period_end populated.',
        authorId: 'internal_admin',
        authorName: 'Rory',
        authorRole: 'internal_admin',
      }),
    )
    const otherComment = createUploadTaskComment({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      category: 'usage_csv',
      body: 'Preserve this other workspace conversation.',
      authorId: 'internal_admin',
      authorName: 'Rory',
      authorRole: 'internal_admin',
    })
    await uploadTaskCommentStore.save(otherComment)
    await findingCommentStore.save(
      createFindingComment({
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        findingId: targetFindings[0].id,
        body: 'Target workspace finding discussion.',
        authorId: 'user_customer',
        authorName: 'Customer Finance',
        authorRole: 'customer_admin',
      }),
    )
    const otherFindingComment = createFindingComment({
      organizationId: 'org_001',
      workspaceId: 'workspace_002',
      findingId: otherFindings[0].id,
      body: 'Preserve this other finding discussion.',
      authorId: 'internal_admin',
      authorName: 'Rory',
      authorRole: 'internal_admin',
    })
    await findingCommentStore.save(otherFindingComment)
    await auditLogStore.append(
      createAuditLogEvent(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_001',
          actorId: 'user_customer',
          action: 'file_uploaded',
          targetType: 'upload',
          targetId: targetUpload.id,
          metadata: { filename: targetUpload.filename },
        },
        new Date('2026-06-01T10:20:00.000Z'),
      ),
    )
    await auditLogStore.append(
      createAuditLogEvent(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_002',
          actorId: 'user_customer',
          action: 'file_uploaded',
          targetType: 'upload',
          targetId: otherUpload.id,
          metadata: { filename: otherUpload.filename },
        },
        new Date('2026-06-01T10:25:00.000Z'),
      ),
    )

    const result = await deleteWorkspaceData(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'internal_admin',
        uploadStore,
        uploadTaskCommentStore,
        uploadStorage,
        parseJobStore,
        parsedRecordStore,
        findingStore,
        findingCommentStore,
        findingSuppressionStore,
        ruleRunStore,
        reconciliationScheduleStore,
        reminderEmailStore,
        stripeConnectionStore,
        stripeSyncRunStore,
        stripeResourceSnapshotStore,
        warehouseCsvConnectionStore,
        reportBuilderConfigStore,
        pricingRuleStore,
        auditLogStore,
        intakeStore,
        contractTermStore,
        accountMappingStore,
        dataDictionaryStore,
      },
      new Date('2026-06-01T11:00:00.000Z'),
    )

    expect(result).toEqual({
      workspaceId: 'workspace_001',
      uploadsDeleted: 1,
      parseJobsDeleted: 1,
      parsedRecordsDeleted: 1,
      findingsDeleted: 1,
      findingCommentsDeleted: 1,
      findingSuppressionsDeleted: 1,
      ruleRunsDeleted: 1,
      reconciliationSchedulesDeleted: 1,
      reminderEmailsDeleted: 1,
      stripeConnectionsDeleted: 1,
      stripeSyncRunsDeleted: 1,
      stripeResourceSnapshotsDeleted: 1,
      warehouseCsvConnectionsDeleted: 1,
      reportBuilderConfigsDeleted: 1,
      intakeResponsesDeleted: 1,
      pricingRulesDeleted: 1,
      contractTermsDeleted: 1,
      accountMappingsDeleted: 1,
      dataDictionaryEntriesDeleted: 1,
      uploadTaskCommentsDeleted: 1,
      auditEventsDeleted: 1,
      rawFileWorkspaceDeleted: true,
    })
    await expect(uploadStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(parseJobStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(parsedRecordStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(findingStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(findingCommentStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(findingSuppressionStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(ruleRunStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(reconciliationScheduleStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(reminderEmailStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(stripeConnectionStore.getByWorkspace('workspace_001')).resolves.toBeNull()
    await expect(stripeSyncRunStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(stripeResourceSnapshotStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(warehouseCsvConnectionStore.getByWorkspace('workspace_001')).resolves.toBeNull()
    await expect(reportBuilderConfigStore.getByWorkspace('workspace_001')).resolves.toBeNull()
    await expect(intakeStore.getByWorkspace('workspace_001')).resolves.toBeNull()
    await expect(pricingRuleStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(contractTermStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(accountMappingStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(dataDictionaryStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(uploadTaskCommentStore.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(uploadStorage.readBytes(targetUpload.storageKey)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(uploadStorage.readBytes(otherUpload.storageKey)).resolves.toEqual(Buffer.from(usageCsv('workspace_002')))
    await expect(uploadStore.listByWorkspace('workspace_002')).resolves.toEqual([otherUpload])
    await expect(parseJobStore.listByWorkspace('workspace_002')).resolves.toEqual([otherExecution.job])
    await expect(parsedRecordStore.listByWorkspace('workspace_002')).resolves.toEqual(otherExecution.records)
    await expect(findingStore.listByWorkspace('workspace_002')).resolves.toEqual(otherFindings)
    await expect(findingCommentStore.listByWorkspace('workspace_002')).resolves.toEqual([otherFindingComment])
    await expect(findingSuppressionStore.listByWorkspace('workspace_002')).resolves.toEqual([otherSuppression])
    await expect(ruleRunStore.listByWorkspace('workspace_002')).resolves.toEqual([otherRuleRun])
    await expect(reconciliationScheduleStore.listByWorkspace('workspace_002')).resolves.toEqual([otherReconciliationSchedule])
    await expect(reminderEmailStore.listByWorkspace('workspace_002')).resolves.toEqual([otherReminder])
    await expect(stripeConnectionStore.getByWorkspace('workspace_002')).resolves.toEqual(otherStripeConnection)
    await expect(stripeSyncRunStore.listByWorkspace('workspace_002')).resolves.toEqual([otherStripeSyncRun])
    await expect(stripeResourceSnapshotStore.listByWorkspace('workspace_002')).resolves.toEqual([
      expect.objectContaining({
        syncRunId: otherStripeSyncRun.id,
        resource: 'customers',
        objectId: 'cus_001',
      }),
    ])
    await expect(warehouseCsvConnectionStore.getByWorkspace('workspace_002')).resolves.toEqual(otherWarehouseConnection)
    await expect(reportBuilderConfigStore.getByWorkspace('workspace_002')).resolves.toMatchObject({
      workspaceId: 'workspace_002',
      selectedFindingIds: [otherFindings[0].id],
    })
    await expect(intakeStore.getByWorkspace('workspace_002')).resolves.toEqual(otherIntake)
    await expect(pricingRuleStore.listByWorkspace('workspace_002')).resolves.toEqual([otherPricingRule])
    await expect(contractTermStore.listByWorkspace('workspace_002')).resolves.toEqual(otherTerms)
    await expect(accountMappingStore.listByWorkspace('workspace_002')).resolves.toEqual([otherMapping])
    await expect(dataDictionaryStore.listByWorkspace('workspace_002')).resolves.toEqual([otherDictionaryEntry])
    await expect(uploadTaskCommentStore.listByWorkspace('workspace_002')).resolves.toEqual([otherComment])

    const targetAuditEvents = await auditLogStore.listByWorkspace('workspace_001')
    expect(targetAuditEvents).toMatchObject([
      {
        action: 'workspace_data_deleted',
        actorId: 'internal_admin',
        targetType: 'workspace',
        targetId: 'workspace_001',
        metadata: {
          uploadsDeleted: 1,
          parseJobsDeleted: 1,
          parsedRecordsDeleted: 1,
          findingsDeleted: 1,
          findingCommentsDeleted: 1,
          findingSuppressionsDeleted: 1,
          ruleRunsDeleted: 1,
          reconciliationSchedulesDeleted: 1,
          reminderEmailsDeleted: 1,
          stripeConnectionsDeleted: 1,
          stripeSyncRunsDeleted: 1,
          stripeResourceSnapshotsDeleted: 1,
          warehouseCsvConnectionsDeleted: 1,
          reportBuilderConfigsDeleted: 1,
          intakeResponsesDeleted: 1,
          pricingRulesDeleted: 1,
          contractTermsDeleted: 1,
          accountMappingsDeleted: 1,
          dataDictionaryEntriesDeleted: 1,
          uploadTaskCommentsDeleted: 1,
          auditEventsDeleted: 1,
        },
        createdAt: '2026-06-01T11:00:00.000Z',
      },
    ])
    await expect(auditLogStore.listByWorkspace('workspace_002')).resolves.toMatchObject([
      {
        action: 'file_uploaded',
        targetId: otherUpload.id,
      },
    ])
    await expect(readFile(join(tempDir, 'uploads.json'), 'utf8')).resolves.toContain('workspace_002')
  })
})

async function saveUsageUpload(workspaceId: string, uploadStore: JsonUploadStore, uploadStorage: LocalUploadStorage) {
  const saved = await uploadStorage.save({
    workspaceId,
    category: 'usage_csv',
    filename: 'usage.csv',
    bytes: Buffer.from(usageCsv(workspaceId)),
  })
  const upload = createUploadRecord({
    organizationId: 'org_001',
    workspaceId,
    category: 'usage_csv',
    filename: 'usage.csv',
    uploadedBy: 'user_customer',
    ...saved,
  })

  await uploadStore.save(upload)

  return upload
}

function usageCsv(workspaceId: string) {
  return [
    'account_id,customer_name,meter_name,total,unit,start,end',
    `${workspaceId}_acct,Acme AI,llm_tokens,250000,tokens,2026-05-01,2026-05-31`,
  ].join('\n')
}

async function stripeResourceFetch(url: string) {
  const resource = url.match(/\/v1\/([^?]+)/)?.[1]
  const objectIds: Record<string, string> = {
    invoices: 'in_001',
    customers: 'cus_001',
  }

  if (!resource || !objectIds[resource]) {
    throw new Error(`Unexpected Stripe URL: ${url}`)
  }

  return {
    ok: true,
    status: 200,
    async json() {
      return {
        data: [{ id: objectIds[resource] }],
        has_more: false,
      }
    },
  }
}
