import { createAuditLogEvent, type JsonAuditLogStore } from './audit-log'
import { type JsonAccountMappingStore } from './account-mapping'
import { type JsonContractTermStore } from './contract-terms'
import { type JsonDataDictionaryStore } from './data-dictionary'
import { type JsonFindingCommentStore } from './finding-comments'
import { type JsonFindingSuppressionStore } from './finding-suppressions'
import { type JsonIntakeStore } from './intake'
import { type JsonParsedRecordStore, type JsonParseJobStore } from './parse-jobs'
import { type JsonPricingRuleStore } from './pricing-rules'
import { type JsonFindingStore } from './reconciliation'
import { type JsonReconciliationScheduleStore } from './reconciliation-schedules'
import { type JsonReminderEmailStore } from './reminders'
import { type JsonReportBuilderConfigStore } from './report-builder'
import { type JsonRuleRunStore } from './rule-runs'
import { type JsonStripeConnectionStore, type JsonStripeResourceSnapshotStore, type JsonStripeSyncRunStore } from './stripe-connector'
import { type JsonUploadStore, type JsonUploadTaskCommentStore, type UploadStorage } from './uploads'
import { type JsonWarehouseCsvConnectionStore } from './warehouse-connector'

export type DeleteWorkspaceDataInput = {
  organizationId: string
  workspaceId: string
  actorId: string
  uploadStore: JsonUploadStore
  uploadTaskCommentStore: JsonUploadTaskCommentStore
  uploadStorage: UploadStorage
  parseJobStore: JsonParseJobStore
  parsedRecordStore: JsonParsedRecordStore
  findingStore: JsonFindingStore
  findingCommentStore: JsonFindingCommentStore
  findingSuppressionStore: JsonFindingSuppressionStore
  ruleRunStore: JsonRuleRunStore
  reconciliationScheduleStore: JsonReconciliationScheduleStore
  reminderEmailStore: JsonReminderEmailStore
  stripeConnectionStore: JsonStripeConnectionStore
  stripeSyncRunStore: JsonStripeSyncRunStore
  stripeResourceSnapshotStore: JsonStripeResourceSnapshotStore
  warehouseCsvConnectionStore: JsonWarehouseCsvConnectionStore
  reportBuilderConfigStore: JsonReportBuilderConfigStore
  intakeStore: JsonIntakeStore
  pricingRuleStore: JsonPricingRuleStore
  contractTermStore: JsonContractTermStore
  accountMappingStore: JsonAccountMappingStore
  dataDictionaryStore: JsonDataDictionaryStore
  auditLogStore: JsonAuditLogStore
}

export type DeleteWorkspaceDataResult = {
  workspaceId: string
  uploadsDeleted: number
  parseJobsDeleted: number
  parsedRecordsDeleted: number
  findingsDeleted: number
  findingCommentsDeleted: number
  findingSuppressionsDeleted: number
  ruleRunsDeleted: number
  reconciliationSchedulesDeleted: number
  reminderEmailsDeleted: number
  stripeConnectionsDeleted: number
  stripeSyncRunsDeleted: number
  stripeResourceSnapshotsDeleted: number
  warehouseCsvConnectionsDeleted: number
  reportBuilderConfigsDeleted: number
  intakeResponsesDeleted: number
  pricingRulesDeleted: number
  contractTermsDeleted: number
  accountMappingsDeleted: number
  dataDictionaryEntriesDeleted: number
  uploadTaskCommentsDeleted: number
  auditEventsDeleted: number
  rawFileWorkspaceDeleted: boolean
}

