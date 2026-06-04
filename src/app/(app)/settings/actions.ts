'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import {
  approvePricingRule,
  createPricingRule,
  isMaterialPricingRuleChange,
  pricingRuleTypeSchema,
  rejectPricingRule,
  requestPricingRuleCustomerApproval,
  updatePricingRule,
} from '@/lib/audit/pricing-rules'
import { createReconciliationSchedule } from '@/lib/audit/reconciliation-schedules'
import { buildFailedSyncAlertEmails } from '@/lib/audit/reminders'
import { ruleTemplateIdSchema } from '@/lib/audit/rule-templates'
import { contractBillingPeriodSchema } from '@/lib/audit/schemas'
import {
  createStripeConnection,
  normalizeStripeSyncSnapshotsToParseExecution,
  runAndPersistStripeReadOnlySync,
  type StripeSyncRun,
} from '@/lib/audit/stripe-connector'
import {
  getAuditLogStore,
  getInviteStore,
  getParsedRecordStore,
  getParseJobStore,
  getPricingRuleStore,
  getReconciliationScheduleStore,
  getReminderEmailStore,
  getStripeConnectionStore,
  getStripeResourceSnapshotStore,
  getStripeSyncRunStore,
  getUploadStorage,
  getUploadStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { createWarehouseCsvConnection, runAndPersistWarehouseCsvSync } from '@/lib/audit/warehouse-connector'
import { requireCurrentWorkspace, type AuditWorkspace } from '@/lib/audit/workspaces'
import type { Session } from '@/lib/auth/access'
import { requireSession } from '@/lib/auth/server'

const stripeConnectionFormSchema = z.object({
  accountLabel: z.string().trim().min(1),
  secretKey: z.string().trim().regex(/^sk_(live|test)_/, 'Use a Stripe secret key.'),
})
const stripeSyncFormSchema = z.object({
  syncSecretKey: z.string().trim().regex(/^sk_(live|test)_/, 'Use a Stripe secret key.'),
})
const warehouseScheduleSchema = z.enum(['manual', 'daily', 'weekly', 'monthly'])
const optionalColumnSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value : undefined),
  z.string().trim().min(1).optional(),
)
const warehouseConnectionFormSchema = z.object({
  sourceLabel: z.string().trim().min(1),
  exportUrl: z.string().trim().url(),
  schedule: warehouseScheduleSchema,
  usageAccountIdColumn: optionalColumnSchema,
  usageCustomerIdColumn: optionalColumnSchema,
  usageCustomerNameColumn: optionalColumnSchema,
  usageMeterColumn: z.string().trim().min(1),
  usageQuantityColumn: z.string().trim().min(1),
  usageUnitColumn: z.string().trim().min(1),
  usagePeriodStartColumn: z.string().trim().min(1),
  usagePeriodEndColumn: z.string().trim().min(1),
})
const warehouseSyncFormSchema = z.object({
  warehouseExportUrl: z.string().trim().url(),
})
const internalAlertRecipients = [{ email: 'internal@usageintegrity.local', name: 'Internal admin' }]
const scheduleRunAtSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => normalizeDateTimeInput(value))
  .pipe(z.string().datetime())
const lateUsageGracePeriodDaysSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? 0 : value),
  z.coerce.number().int().nonnegative(),
)
const optionalFormStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z.string().min(1).optional(),
)
const optionalFormNumberSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? Number.parseFloat(trimmed.replaceAll(',', '')) : undefined
}, z.number().nonnegative().optional())
const optionalBillingPeriodSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  contractBillingPeriodSchema.optional(),
)
const optionalDateSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
  z.string().date().optional(),
)
const reconciliationScheduleFormSchema = z
  .object({
    scheduleName: z.string().trim().min(1),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
    runAt: scheduleRunAtSchema,
    timezone: z.string().trim().min(1),
    lateUsageGracePeriodDays: lateUsageGracePeriodDaysSchema,
    ruleTemplateIds: z.array(ruleTemplateIdSchema).optional(),
  })
  .refine((input) => input.periodEnd >= input.periodStart, {
    message: 'Period end must be on or after period start.',
    path: ['periodEnd'],
  })
