import { join } from 'node:path'

import { JsonInviteStore } from '../auth/invites'
import { JsonAppBillingStore } from './app-billing'
import { JsonAuditLogStore } from './audit-log'
import { JsonAccountMappingStore } from './account-mapping'
import { JsonContractTermStore } from './contract-terms'
import { JsonDataDictionaryStore } from './data-dictionary'
import { JsonFindingCommentStore } from './finding-comments'
import { JsonFindingSuppressionStore } from './finding-suppressions'
import { JsonIntakeStore } from './intake'
import { JsonParsedRecordStore, JsonParseJobStore } from './parse-jobs'
import { JsonPilotConversionStore } from './pilot-conversions'
import { JsonPricingRuleStore } from './pricing-rules'
import { JsonFindingStore } from './reconciliation'
import { JsonReconciliationScheduleStore } from './reconciliation-schedules'
import { JsonReminderEmailStore } from './reminders'
import { JsonReportBuilderConfigStore } from './report-builder'
import { JsonRuleRunStore } from './rule-runs'
import { JsonStripeConnectionStore, JsonStripeResourceSnapshotStore, JsonStripeSyncRunStore } from './stripe-connector'
import { JsonUploadStore, JsonUploadTaskCommentStore, LocalUploadStorage, SupabaseUploadStorage } from './uploads'
import { JsonWarehouseCsvConnectionStore } from './warehouse-connector'
import { defaultAuditWorkspace, JsonAuditWorkspaceStore } from './workspaces'
import { isSupabasePersistenceEnabled } from './persistence'

export const DEFAULT_ORGANIZATION_ID = defaultAuditWorkspace.organizationId
export const DEFAULT_WORKSPACE_ID = defaultAuditWorkspace.id
export const DEFAULT_CUSTOMER_USER_ID = 'user_customer'
export const DEFAULT_INTERNAL_USER_ID = 'internal_admin'
export const DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS = 300

export function getWorkspaceStore() {
  return new JsonAuditWorkspaceStore(process.env.AUDIT_WORKSPACE_PATH ?? join(process.cwd(), '.local', 'workspaces.json'), [
    defaultAuditWorkspace,
  ])
}

export function getInviteStore() {
  return new JsonInviteStore(process.env.AUDIT_INVITE_PATH ?? join(process.cwd(), '.local', 'invites.json'))
}

export function getUploadStore() {
  return new JsonUploadStore(process.env.AUDIT_UPLOAD_METADATA_PATH ?? join(process.cwd(), '.local', 'uploads.json'))
}

export function getUploadTaskCommentStore() {
  return new JsonUploadTaskCommentStore(process.env.AUDIT_UPLOAD_COMMENT_PATH ?? join(process.cwd(), '.local', 'upload-comments.json'))
}

export function getUploadStorage() {
  if (isSupabasePersistenceEnabled()) {
    return new SupabaseUploadStorage()
  }

  return new LocalUploadStorage(process.env.AUDIT_UPLOAD_STORAGE_ROOT ?? join(process.cwd(), '.local', 'files'))
}

export function getParseJobStore() {
  return new JsonParseJobStore(process.env.AUDIT_PARSE_JOB_PATH ?? join(process.cwd(), '.local', 'parse-jobs.json'))
}

export function getParsedRecordStore() {
  return new JsonParsedRecordStore(process.env.AUDIT_PARSED_RECORD_PATH ?? join(process.cwd(), '.local', 'parsed-records.json'))
}

export function getFindingStore() {
  return new JsonFindingStore(process.env.AUDIT_FINDING_PATH ?? join(process.cwd(), '.local', 'findings.json'))
}

export function getFindingCommentStore() {
  return new JsonFindingCommentStore(process.env.AUDIT_FINDING_COMMENT_PATH ?? join(process.cwd(), '.local', 'finding-comments.json'))
}

