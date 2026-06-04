'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
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
import { createManualAccountMapping } from '@/lib/audit/account-mapping'
import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { type ParsedRecord, runParseForUploadWithRecords } from '@/lib/audit/parse-jobs'
import { contractTermSchema, normalizedAccountMappingSchema } from '@/lib/audit/schemas'
import {
  createUploadRecord,
  createUploadTaskComment,
  reviewUploadRecord,
  type UploadRecord,
  uploadPeriodMetadata,
  uploadCategorySchema,
  uploadStatusSchema,
} from '@/lib/audit/uploads'
import { listSessionWorkspaces, requireCurrentWorkspace, type AuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'
import { requireInternalAdmin, requireSession } from '@/lib/auth/server'

const reviewStatusSchema = uploadStatusSchema.exclude(['missing', 'needs_review'])

export async function uploadFileAction(formData: FormData) {
  const session = await requireSession()
  const { workspace, scoped } = await resolveCustomerUploadWorkspaceFromForm(session, formData)

  const category = uploadCategorySchema.parse(formData.get('category'))
  const uploadedBy = session.userId
  const file = parseUploadedFile(formData.get('file'))

  const storage = await getUploadStorage().save({
    workspaceId: workspace.id,
    category,
    filename: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type || undefined,
  })

  const record = createUploadRecord({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    category,
    filename: file.name,
    byteSize: storage.byteSize,
    contentType: storage.contentType,
    storageKey: storage.storageKey,
    checksum: storage.checksum,
    uploadedBy,
    metadata: uploadPeriodMetadata(workspace),
  })

  await getUploadStore().save(record)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: uploadedBy,
      action: 'file_uploaded',
      targetType: 'upload',
      targetId: record.id,
      metadata: {
        category: record.category,
        filename: record.filename,
        byteSize: record.byteSize,
        contentType: record.contentType,
        checksum: record.checksum,
        sourceFileId: record.sourceFileId,
        monitoringPeriodId: metadataString(record.metadata, 'monitoringPeriodId'),
        periodLabel: metadataString(record.metadata, 'periodLabel'),
      },
    }),
  )
  revalidateUploadRoutes(workspace.id)
  redirect(customerUploadsRedirectPath(workspace, scoped))
}

export async function reviewUploadAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const uploadId = z.string().min(1).parse(formData.get('uploadId'))
  const status = reviewStatusSchema.parse(formData.get('status'))
  const reviewNote = z.string().optional().parse(emptyToUndefined(formData.get('reviewNote')))
  const reviewedBy = session.userId

  const store = getUploadStore()
  const record = await requireUploadRecord(uploadId, workspace.id)

  const reviewedRecord = reviewUploadRecord(record, { status, reviewedBy, reviewNote })
  await store.save(reviewedRecord)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: record.organizationId,
      workspaceId: record.workspaceId,
      actorId: reviewedBy,
      action: 'file_reviewed',
      targetType: 'upload',
      targetId: record.id,
      metadata: {
        status: reviewedRecord.status,
        reviewNote,
      },
    }),
  )
  revalidateUploadRoutes(workspace.id)
  redirect(uploadsRedirectPath(workspace, scoped))
}

export async function addUploadTaskCommentAction(formData: FormData) {
  const session = await requireSession()
  const { workspace, scoped } = await resolveWorkspaceForComment(session, formData)
  const category = uploadCategorySchema.parse(formData.get('category'))
  const body = z.string().trim().min(1).parse(formData.get('body'))

  const comment = createUploadTaskComment({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    category,
    body,
    authorId: session.userId,
    authorName: session.name,
    authorRole: session.role,
  })

  await getUploadTaskCommentStore().save(comment)
  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'upload_task_commented',
      targetType: 'upload_task',
      targetId: category,
      metadata: {
        category,
        bodyLength: comment.body.length,
      },
    }),
  )
  revalidateUploadRoutes(workspace.id)
  redirect(commentRedirectPath(session, workspace, scoped))
}