const pricingRuleFormSchema = z.object({
  pricingRuleId: optionalFormStringSchema,
  pricingRuleName: z.string().trim().min(1),
  pricingRuleType: pricingRuleTypeSchema,
  pricingRuleCustomerId: optionalFormStringSchema,
  pricingRuleMeter: optionalFormStringSchema,
  pricingRuleUnit: optionalFormStringSchema,
  pricingRuleBillingPeriod: optionalBillingPeriodSchema,
  pricingRuleRate: optionalFormNumberSchema,
  pricingRuleAllowance: optionalFormNumberSchema,
  pricingRuleThreshold: optionalFormNumberSchema,
  pricingRuleDiscountPercent: optionalFormNumberSchema,
  pricingRuleCurrency: optionalFormStringSchema,
  pricingRuleEffectiveFrom: optionalDateSchema,
  pricingRuleEffectiveTo: optionalDateSchema,
})
const pricingRuleApprovalFormSchema = z.object({
  pricingRuleId: z.string().trim().min(1),
  approvalDecision: z.enum(['approved', 'rejected']),
  approvalNote: optionalFormStringSchema,
})

export async function saveStripeConnectionAction(formData: FormData) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = stripeConnectionFormSchema.parse({
    accountLabel: formData.get('accountLabel'),
    secretKey: formData.get('secretKey'),
  })
  const connection = createStripeConnection({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    accountLabel: input.accountLabel,
    secretKey: input.secretKey,
    connectedBy: session.userId,
  })

  await getStripeConnectionStore().save(connection)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'stripe_connection_saved',
      targetType: 'connector',
      targetId: connection.id,
      metadata: {
        provider: connection.provider,
        mode: connection.mode,
        accountLabel: connection.accountLabel,
        secretRef: connection.secretRef,
      },
    }),
  )

  revalidatePath('/settings')
  redirect('/settings?stripe=connected')
}

export async function runStripeSyncAction(formData: FormData) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = stripeSyncFormSchema.parse({
    syncSecretKey: formData.get('syncSecretKey'),
  })
  const connection = await getStripeConnectionStore().getByWorkspace(workspace.id)

  if (!connection) {
    throw new Error(`Stripe connection not found for workspace: ${workspace.id}`)
  }

  const run = await runAndPersistStripeReadOnlySync({
    connection,
    secretKey: input.syncSecretKey,
    requestedBy: session.userId,
    syncRunStore: getStripeSyncRunStore(),
    snapshotStore: getStripeResourceSnapshotStore(),
  })
  const parseExecution = await normalizeStripeSyncSnapshotsToParseExecution({
    syncRun: run,
    snapshots: await getStripeResourceSnapshotStore().listByWorkspace(workspace.id),
  })
  const objectCount = run.resources.reduce((total, resource) => total + resource.objectCount, 0)

  await getParseJobStore().save(parseExecution.job)
  await getParsedRecordStore().saveMany(parseExecution.records)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'stripe_sync_run',
      targetType: 'connector',
      targetId: run.id,
      metadata: {
        provider: run.provider,
        mode: run.mode,
        status: run.status,
        objectCount,
        resourceCount: run.resources.length,
        parsedRecordCount: parseExecution.records.length,
      },
    }),
  )
  await sendFailedSyncAlertsIfNeeded({
    workspace,
    actorId: session.userId,
    connectorLabel: connection.accountLabel,
    provider: run.provider,
    run,
  })

  revalidatePath('/settings')
  redirect('/settings?stripe=synced')
}

