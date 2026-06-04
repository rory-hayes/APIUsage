'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { approveAccountMapping, buildAccountMappingSuggestions, createManualAccountMapping } from '@/lib/audit/account-mapping'
import { createAppBillingRecordFromFormData } from '@/lib/audit/app-billing'
import { createContractTermFeedback, createContractTermVersion, extractCandidateContractTermsFromUpload, reviewContractTerm } from '@/lib/audit/contract-terms'
import { createDataDictionaryEntry, dataDictionaryDataTypeSchema } from '@/lib/audit/data-dictionary'
import { isCustomerVisibleFinding } from '@/lib/audit/evidence-pack'
import { applyFindingSuppressions, createFindingSuppressionFromRejectedFinding } from '@/lib/audit/finding-suppressions'
import { applyFindingWorkflowStatus, findingIssueStatusSchema, isFindingIssueTrackable } from '@/lib/audit/finding-workflow'
import { createPilotConversionRecordFromFormData } from '@/lib/audit/pilot-conversions'
import { snapshotActivePricingRuleVersions } from '@/lib/audit/pricing-rules'
import {
  buildHighSeverityFindingAlertEmails,
  buildMissingUploadReminderEmails,
  buildReadoutReminderEmails,
  type ReminderEmail,
  type ReminderEmailType,
} from '@/lib/audit/reminders'
import { generateReconciliationFindings, reviewFinding } from '@/lib/audit/reconciliation'
import { createReportBuilderConfig } from '@/lib/audit/report-builder'
import { RECONCILIATION_RULE_VERSION, createRuleRunRecord } from '@/lib/audit/rule-runs'
import { resolveRuleTemplateSelection } from '@/lib/audit/rule-templates'
import { contractBillingPeriodSchema, contractTermSchema, findingSchema, type Finding } from '@/lib/audit/schemas'
import { uploadCategorySchema } from '@/lib/audit/uploads'
import {
  addMonitoringPeriodToWorkspace,
  auditWorkspacePeriodStatusSchema,
  createAuditWorkspaceFromFormData,
  createAuditWorkspacePeriod,
  requireCurrentWorkspace,
  type AuditWorkspace,
} from '@/lib/audit/workspaces'
import { createWorkspaceInviteFromFormData } from '@/lib/auth/invites'
import {
  getAccountMappingStore,
  getAppBillingStore,
  getAuditLogStore,
  getContractTermStore,
  getDataDictionaryStore,
  getFindingStore,
  getFindingSuppressionStore,
  getInviteStore,
  getParsedRecordStore,
  getPilotConversionStore,
  getPricingRuleStore,
  getReminderEmailStore,
  getReportBuilderConfigStore,
  getRuleRunStore,
  getUploadStorage,
  getUploadStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'
import { type Session } from '@/lib/auth/access'

const reviewStatusSchema = z.enum(['approved_internal', 'rejected', 'needs_review', 'needs_customer_input'])
const contractTermReviewStatusSchema = z.enum(['approved', 'rejected'])
const contractTermTypeSchema = z.enum(['rate', 'allowance', 'credit', 'minimum', 'overage_rate', 'discount', 'special_term'])

export async function createWorkspaceAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const workspace = createAuditWorkspaceFromFormData(formData, session.userId)

  await getWorkspaceStore().save(workspace)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'workspace_created',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: {
        organizationName: workspace.organizationName,
        auditPeriod: workspace.auditPeriod,
        billingSystem: workspace.billingSystem,
      },
    }),
  )

  revalidatePath('/admin/workspaces')
  revalidatePath('/')
  redirect('/admin/workspaces')
}