export async function deleteWorkspaceData(input: DeleteWorkspaceDataInput, now = new Date()): Promise<DeleteWorkspaceDataResult> {
  const uploadsDeleted = await input.uploadStore.deleteByWorkspace(input.workspaceId)
  const parseJobsDeleted = await input.parseJobStore.deleteByWorkspace(input.workspaceId)
  const parsedRecordsDeleted = await input.parsedRecordStore.deleteByWorkspace(input.workspaceId)
  const findingsDeleted = await input.findingStore.deleteByWorkspace(input.workspaceId)
  const findingCommentsDeleted = await input.findingCommentStore.deleteByWorkspace(input.workspaceId)
  const findingSuppressionsDeleted = await input.findingSuppressionStore.deleteByWorkspace(input.workspaceId)
  const ruleRunsDeleted = await input.ruleRunStore.deleteByWorkspace(input.workspaceId)
  const reconciliationSchedulesDeleted = await input.reconciliationScheduleStore.deleteByWorkspace(input.workspaceId)
  const reminderEmailsDeleted = await input.reminderEmailStore.deleteByWorkspace(input.workspaceId)
  const stripeConnectionsDeleted = await input.stripeConnectionStore.deleteByWorkspace(input.workspaceId)
  const stripeSyncRunsDeleted = await input.stripeSyncRunStore.deleteByWorkspace(input.workspaceId)
  const stripeResourceSnapshotsDeleted = await input.stripeResourceSnapshotStore.deleteByWorkspace(input.workspaceId)
  const warehouseCsvConnectionsDeleted = await input.warehouseCsvConnectionStore.deleteByWorkspace(input.workspaceId)
  const reportBuilderConfigsDeleted = await input.reportBuilderConfigStore.deleteByWorkspace(input.workspaceId)
  const intakeResponsesDeleted = await input.intakeStore.deleteByWorkspace(input.workspaceId)
  const pricingRulesDeleted = await input.pricingRuleStore.deleteByWorkspace(input.workspaceId)
  const contractTermsDeleted = await input.contractTermStore.deleteByWorkspace(input.workspaceId)
  const accountMappingsDeleted = await input.accountMappingStore.deleteByWorkspace(input.workspaceId)
  const dataDictionaryEntriesDeleted = await input.dataDictionaryStore.deleteByWorkspace(input.workspaceId)
  const uploadTaskCommentsDeleted = await input.uploadTaskCommentStore.deleteByWorkspace(input.workspaceId)
  const auditEventsDeleted = await input.auditLogStore.deleteByWorkspace(input.workspaceId)
  const rawFileWorkspaceDeleted = await input.uploadStorage.deleteWorkspace(input.workspaceId)
  const result = {
    workspaceId: input.workspaceId,
    uploadsDeleted,
    parseJobsDeleted,
    parsedRecordsDeleted,
    findingsDeleted,
    findingCommentsDeleted,
    findingSuppressionsDeleted,
    ruleRunsDeleted,
    reconciliationSchedulesDeleted,
    reminderEmailsDeleted,
    stripeConnectionsDeleted,
    stripeSyncRunsDeleted,
    stripeResourceSnapshotsDeleted,
    warehouseCsvConnectionsDeleted,
    reportBuilderConfigsDeleted,
    intakeResponsesDeleted,
    pricingRulesDeleted,
    contractTermsDeleted,
    accountMappingsDeleted,
    dataDictionaryEntriesDeleted,
    uploadTaskCommentsDeleted,
    auditEventsDeleted,
    rawFileWorkspaceDeleted,
  }

  await input.auditLogStore.append(
    createAuditLogEvent(
      {
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: 'workspace_data_deleted',
        targetType: 'workspace',
        targetId: input.workspaceId,
        metadata: {
          uploadsDeleted,
          parseJobsDeleted,
          parsedRecordsDeleted,
          findingsDeleted,
          findingCommentsDeleted,
          findingSuppressionsDeleted,
          ruleRunsDeleted,
          reconciliationSchedulesDeleted,
          reminderEmailsDeleted,
          stripeConnectionsDeleted,
          stripeSyncRunsDeleted,
          stripeResourceSnapshotsDeleted,
          warehouseCsvConnectionsDeleted,
          reportBuilderConfigsDeleted,
          intakeResponsesDeleted,
          pricingRulesDeleted,
          contractTermsDeleted,
          accountMappingsDeleted,
          dataDictionaryEntriesDeleted,
          uploadTaskCommentsDeleted,
          auditEventsDeleted,
        },
      },
      now,
    ),
  )

  return result
}