export async function saveWarehouseCsvConnectionAction(formData: FormData) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = warehouseConnectionFormSchema.parse({
    sourceLabel: formData.get('sourceLabel'),
    exportUrl: formData.get('exportUrl'),
    schedule: formData.get('schedule'),
    usageAccountIdColumn: formData.get('usageAccountIdColumn'),
    usageCustomerIdColumn: formData.get('usageCustomerIdColumn'),
    usageCustomerNameColumn: formData.get('usageCustomerNameColumn'),
    usageMeterColumn: formData.get('usageMeterColumn'),
    usageQuantityColumn: formData.get('usageQuantityColumn'),
    usageUnitColumn: formData.get('usageUnitColumn'),
    usagePeriodStartColumn: formData.get('usagePeriodStartColumn'),
    usagePeriodEndColumn: formData.get('usagePeriodEndColumn'),
  })
  const connection = createWarehouseCsvConnection({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    sourceLabel: input.sourceLabel,
    exportUrl: input.exportUrl,
    schedule: input.schedule,
    connectedBy: session.userId,
    usageCsvMapping: {
      ...(input.usageAccountIdColumn ? { accountId: input.usageAccountIdColumn } : {}),
      ...(input.usageCustomerIdColumn ? { customerId: input.usageCustomerIdColumn } : {}),
      ...(input.usageCustomerNameColumn ? { customerName: input.usageCustomerNameColumn } : {}),
      meter: input.usageMeterColumn,
      quantity: input.usageQuantityColumn,
      unit: input.usageUnitColumn,
      periodStart: input.usagePeriodStartColumn,
      periodEnd: input.usagePeriodEndColumn,
    },
  })

  await getWarehouseCsvConnectionStore().save(connection)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'warehouse_connection_saved',
      targetType: 'connector',
      targetId: connection.id,
      metadata: {
        provider: connection.provider,
        mode: connection.mode,
        sourceLabel: connection.sourceLabel,
        schedule: connection.schedule,
        secretRef: connection.secretRef,
      },
    }),
  )

  revalidatePath('/settings')
  redirect('/settings?warehouse=connected')
}

export async function runWarehouseCsvSyncAction(formData: FormData) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = warehouseSyncFormSchema.parse({
    warehouseExportUrl: formData.get('warehouseExportUrl'),
  })
  const connection = await getWarehouseCsvConnectionStore().getByWorkspace(workspace.id)

  if (!connection) {
    throw new Error(`Warehouse CSV connection not found for workspace: ${workspace.id}`)
  }

  const result = await runAndPersistWarehouseCsvSync({
    connection,
    exportUrl: input.warehouseExportUrl,
    requestedBy: session.userId,
    uploadStore: getUploadStore(),
    uploadStorage: getUploadStorage(),
    parseJobStore: getParseJobStore(),
    parsedRecordStore: getParsedRecordStore(),
  })

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'warehouse_sync_run',
      targetType: 'connector',
      targetId: connection.id,
      metadata: {
        provider: connection.provider,
        mode: connection.mode,
        status: result.job.status,
        recordCount: result.job.recordCount,
        errorCount: result.job.errorCount,
        uploadId: result.upload.id,
        parseJobId: result.job.id,
      },
    }),
  )

  revalidatePath('/settings')
  redirect('/settings?warehouse=synced')
}