export async function addMonitoringPeriodAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const workspaceId = z.string().min(1).parse(formData.get('workspaceId'))
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }

  const period = createAuditWorkspacePeriod({
    label: z.string().trim().min(1).parse(formData.get('label')),
    periodStart: z.string().trim().min(1).parse(formData.get('periodStart')),
    periodEnd: z.string().trim().min(1).parse(formData.get('periodEnd')),
    status: auditWorkspacePeriodStatusSchema.parse(formData.get('status') ?? 'planned'),
  })
  const updatedWorkspace = addMonitoringPeriodToWorkspace(workspace, period)

  await getWorkspaceStore().save(updatedWorkspace)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'workspace_period_added',
      targetType: 'workspace',
      targetId: period.id,
      metadata: {
        label: period.label,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        status: period.status,
      },
    }),
  )

  revalidatePath('/admin/workspaces')
  revalidatePath(`/admin/workspaces/${workspace.id}`)
  redirect(`/admin/workspaces/${encodeURIComponent(workspace.id)}`)
}

export async function createInviteAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const workspaceId = z.string().min(1).parse(formData.get('workspaceId'))
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }

  const invite = createWorkspaceInviteFromFormData(formData, session.userId, workspace.organizationId, workspace.organizationName)

  await getInviteStore().save(invite)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'invite_created',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: {
        email: invite.email,
        role: invite.role,
      },
    }),
  )

  revalidatePath('/admin/workspaces')
  redirect('/admin/workspaces')
}

export async function savePilotConversionAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const record = createPilotConversionRecordFromFormData(formData, session.userId)
  const customerWorkspace = await latestWorkspaceForOrganization(record.organizationId)

  await getPilotConversionStore().save(record)

  if (customerWorkspace) {
    await getAuditLogStore().append(
      createAuditLogEvent({
        organizationId: record.organizationId,
        workspaceId: customerWorkspace.id,
        actorId: session.userId,
        action: 'pilot_conversion_saved',
        targetType: 'customer',
        targetId: record.id,
        metadata: {
          auditFeeAmount: record.auditFeeAmount,
          monitoringOfferAmount: record.monitoringOfferAmount,
          conversionStatus: record.conversionStatus,
          renewalDate: record.renewalDate,
        },
      }),
    )
  }

  revalidatePath('/admin/customers')
  redirect('/admin/customers')
}

export async function saveAppBillingAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const record = createAppBillingRecordFromFormData(formData, session.userId)
  const customerWorkspace = await latestWorkspaceForOrganization(record.organizationId)

  await getAppBillingStore().save(record)

  if (customerWorkspace) {
    await getAuditLogStore().append(
      createAuditLogEvent({
        organizationId: record.organizationId,
        workspaceId: customerWorkspace.id,
        actorId: session.userId,
        action: 'app_billing_saved',
        targetType: 'customer',
        targetId: record.id,
        metadata: {
          planId: record.planId,
          stripeInvoiceStatus: record.stripeInvoiceStatus,
          stripeSubscriptionStatus: record.stripeSubscriptionStatus,
          billingStatus: record.billingStatus,
        },
      }),
    )
  }

  revalidatePath('/admin/customers')
  redirect('/admin/customers')
}

export async function sendMissingUploadReminderAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const workspace = await requireWorkspaceFromForm(formData)
  const [uploads, invites] = await Promise.all([getUploadStore().listByWorkspace(workspace.id), getInviteStore().listByWorkspace(workspace.id)])
  const reminders = buildMissingUploadReminderEmails({
    workspace,
    uploads,
    invites,
    sentBy: session.userId,
  })

  await saveReminderBatch({
    workspace,
    reminders,
    actorId: session.userId,
    reminderType: 'missing_uploads',
    metadata: reminders[0]?.metadata ?? {},
  })
  redirect(adminWorkspaceRedirectPath(workspace))
}

export async function sendReadoutReminderAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const workspace = await requireWorkspaceFromForm(formData)
  const readoutDate = z.string().date().parse(formData.get('readoutDate'))
  const invites = await getInviteStore().listByWorkspace(workspace.id)
  const reminders = buildReadoutReminderEmails({
    workspace,
    invites,
    readoutDate,
    sentBy: session.userId,
  })

  await saveReminderBatch({
    workspace,
    reminders,
    actorId: session.userId,
    reminderType: 'readout',
    metadata: {
      readoutDate,
    },
  })
  redirect(adminWorkspaceRedirectPath(workspace))
}