export function getFindingSuppressionStore() {
  return new JsonFindingSuppressionStore(
    process.env.AUDIT_FINDING_SUPPRESSION_PATH ?? join(process.cwd(), '.local', 'finding-suppressions.json'),
  )
}

export function getRuleRunStore() {
  return new JsonRuleRunStore(process.env.AUDIT_RULE_RUN_PATH ?? join(process.cwd(), '.local', 'rule-runs.json'))
}

export function getReconciliationScheduleStore() {
  return new JsonReconciliationScheduleStore(
    process.env.AUDIT_RECONCILIATION_SCHEDULE_PATH ?? join(process.cwd(), '.local', 'reconciliation-schedules.json'),
  )
}

export function getReportBuilderConfigStore() {
  return new JsonReportBuilderConfigStore(
    process.env.AUDIT_REPORT_BUILDER_PATH ?? join(process.cwd(), '.local', 'report-builder.json'),
  )
}

export function getPilotConversionStore() {
  return new JsonPilotConversionStore(process.env.AUDIT_PILOT_CONVERSION_PATH ?? join(process.cwd(), '.local', 'pilot-conversions.json'))
}

export function getAppBillingStore() {
  return new JsonAppBillingStore(process.env.AUDIT_APP_BILLING_PATH ?? join(process.cwd(), '.local', 'app-billing.json'))
}

export function getPricingRuleStore() {
  return new JsonPricingRuleStore(process.env.AUDIT_PRICING_RULE_PATH ?? join(process.cwd(), '.local', 'pricing-rules.json'))
}

export function getReminderEmailStore() {
  return new JsonReminderEmailStore(process.env.AUDIT_REMINDER_EMAIL_PATH ?? join(process.cwd(), '.local', 'reminder-emails.json'))
}

export function getStripeConnectionStore() {
  return new JsonStripeConnectionStore(process.env.AUDIT_STRIPE_CONNECTION_PATH ?? join(process.cwd(), '.local', 'stripe-connections.json'))
}

export function getStripeSyncRunStore() {
  return new JsonStripeSyncRunStore(process.env.AUDIT_STRIPE_SYNC_RUN_PATH ?? join(process.cwd(), '.local', 'stripe-sync-runs.json'))
}

export function getStripeResourceSnapshotStore() {
  return new JsonStripeResourceSnapshotStore(
    process.env.AUDIT_STRIPE_RESOURCE_SNAPSHOT_PATH ?? join(process.cwd(), '.local', 'stripe-resource-snapshots.json'),
  )
}

export function getWarehouseCsvConnectionStore() {
  return new JsonWarehouseCsvConnectionStore(
    process.env.AUDIT_WAREHOUSE_CONNECTION_PATH ?? join(process.cwd(), '.local', 'warehouse-connections.json'),
  )
}

export function getContractTermStore() {
  return new JsonContractTermStore(process.env.AUDIT_CONTRACT_TERM_PATH ?? join(process.cwd(), '.local', 'contract-terms.json'))
}

export function getAccountMappingStore() {
  return new JsonAccountMappingStore(process.env.AUDIT_ACCOUNT_MAPPING_PATH ?? join(process.cwd(), '.local', 'account-mappings.json'))
}

export function getDataDictionaryStore() {
  return new JsonDataDictionaryStore(process.env.AUDIT_DATA_DICTIONARY_PATH ?? join(process.cwd(), '.local', 'data-dictionary.json'))
}

export function getAuditLogStore() {
  return new JsonAuditLogStore(process.env.AUDIT_LOG_PATH ?? join(process.cwd(), '.local', 'audit-log.json'))
}

export function getIntakeStore() {
  return new JsonIntakeStore(process.env.AUDIT_INTAKE_PATH ?? join(process.cwd(), '.local', 'intake.json'))
}

export function getDownloadTokenSecret() {
  return process.env.AUDIT_DOWNLOAD_TOKEN_SECRET ?? 'local-development-download-secret'
}