export async function saveReconciliationScheduleAction(formData: FormData) {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = reconciliationScheduleFormSchema.parse({
    scheduleName: formData.get('scheduleName'),
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
    runAt: formData.get('runAt'),
    timezone: formData.get('timezone'),
    lateUsageGracePeriodDays: formData.get('lateUsageGracePeriodDays'),
    ruleTemplateIds: formData.getAll('ruleTemplateIds'),
  })
  const schedule = createReconciliationSchedule({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    name: input.scheduleName,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    runAt: input.runAt,
    timezone: input.timezone,
    lateUsageGracePeriodDays: input.lateUsageGracePeriodDays,
    ruleTemplateIds: input.ruleTemplateIds,
    createdBy: session.userId,
  })

  await getReconciliationScheduleStore().save(schedule)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'reconciliation_schedule_saved',
      targetType: 'reconciliation_schedule',
      targetId: schedule.id,
      metadata: {
        cadence: schedule.cadence,
        periodStart: schedule.periodStart,
        periodEnd: schedule.periodEnd,
        runAt: schedule.runAt,
        timezone: schedule.timezone,
        lateUsageGracePeriodDays: schedule.lateUsageGracePeriodDays,
        ruleTemplateCount: schedule.ruleTemplateIds.length,
      },
    }),
  )

  revalidatePath('/settings')
  redirect('/settings?schedule=saved')
}

export async function savePricingRuleAction(formData: FormData) {
  const session = await requireSession()
  assertCanConfigurePricingRules(session)
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = pricingRuleFormSchema.parse({
    pricingRuleId: formData.get('pricingRuleId'),
    pricingRuleName: formData.get('pricingRuleName'),
    pricingRuleType: formData.get('pricingRuleType'),
    pricingRuleCustomerId: formData.get('pricingRuleCustomerId'),
    pricingRuleMeter: formData.get('pricingRuleMeter'),
    pricingRuleUnit: formData.get('pricingRuleUnit'),
    pricingRuleBillingPeriod: formData.get('pricingRuleBillingPeriod'),
    pricingRuleRate: formData.get('pricingRuleRate'),
    pricingRuleAllowance: formData.get('pricingRuleAllowance'),
    pricingRuleThreshold: formData.get('pricingRuleThreshold'),
    pricingRuleDiscountPercent: formData.get('pricingRuleDiscountPercent'),
    pricingRuleCurrency: formData.get('pricingRuleCurrency'),
    pricingRuleEffectiveFrom: formData.get('pricingRuleEffectiveFrom'),
    pricingRuleEffectiveTo: formData.get('pricingRuleEffectiveTo'),
  })
  const store = getPricingRuleStore()
  const existingRules = await store.listByWorkspace(workspace.id)
  const existingRule = input.pricingRuleId
    ? existingRules.find((rule) => rule.id === input.pricingRuleId)
    : undefined

  if (input.pricingRuleId && !existingRule) {
    throw new Error(`Pricing rule not found: ${input.pricingRuleId}`)
  }

  const ruleInput = {
    customerId: input.pricingRuleCustomerId,
    name: input.pricingRuleName,
    type: input.pricingRuleType,
    meter: input.pricingRuleMeter,
    unit: input.pricingRuleUnit,
    billingPeriod: input.pricingRuleBillingPeriod,
    rate: input.pricingRuleRate,
    allowance: input.pricingRuleAllowance,
    threshold: input.pricingRuleThreshold,
    discountPercent: input.pricingRuleDiscountPercent,
    currency: input.pricingRuleCurrency,
    effectiveFrom: input.pricingRuleEffectiveFrom,
    effectiveTo: input.pricingRuleEffectiveTo,
  }
  const draftedRule = existingRule
    ? updatePricingRule(existingRule, { ...ruleInput, updatedBy: session.userId })
    : createPricingRule({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        ...ruleInput,
        createdBy: session.userId,
      })
  const customerApprovalRequired =
    session.role === 'internal_admin' && (!existingRule || isMaterialPricingRuleChange(existingRule, draftedRule))
  const rule = customerApprovalRequired
    ? requestPricingRuleCustomerApproval(
        draftedRule,
        {
          requestedBy: session.userId,
          reason: existingRule ? 'Material pricing rule change by internal admin' : 'Pricing rule created by internal admin',
        },
      )
    : draftedRule

  await store.saveMany([rule])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'pricing_rule_saved',
      targetType: 'pricing_rule',
      targetId: rule.id,
      metadata: {
        mode: existingRule ? 'update' : 'create',
        type: rule.type,
        meter: rule.meter,
        billingPeriod: rule.billingPeriod,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        customerApprovalRequired,
      },
    }),
  )

  revalidatePath('/settings')
  redirect('/settings?pricing=saved')
}