export async function runReconciliationAction(formData?: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const records = await getParsedRecordStore().listByWorkspace(workspace.id)
  const accountMappings = await getAccountMappingStore().listByWorkspace(workspace.id)
  const contractTerms = await getContractTermStore().listByWorkspace(workspace.id)
  const pricingRules = await getPricingRuleStore().listByWorkspace(workspace.id)
  const suppressions = await getFindingSuppressionStore().listByWorkspace(workspace.id)
  const ruleTemplates = resolveRuleTemplateSelection(selectedRuleTemplateIds(formData))
  const checkIds = ruleTemplates.map((template) => template.id)
  const startedAt = new Date()
  const generatedFindings = generateReconciliationFindings(records, contractTerms, startedAt, accountMappings, checkIds)
  const findings = applyFindingSuppressions(generatedFindings, suppressions)
  const suppressedFindingCount = generatedFindings.length - findings.length
  const completedAt = new Date()
  const pricingRuleVersions = snapshotActivePricingRuleVersions(pricingRules)
  const ruleRun = createRuleRunRecord({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    actorId: session.userId,
    status: findings.length > 0 ? 'reviewing' : 'complete',
    ruleVersion: RECONCILIATION_RULE_VERSION,
    inputs: {
      ruleTemplateIds: checkIds,
      parsedRecordCount: records.length,
      contractTermCount: contractTerms.length,
      accountMappingCount: accountMappings.length,
      ...(pricingRuleVersions.length > 0 ? { pricingRuleVersions } : {}),
    },
    output: {
      findingCount: findings.length,
      findingIds: findings.map((finding) => finding.id),
      findingCategories: uniqueStrings(findings.map((finding) => finding.category)),
      suppressedFindingCount,
    },
    errors: [],
    startedAt,
    completedAt,
  })

  await getFindingStore().replaceDraftsForWorkspace(workspace.id, findings)
  await getRuleRunStore().save(ruleRun)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'check_run',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: {
        checkIds,
        ruleTemplateCount: ruleTemplates.length,
        ruleRunId: ruleRun.id,
        ruleVersion: ruleRun.ruleVersion,
        parsedRecordCount: records.length,
        contractTermCount: contractTerms.length,
        accountMappingCount: accountMappings.length,
        pricingRuleVersionCount: pricingRuleVersions.length,
        findingCount: findings.length,
        suppressedFindingCount,
      },
    }),
  )
  const alertEmails = buildHighSeverityFindingAlertEmails({
    workspace,
    findings,
    invites: await getInviteStore().listByWorkspace(workspace.id),
    internalRecipients: [{ email: session.email, name: session.name }],
    sentBy: session.userId,
  })

  if (alertEmails.length > 0) {
    await saveReminderBatch({
      workspace,
      reminders: alertEmails,
      actorId: session.userId,
      reminderType: 'high_severity_findings',
      metadata: alertEmails[0]?.metadata ?? {},
    })
  }

  revalidatePath('/admin')
  revalidatePath('/admin/runs')
  revalidatePath('/findings')
  revalidatePath('/evidence-pack')
  revalidatePath('/status')
  revalidatePath(`/admin/workspaces/${workspace.id}/runs`)
  redirect(runsRedirectPath(workspace, scoped))
}

