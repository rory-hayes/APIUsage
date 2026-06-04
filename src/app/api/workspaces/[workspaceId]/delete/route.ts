import { NextResponse } from 'next/server'

import {
  getAccountMappingStore,
  getAuditLogStore,
  getContractTermStore,
  getDataDictionaryStore,
  getFindingCommentStore,
  getFindingStore,
  getFindingSuppressionStore,
  getIntakeStore,
  getParsedRecordStore,
  getParseJobStore,
  getPricingRuleStore,
  getReconciliationScheduleStore,
  getReminderEmailStore,
  getReportBuilderConfigStore,
  getRuleRunStore,
  getStripeConnectionStore,
  getStripeResourceSnapshotStore,
  getStripeSyncRunStore,
  getUploadTaskCommentStore,
  getUploadStorage,
  getUploadStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { deleteWorkspaceData } from '@/lib/audit/workspace-deletion'
import { getSessionSecret, isInternalAdmin, readSessionFromCookieHeader } from '@/lib/auth/access'

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params
  const session = readSessionFromCookieHeader(request.headers.get('cookie'), getSessionSecret())

  if (!session) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 })
  }

  if (!isInternalAdmin(session)) {
    return NextResponse.json({ error: 'Internal admin required' }, { status: 403 })
  }

  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  await deleteWorkspaceData({
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    actorId: session.userId,
    uploadStore: getUploadStore(),
    uploadTaskCommentStore: getUploadTaskCommentStore(),
    uploadStorage: getUploadStorage(),
    parseJobStore: getParseJobStore(),
    parsedRecordStore: getParsedRecordStore(),
    findingStore: getFindingStore(),
    findingCommentStore: getFindingCommentStore(),
    findingSuppressionStore: getFindingSuppressionStore(),
    ruleRunStore: getRuleRunStore(),
    reconciliationScheduleStore: getReconciliationScheduleStore(),
    reminderEmailStore: getReminderEmailStore(),
    stripeConnectionStore: getStripeConnectionStore(),
    stripeSyncRunStore: getStripeSyncRunStore(),
    stripeResourceSnapshotStore: getStripeResourceSnapshotStore(),
    warehouseCsvConnectionStore: getWarehouseCsvConnectionStore(),
    reportBuilderConfigStore: getReportBuilderConfigStore(),
    intakeStore: getIntakeStore(),
    pricingRuleStore: getPricingRuleStore(),
    contractTermStore: getContractTermStore(),
    accountMappingStore: getAccountMappingStore(),
    dataDictionaryStore: getDataDictionaryStore(),
    auditLogStore: getAuditLogStore(),
  })

  return NextResponse.redirect(new URL('/settings/security?deleted=1', request.url), { status: 303 })
}