export async function reviewPricingRuleApprovalAction(formData: FormData) {
  const session = await requireSession()
  assertCanReviewPricingRuleApproval(session)
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const input = pricingRuleApprovalFormSchema.parse({
    pricingRuleId: formData.get('pricingRuleId'),
    approvalDecision: formData.get('approvalDecision'),
    approvalNote: formData.get('approvalNote'),
  })
  const store = getPricingRuleStore()
  const rule = (await store.listByWorkspace(workspace.id)).find((candidate) => candidate.id === input.pricingRuleId)

  if (!rule) {
    throw new Error(`Pricing rule not found: ${input.pricingRuleId}`)
  }

  if (rule.status !== 'pending_customer_approval') {
    throw new Error('Pricing rule is not pending customer approval')
  }

  const reviewedRule =
    input.approvalDecision === 'approved'
      ? approvePricingRule(rule, { approvedBy: session.userId, note: input.approvalNote })
      : rejectPricingRule(rule, { rejectedBy: session.userId, note: input.approvalNote })

  await store.saveMany([reviewedRule])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'pricing_rule_approval_changed',
      targetType: 'pricing_rule',
      targetId: reviewedRule.id,
      metadata: {
        decision: input.approvalDecision,
        fromStatus: rule.status,
        status: reviewedRule.status,
        hasNote: Boolean(input.approvalNote),
      },
    }),
  )

  revalidatePath('/settings')
  redirect(`/settings?pricing=${input.approvalDecision}`)
}

function normalizeDateTimeInput(value: string): string {
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) {
    return new Date(value).toISOString()
  }

  const withSeconds = value.length === 16 ? `${value}:00` : value
  const withMilliseconds = withSeconds.includes('.') ? withSeconds : `${withSeconds}.000`

  return new Date(`${withMilliseconds}Z`).toISOString()
}

function assertCanConfigurePricingRules(session: Session) {
  if (session.role === 'customer_admin' || session.role === 'internal_admin') {
    return
  }

  throw new Error('Customer admin or internal admin required')
}

function assertCanReviewPricingRuleApproval(session: Session) {
  if (session.role === 'customer_admin') {
    return
  }

  throw new Error('Customer admin required')
}

async function sendFailedSyncAlertsIfNeeded({
  workspace,
  actorId,
  connectorLabel,
  provider,
  run,
}: {
  workspace: AuditWorkspace
  actorId: string
  connectorLabel: string
  provider: string
  run: StripeSyncRun
}) {
  if (run.status === 'complete') {
    return
  }

  const alertEmails = buildFailedSyncAlertEmails({
    workspace,
    connectorLabel,
    provider,
    status: run.status,
    errorSummary: stripeSyncErrorSummary(run),
    invites: await getInviteStore().listByWorkspace(workspace.id),
    internalRecipients: internalAlertRecipients,
    sentBy: actorId,
  })

  await getReminderEmailStore().saveMany(alertEmails)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId,
      action: 'reminder_email_sent',
      targetType: 'reminder_email',
      targetId: alertEmails[0]?.id ?? `${workspace.id}_failed_sync`,
      metadata: {
        reminderType: 'failed_sync',
        recipientCount: alertEmails.length,
        provider,
        status: run.status,
        errorSummary: stripeSyncErrorSummary(run),
      },
    }),
  )
}

function stripeSyncErrorSummary(run: StripeSyncRun): string {
  const failedResources = run.resources.filter((resource) => resource.status === 'failed')

  return failedResources.length === 0
    ? `${run.provider} sync ended with status ${run.status}.`
    : failedResources.map((resource) => `${resource.resource}: ${resource.error ?? 'Unknown sync failure'}`).join(' · ')
}