export async function reviewFindingAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const findingId = z.string().min(1).parse(formData.get('findingId'))
  const status = reviewStatusSchema.parse(formData.get('status'))
  const reviewerId = session.userId
  const internalNote = optionalString(formData.get('internalNote'))
  const customerNote = optionalString(formData.get('customerNote'))
  const updates = {
    title: optionalString(formData.get('title')),
    severity: optionalFindingSeverity(formData.get('severity')),
    expectedAmount: optionalInteger(formData.get('expectedAmount')),
    actualAmount: optionalInteger(formData.get('actualAmount')),
    recommendedAction: optionalString(formData.get('recommendedAction')),
  }

  const store = getFindingStore()
  const findings = await store.listByWorkspace(workspace.id)
  const finding = findings.find((candidate) => candidate.id === findingId)

  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`)
  }

  const reviewedFinding = reviewFinding(finding, {
    status,
    reviewerId,
    internalNote,
    customerNote,
    updates,
  })
  const changedFields = findingEditableFields.filter((field) => reviewedFinding[field] !== finding[field])
  const suppression =
    reviewedFinding.status === 'rejected' && isChecked(formData.get('suppressFutureMatches'))
      ? createFindingSuppressionFromRejectedFinding(reviewedFinding, {
          createdBy: reviewerId,
          reason: internalNote,
        })
      : undefined

  await store.saveMany([reviewedFinding])
  if (suppression) {
    await getFindingSuppressionStore().save(suppression)
  }
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: reviewerId,
      action: 'finding_reviewed',
      targetType: 'finding',
      targetId: finding.id,
      metadata: {
        status: reviewedFinding.status,
        hasCustomerNote: Boolean(reviewedFinding.customerNote),
        changedFields,
        suppressionId: suppression?.id,
      },
    }),
  )
  if (reviewedFinding.status === 'approved_internal') {
    await getAuditLogStore().append(
      createAuditLogEvent({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        actorId: reviewerId,
        action: 'finding_published',
        targetType: 'finding',
        targetId: finding.id,
        metadata: {
          status: reviewedFinding.status,
          hasCustomerNote: Boolean(reviewedFinding.customerNote),
        },
      }),
    )
  }

  revalidatePath('/admin')
  revalidatePath('/findings')
  revalidatePath('/evidence-pack')
  revalidatePath('/status')
  revalidatePath(`/admin/workspaces/${workspace.id}/findings`)
  redirect(findingsRedirectPath(workspace, scoped))
}

export async function updateFindingIssueStatusAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const findingId = z.string().min(1).parse(formData.get('findingId'))
  const status = findingIssueStatusSchema.parse(formData.get('status'))
  const note = optionalString(formData.get('issueStatusNote'))
  const store = getFindingStore()
  const findings = await store.listByWorkspace(workspace.id)
  const finding = findings.find((candidate) => candidate.id === findingId)

  if (!finding) {
    throw new Error(`Finding not found: ${findingId}`)
  }

  if (!isFindingIssueTrackable(finding)) {
    throw new Error(`Finding is not ready for issue tracking: ${findingId}`)
  }

  const updatedFinding = applyFindingWorkflowStatus(finding, {
    status,
    actorId: session.userId,
    note,
    noteField: 'internalNote',
  })

  await store.saveMany([updatedFinding])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'finding_issue_status_changed',
      targetType: 'finding',
      targetId: finding.id,
      metadata: {
        fromStatus: finding.status,
        status: updatedFinding.status,
        hasNote: Boolean(note),
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath('/findings')
  revalidatePath('/evidence-pack')
  revalidatePath('/status')
  revalidatePath(`/admin/workspaces/${workspace.id}/findings`)
  redirect(findingsRedirectPath(workspace, scoped))
}

const findingSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])
const findingEditableFields = ['title', 'severity', 'expectedAmount', 'actualAmount', 'recommendedAction'] as const

export async function mergeFindingAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const sourceFindingId = z.string().min(1).parse(formData.get('sourceFindingId'))
  const targetFindingId = z.string().min(1).parse(formData.get('targetFindingId'))
  const note = optionalString(formData.get('note'))

  if (sourceFindingId === targetFindingId) {
    throw new Error('A finding cannot be merged into itself')
  }

  const store = getFindingStore()
  const findings = await store.listByWorkspace(workspace.id)
  const sourceFinding = findings.find((candidate) => candidate.id === sourceFindingId)
  const targetFinding = findings.find((candidate) => candidate.id === targetFindingId)

  if (!sourceFinding) {
    throw new Error(`Source finding not found: ${sourceFindingId}`)
  }

  if (!targetFinding) {
    throw new Error(`Target finding not found: ${targetFindingId}`)
  }

  const now = new Date()
  const merged = mergeFindings(sourceFinding, targetFinding, {
    reviewerId: session.userId,
    note,
    mergedAt: now,
  })

  await store.saveMany([merged.target, merged.source])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'finding_reviewed',
      targetType: 'finding',
      targetId: sourceFinding.id,
      metadata: {
        mode: 'merge',
        sourceFindingId: sourceFinding.id,
        targetFindingId: targetFinding.id,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath('/findings')
  revalidatePath('/evidence-pack')
  revalidatePath('/status')
  revalidatePath(`/admin/workspaces/${workspace.id}/findings`)
  redirect(findingsRedirectPath(workspace, scoped))
}

export async function extractContractTermsAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const uploadId = z.string().min(1).parse(formData.get('uploadId'))
  const upload = (await getUploadStore().listByWorkspace(workspace.id)).find((candidate) => candidate.id === uploadId)

  if (!upload) {
    throw new Error(`Upload not found: ${uploadId}`)
  }

  if (upload.category !== 'contracts_order_forms' && upload.category !== 'pricing_docs') {
    throw new Error(`Contract term extraction is not available for ${upload.category}`)
  }

  const terms = await extractCandidateContractTermsFromUpload(upload, getUploadStorage())
  await getContractTermStore().saveMany(terms)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'contract_terms_extracted',
      targetType: 'upload',
      targetId: upload.id,
      metadata: {
        filename: upload.filename,
        termCount: terms.length,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/contract-terms`)
  redirect(contractTermsRedirectPath(workspace, scoped))
}