export async function runParseAction(formData: FormData) {
  const session = await requireInternalAdmin()
  const { workspace, scoped } = await resolveWorkspaceFromForm(session, formData)
  const uploadId = z.string().min(1).parse(formData.get('uploadId'))

  const uploadStore = getUploadStore()
  const upload = await requireUploadRecord(uploadId, workspace.id)
  const usageCsvMapping = upload.category === 'usage_csv' ? readUsageCsvMapping(formData) : undefined
  const providerCostCsvMapping = upload.category === 'provider_cost_csv' ? readProviderCostCsvMapping(formData) : undefined
  const uploadForParse = usageCsvMapping || providerCostCsvMapping
    ? {
        ...upload,
        metadata: {
          ...upload.metadata,
          ...(usageCsvMapping ? { usageCsvMapping } : {}),
          ...(providerCostCsvMapping ? { providerCostCsvMapping } : {}),
        },
      }
    : upload

  if (usageCsvMapping || providerCostCsvMapping) {
    await uploadStore.save(uploadForParse)
  }

  const execution = await runParseForUploadWithRecords(uploadForParse, getUploadStorage())
  const accountMappings = createAccountMappingsFromParsedRecords(execution.records, session.userId)
  const contractTerms = createContractTermsFromParsedRecords(execution.records)
  await getParseJobStore().save(execution.job)
  await getParsedRecordStore().saveMany(execution.records)
  if (accountMappings.length > 0) {
    await getAccountMappingStore().saveMany(accountMappings)
  }
  if (contractTerms.length > 0) {
    await getContractTermStore().saveMany(contractTerms)
  }

  const auditLogStore = getAuditLogStore()
  await auditLogStore.append(
    createAuditLogEvent({
      organizationId: upload.organizationId,
      workspaceId: upload.workspaceId,
      actorId: session.userId,
      action: 'parse_run',
      targetType: 'upload',
      targetId: upload.id,
      metadata: {
        parser: execution.job.parser,
        status: execution.job.status,
        recordCount: execution.job.recordCount,
        errorCount: execution.job.errorCount,
        accountMappingCount: accountMappings.length,
        contractTermCount: contractTerms.length,
        usageCsvMappingProvided: Boolean(usageCsvMapping),
        providerCostCsvMappingProvided: Boolean(providerCostCsvMapping),
      },
    }),
  )
  if (accountMappings.length > 0) {
    await auditLogStore.append(
      createAuditLogEvent({
        organizationId: upload.organizationId,
        workspaceId: upload.workspaceId,
        actorId: session.userId,
        action: 'account_mapping_saved',
        targetType: 'workspace',
        targetId: workspace.id,
        metadata: {
          mode: 'csv_upload',
          uploadId: upload.id,
          mappingCount: accountMappings.length,
        },
      }),
    )
  }
  if (contractTerms.length > 0) {
    await auditLogStore.append(
      createAuditLogEvent({
        organizationId: upload.organizationId,
        workspaceId: upload.workspaceId,
        actorId: session.userId,
        action: 'contract_terms_extracted',
        targetType: 'upload',
        targetId: upload.id,
        metadata: {
          mode: 'csv_upload',
          filename: upload.filename,
          termCount: contractTerms.length,
        },
      }),
    )
  }

  revalidateUploadRoutes(workspace.id)
  redirect(uploadsRedirectPath(workspace, scoped))
}

async function resolveWorkspaceFromForm(session: Session, formData: FormData): Promise<{ workspace: AuditWorkspace; scoped: boolean }> {
  const requestedWorkspaceId = emptyToUndefined(formData.get('workspaceId'))

  if (!requestedWorkspaceId) {
    return {
      workspace: requireCurrentWorkspace(session, await getWorkspaceStore().list()),
      scoped: false,
    }
  }

  const workspace = await getWorkspaceStore().getById(requestedWorkspaceId)

  if (!workspace) {
    throw new Error(`Workspace not found: ${requestedWorkspaceId}`)
  }

  return { workspace, scoped: true }
}

async function resolveCustomerUploadWorkspaceFromForm(session: Session, formData: FormData): Promise<{ workspace: AuditWorkspace; scoped: boolean }> {
  const requestedWorkspaceId = emptyToUndefined(formData.get('workspaceId'))
  const workspaces = await getWorkspaceStore().list()

  if (!requestedWorkspaceId) {
    return {
      workspace: requireCurrentWorkspace(session, workspaces),
      scoped: false,
    }
  }

  const workspace = listSessionWorkspaces(session, workspaces).find((candidate) => candidate.id === requestedWorkspaceId)

  if (!workspace) {
    throw new Error('Workspace access denied')
  }

  return { workspace, scoped: true }
}

async function resolveWorkspaceForComment(session: Session, formData: FormData): Promise<{ workspace: AuditWorkspace; scoped: boolean }> {
  const requestedWorkspaceId = emptyToUndefined(formData.get('workspaceId'))
  const workspaces = await getWorkspaceStore().list()

  if (!requestedWorkspaceId) {
    return {
      workspace: requireCurrentWorkspace(session, workspaces),
      scoped: false,
    }
  }

  const workspace = listSessionWorkspaces(session, workspaces).find((candidate) => candidate.id === requestedWorkspaceId)

  if (!workspace) {
    throw new Error('Workspace access denied')
  }

  return { workspace, scoped: true }
}

function customerUploadsRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/workspaces/${encodeURIComponent(workspace.id)}/uploads` : '/uploads'
}

function uploadsRedirectPath(workspace: AuditWorkspace, scoped: boolean) {
  return scoped ? `/admin/workspaces/${encodeURIComponent(workspace.id)}/uploads` : '/admin'
}

function commentRedirectPath(session: Session, workspace: AuditWorkspace, scoped: boolean) {
  if (session.role === 'internal_admin') {
    return uploadsRedirectPath(workspace, scoped)
  }

  return customerUploadsRedirectPath(workspace, scoped)
}

function createContractTermsFromParsedRecords(records: ParsedRecord[]) {
  return records.filter((record) => record.recordType === 'contract_term').map((record) => contractTermSchema.parse(record.data))
}

function createAccountMappingsFromParsedRecords(records: ParsedRecord[], reviewerId: string) {
  return records
    .filter((record) => record.recordType === 'mapping')
    .map((record) => {
      const mapping = normalizedAccountMappingSchema.parse(record.data)

      return createManualAccountMapping({
        organizationId: mapping.organizationId,
        workspaceId: mapping.workspaceId,
        displayName: mapping.displayName,
        usageAccountId: mapping.usageAccountId,
        usageCustomerId: mapping.usageCustomerId,
        usageCustomerName: mapping.usageCustomerName,
        stripeCustomerId: mapping.stripeCustomerId,
        stripeCustomerEmail: mapping.stripeCustomerEmail,
        contractCustomerId: mapping.contractCustomerId,
        costAccountId: mapping.costAccountId,
        reviewerId,
        note: mapping.note,
      })
    })
}

function parseUploadedFile(value: FormDataEntryValue | null): File {
  if (!(value instanceof File) || value.size === 0) {
    throw new Error('A non-empty file is required')
  }

  return value
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readUsageCsvMapping(formData: FormData) {
  const mapping = {
    accountId: emptyToUndefined(formData.get('usageAccountIdColumn')),
    customerId: emptyToUndefined(formData.get('usageCustomerIdColumn')),
    customerName: emptyToUndefined(formData.get('usageCustomerNameColumn')),
    meter: emptyToUndefined(formData.get('usageMeterColumn')),
    quantity: emptyToUndefined(formData.get('usageQuantityColumn')),
    unit: emptyToUndefined(formData.get('usageUnitColumn')),
    periodStart: emptyToUndefined(formData.get('usagePeriodStartColumn')),
    periodEnd: emptyToUndefined(formData.get('usagePeriodEndColumn')),
  }
  const hasMappingInput = Object.values(mapping).some((value) => value !== undefined)

  if (!hasMappingInput) {
    return undefined
  }

  return z
    .object({
      accountId: z.string().min(1).optional(),
      customerId: z.string().min(1).optional(),
      customerName: z.string().min(1).optional(),
      meter: z.string().min(1),
      quantity: z.string().min(1),
      unit: z.string().min(1),
      periodStart: z.string().min(1),
      periodEnd: z.string().min(1),
    })
    .parse(mapping)
}

function readProviderCostCsvMapping(formData: FormData) {
  const mapping = {
    accountId: emptyToUndefined(formData.get('costAccountIdColumn')),
    customerId: emptyToUndefined(formData.get('costCustomerIdColumn')),
    customerName: emptyToUndefined(formData.get('costCustomerNameColumn')),
    provider: emptyToUndefined(formData.get('costProviderColumn')),
    product: emptyToUndefined(formData.get('costProductColumn')),
    model: emptyToUndefined(formData.get('costModelColumn')),
    costAmount: emptyToUndefined(formData.get('costAmountColumn')),
    currency: emptyToUndefined(formData.get('costCurrencyColumn')),
    periodStart: emptyToUndefined(formData.get('costPeriodStartColumn')),
    periodEnd: emptyToUndefined(formData.get('costPeriodEndColumn')),
  }
  const hasMappingInput = Object.values(mapping).some((value) => value !== undefined)

  if (!hasMappingInput) {
    return undefined
  }

  return z
    .object({
      accountId: z.string().min(1).optional(),
      customerId: z.string().min(1).optional(),
      customerName: z.string().min(1).optional(),
      provider: z.string().min(1),
      product: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      costAmount: z.string().min(1),
      currency: z.string().min(1),
      periodStart: z.string().min(1),
      periodEnd: z.string().min(1),
    })
    .parse(mapping)
}

async function requireUploadRecord(uploadId: string, workspaceId: string): Promise<UploadRecord> {
  const upload = (await getUploadStore().listByWorkspace(workspaceId)).find((candidate) => candidate.id === uploadId)

  if (!upload) {
    throw new Error(`Upload not found: ${uploadId}`)
  }

  return upload
}

function revalidateUploadRoutes(workspaceId?: string) {
  revalidatePath('/')
  revalidatePath('/uploads')
  revalidatePath('/admin')
  revalidatePath('/admin/runs')
  revalidatePath('/status')
  if (workspaceId) {
    revalidatePath(`/admin/workspaces/${workspaceId}/uploads`)
    revalidatePath(`/workspaces/${workspaceId}/uploads`)
  }
}