export async function reviewContractTermAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const termId = z.string().min(1).parse(formData.get('termId'))
  const status = contractTermReviewStatusSchema.parse(formData.get('status'))
  const note = optionalString(formData.get('note'))
  const store = getContractTermStore()
  const terms = await store.listByWorkspace(workspace.id)
  const term = terms.find((candidate) => candidate.id === termId)

  if (!term) {
    throw new Error(`Contract term not found: ${termId}`)
  }

  const reviewedAt = new Date()
  const reviewed = reviewContractTerm(
    term,
    {
      status,
      reviewerId: session.userId,
      note,
      updates: {
        rate: optionalNumber(formData.get('rate')),
        allowance: optionalNumber(formData.get('allowance')),
        billingPeriod: optionalBillingPeriod(formData.get('billingPeriod')),
        threshold: optionalNumber(formData.get('threshold')),
        creditAmount: optionalNumber(formData.get('creditAmount')),
        minimumAmount: optionalNumber(formData.get('minimumAmount')),
        discountPercent: optionalNumber(formData.get('discountPercent')),
        effectiveFrom: optionalString(formData.get('effectiveFrom')),
        effectiveTo: optionalString(formData.get('effectiveTo')),
      },
    },
    reviewedAt,
  )
  const version = createContractTermVersion(term, reviewed, {
    reviewerId: session.userId,
    note,
    reviewedAt,
  })

  await store.saveMany([reviewed])
  await store.appendVersion(version)
  await store.appendFeedback(createContractTermFeedback(version))
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'contract_term_reviewed',
      targetType: 'contract_term',
      targetId: term.id,
      metadata: {
        status: reviewed.status,
        changedFields: version.changedFields.join(','),
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/contract-terms`)
  redirect(contractTermsRedirectPath(workspace, scoped))
}

export async function createManualContractTermAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const store = getContractTermStore()
  const existingTerms = await store.listByWorkspace(workspace.id)
  const type = contractTermTypeSchema.parse(formData.get('type'))
  const note = optionalString(formData.get('note'))
  const now = new Date()
  const term = contractTermSchema.parse({
    id: createManualContractTermId(workspace.id, type, existingTerms.length + 1),
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    customerId: optionalString(formData.get('customerId')),
    type,
    meter: optionalString(formData.get('meter')),
    unit: optionalString(formData.get('unit')),
    rate: optionalNumber(formData.get('rate')),
    allowance: optionalNumber(formData.get('allowance')),
    billingPeriod: optionalBillingPeriod(formData.get('billingPeriod')),
    threshold: optionalNumber(formData.get('threshold')),
    creditAmount: optionalNumber(formData.get('creditAmount')),
    minimumAmount: optionalNumber(formData.get('minimumAmount')),
    discountPercent: optionalNumber(formData.get('discountPercent')),
    currency: optionalString(formData.get('currency')),
    effectiveFrom: optionalString(formData.get('effectiveFrom')),
    effectiveTo: optionalString(formData.get('effectiveTo')),
    status: 'approved',
    evidence: manualContractTermEvidence(formData),
    metadata: {
      source: 'manual',
      reviewerId: session.userId,
      reviewedAt: now.toISOString(),
      reviewNote: note,
    },
  })

  await store.saveMany([term])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'contract_term_reviewed',
      targetType: 'contract_term',
      targetId: term.id,
      metadata: {
        mode: 'manual_create',
        status: term.status,
        type: term.type,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/contract-terms`)
  redirect(contractTermsRedirectPath(workspace, scoped))
}

export async function suggestAccountMappingsAction(formData?: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const records = await getParsedRecordStore().listByWorkspace(workspace.id)
  const store = getAccountMappingStore()
  const existing = await store.listByWorkspace(workspace.id)
  const suggestions = buildAccountMappingSuggestions(records).filter((suggestion) => {
    const current = existing.find((mapping) => mapping.id === suggestion.id)

    return !current || current.status === 'suggested'
  })

  await store.saveMany(suggestions)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'account_mapping_saved',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: {
        mode: 'suggestions',
        mappingCount: suggestions.length,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/mappings`)
  redirect(mappingRedirectPath(workspace, scoped))
}

export async function approveAccountMappingAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const mappingId = z.string().min(1).parse(formData.get('mappingId'))
  const note = optionalString(formData.get('note'))
  const store = getAccountMappingStore()
  const mappings = await store.listByWorkspace(workspace.id)
  const mapping = mappings.find((candidate) => candidate.id === mappingId)

  if (!mapping) {
    throw new Error(`Account mapping not found: ${mappingId}`)
  }

  const approved = approveAccountMapping(mapping, {
    reviewerId: session.userId,
    note,
  })

  await store.saveMany([approved])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'account_mapping_saved',
      targetType: 'account_mapping',
      targetId: approved.id,
      metadata: {
        status: approved.status,
        source: approved.source,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/mappings`)
  redirect(mappingRedirectPath(workspace, scoped))
}

export async function saveManualAccountMappingAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const mapping = createManualAccountMapping({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    displayName: z.string().min(1).parse(formData.get('displayName')),
    usageAccountId: optionalString(formData.get('usageAccountId')),
    usageCustomerId: optionalString(formData.get('usageCustomerId')),
    usageCustomerName: optionalString(formData.get('usageCustomerName')),
    stripeCustomerId: optionalString(formData.get('stripeCustomerId')),
    stripeCustomerEmail: optionalString(formData.get('stripeCustomerEmail')),
    contractCustomerId: optionalString(formData.get('contractCustomerId')),
    costAccountId: optionalString(formData.get('costAccountId')),
    reviewerId: session.userId,
    note: optionalString(formData.get('note')),
  })

  await getAccountMappingStore().saveMany([mapping])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'account_mapping_saved',
      targetType: 'account_mapping',
      targetId: mapping.id,
      metadata: {
        status: mapping.status,
        source: mapping.source,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/mappings`)
  redirect(mappingRedirectPath(workspace, scoped))
}

export async function saveDataDictionaryEntryAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const entry = createDataDictionaryEntry({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    sourceCategory: uploadCategorySchema.parse(formData.get('sourceCategory')),
    sourceField: z.string().min(1).parse(formData.get('sourceField')),
    normalizedField: optionalString(formData.get('normalizedField')),
    dataType: dataDictionaryDataTypeSchema.parse(formData.get('dataType') || 'unknown'),
    meaning: z.string().min(1).parse(formData.get('meaning')),
    exampleValue: optionalString(formData.get('exampleValue')),
    notes: optionalString(formData.get('notes')),
    createdBy: session.userId,
  })

  await getDataDictionaryStore().saveMany([entry])
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'data_dictionary_entry_saved',
      targetType: 'data_dictionary_entry',
      targetId: entry.id,
      metadata: {
        sourceCategory: entry.sourceCategory,
        sourceField: entry.sourceField,
        normalizedField: entry.normalizedField,
        dataType: entry.dataType,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath(`/admin/workspaces/${workspace.id}/data-dictionary`)
  redirect(dataDictionaryRedirectPath(workspace, scoped))
}

export async function generateEvidencePackAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const requestedWorkspaceId = optionalString(formData.get('workspaceId'))
  const workspace = await resolveWorkspace(session, requestedWorkspaceId)

  const findings = await getFindingStore().listByWorkspace(workspace.id)
  const customerVisibleCount = findings.filter(isCustomerVisibleFinding).length

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'evidence_pack_generated',
      targetType: 'evidence_pack',
      targetId: workspace.id,
      metadata: {
        customerVisibleCount,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath('/evidence-pack')
  redirect('/evidence-pack')
}

export async function saveReportBuilderAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const selectedFindingIds = stringValues(formData.getAll('findingId'))
  const noteFindingIds = stringValues(formData.getAll('noteFindingId'))
  const config = createReportBuilderConfig({
    workspaceId: workspace.id,
    selectedFindingIds,
    noteFindingIds,
    updatedBy: session.userId,
  })

  await getReportBuilderConfigStore().save(config)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'report_builder_saved',
      targetType: 'evidence_pack',
      targetId: workspace.id,
      metadata: {
        selectedFindingCount: config.selectedFindingIds.length,
        selectedNoteCount: config.noteFindingIds.length,
      },
    }),
  )

  revalidatePath('/admin')
  revalidatePath('/evidence-pack')
  revalidatePath(`/admin/workspaces/${workspace.id}/report-builder`)
  redirect(reportBuilderRedirectPath(workspace, scoped))
}

async function requireActiveWorkspace(session: Session): Promise<AuditWorkspace> {
  return requireCurrentWorkspace(session, await getWorkspaceStore().list())
}

async function latestWorkspaceForOrganization(organizationId: string): Promise<AuditWorkspace | null> {
  const workspaces = await getWorkspaceStore().list()
  const organizationWorkspaces = workspaces.filter((workspace) => workspace.organizationId === organizationId)

  return organizationWorkspaces[0] ?? null
}

async function requireWorkspaceFromForm(formData: FormData): Promise<AuditWorkspace> {
  const workspaceId = z.string().min(1).parse(formData.get('workspaceId'))
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }

  return workspace
}

async function saveReminderBatch({
  workspace,
  reminders,
  actorId,
  reminderType,
  metadata,
}: {
  workspace: AuditWorkspace
  reminders: ReminderEmail[]
  actorId: string
  reminderType: ReminderEmailType
  metadata: Record<string, unknown>
}) {
  await getReminderEmailStore().saveMany(reminders)

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId,
      action: 'reminder_email_sent',
      targetType: 'reminder_email',
      targetId: reminders[0]?.id ?? `${workspace.id}_${reminderType}`,
      metadata: {
        reminderType,
        recipientCount: reminders.length,
        ...metadata,
      },
    }),
  )

  revalidatePath(adminWorkspaceRedirectPath(workspace))
}

async function resolveWorkspace(session: Session, requestedWorkspaceId?: string): Promise<AuditWorkspace> {
  if (!requestedWorkspaceId) {
    return requireActiveWorkspace(session)
  }

  const workspace = await getWorkspaceStore().getById(requestedWorkspaceId)

  if (!workspace) {
    throw new Error(`Workspace not found: ${requestedWorkspaceId}`)
  }

  return workspace
}

async function resolveWorkspaceFromForm(session: Session, formData?: FormData): Promise<{ workspace: AuditWorkspace; scoped: boolean }> {
  const requestedWorkspaceId = formData ? optionalString(formData.get('workspaceId')) : undefined

  return {
    workspace: await resolveWorkspace(session, requestedWorkspaceId),
    scoped: requestedWorkspaceId !== undefined,
  }
}

function mappingRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/mappings` : '/admin'
}

function adminWorkspaceRedirectPath(workspace: AuditWorkspace) {
  return `/admin/workspaces/${encodeURIComponent(workspace.id)}`
}

function contractTermsRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/contract-terms` : '/admin'
}

function dataDictionaryRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/data-dictionary` : '/admin'
}

function reportBuilderRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/report-builder` : '/admin'
}

function findingsRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/findings` : '/admin'
}

function runsRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/runs` : '/admin'
}

function selectedRuleTemplateIds(formData?: FormData): string[] | undefined {
  if (!formData) {
    return undefined
  }

  const selected = formData.getAll('ruleTemplateIds').filter((value): value is string => typeof value === 'string')

  return selected.length > 0 ? selected : undefined
}

function stringValues(values: FormDataEntryValue[]): string[] {
  return values.filter((value): value is string => typeof value === 'string')
}

function optionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

function isChecked(value: FormDataEntryValue | null): boolean {
  return typeof value === 'string' && ['1', 'true', 'on', 'yes'].includes(value.trim().toLowerCase())
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const trimmed = optionalString(value)

  if (!trimmed) {
    return undefined
  }

  const parsed = Number.parseFloat(trimmed.replaceAll(',', ''))

  if (Number.isNaN(parsed)) {
    throw new Error(`Expected a number, received ${trimmed}`)
  }

  return parsed
}

function optionalInteger(value: FormDataEntryValue | null): number | undefined {
  const parsed = optionalNumber(value)

  if (parsed === undefined) {
    return undefined
  }

  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer, received ${parsed}`)
  }

  return parsed
}

function optionalFindingSeverity(value: FormDataEntryValue | null): z.infer<typeof findingSeveritySchema> | undefined {
  const severity = optionalString(value)

  return severity ? findingSeveritySchema.parse(severity) : undefined
}

function optionalBillingPeriod(value: FormDataEntryValue | null): z.infer<typeof contractBillingPeriodSchema> | undefined {
  const billingPeriod = optionalString(value)

  return billingPeriod ? contractBillingPeriodSchema.parse(billingPeriod) : undefined
}

function mergeFindings(
  source: Finding,
  target: Finding,
  input: {
    reviewerId: string
    note?: string
    mergedAt: Date
  },
): { source: Finding; target: Finding } {
  const mergedAt = input.mergedAt.toISOString()
  const targetNote = `Merged ${source.id} into this finding.${input.note ? ` ${input.note}` : ''}`
  const sourceNote = `Merged into ${target.id}.${input.note ? ` ${input.note}` : ''}`
  const sourceMergedIds = readStringArray(source.metadata.mergedFindingIds)
  const targetMergedIds = readStringArray(target.metadata.mergedFindingIds)

  return {
    target: findingSchema.parse({
      ...target,
      evidenceRefs: mergeEvidenceRefs(target.evidenceRefs, source.evidenceRefs),
      internalNote: appendActionNote(target.internalNote, targetNote),
      metadata: {
        ...target.metadata,
        mergedAt,
        mergedBy: input.reviewerId,
        mergedFindingIds: uniqueStrings([...targetMergedIds, source.id, ...sourceMergedIds]),
      },
    }),
    source: findingSchema.parse({
      ...source,
      status: 'ignored',
      reviewerId: input.reviewerId,
      internalNote: appendActionNote(source.internalNote, sourceNote),
      metadata: {
        ...source.metadata,
        mergedAt,
        mergedBy: input.reviewerId,
        mergedInto: target.id,
      },
    }),
  }
}

function mergeEvidenceRefs(left: Finding['evidenceRefs'], right: Finding['evidenceRefs']): Finding['evidenceRefs'] {
  const refsByKey = new Map<string, Finding['evidenceRefs'][number]>()

  for (const ref of [...left, ...right]) {
    refsByKey.set(`${ref.type}:${ref.sourceId}`, ref)
  }

  return [...refsByKey.values()]
}

function appendActionNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function manualContractTermEvidence(formData: FormData) {
  const sourceFileId = optionalString(formData.get('evidenceSourceFileId'))
  const page = optionalInteger(formData.get('evidencePage'))
  const snippet = optionalString(formData.get('evidenceSnippet'))

  if (!sourceFileId && !page && !snippet) {
    return undefined
  }

  return {
    sourceFileId: sourceFileId ?? 'manual',
    page,
    snippet,
  }
}

function createManualContractTermId(workspaceId: string, type: string, sequence: number) {
  return `term_${slug(workspaceId)}_manual_${slug(type)}_${sequence}`
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
