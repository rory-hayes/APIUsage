import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createWorkspaceInvite } from '../auth/invites'
import {
  buildFailedSyncAlertEmails,
  buildHighSeverityFindingAlertEmails,
  buildMissingUploadReminderEmails,
  buildReadoutReminderEmails,
  JsonReminderEmailStore,
} from './reminders'
import { findingSchema } from './schemas'
import { createUploadRecord, reviewUploadRecord } from './uploads'
import { createAuditWorkspace } from './workspaces'

describe('reminder emails', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-reminder-emails-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('builds missing upload reminder emails for active workspace invitees', () => {
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
    const acceptedContract = reviewUploadRecord(
      createUploadRecord(
        {
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
          category: 'contracts_order_forms',
          filename: 'northstar-order-form.pdf',
          byteSize: 256,
          contentType: 'application/pdf',
          storageKey: 'workspaces/workspace_northstar_june_2026/northstar-order-form.pdf',
          uploadedBy: 'user_customer',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
      { status: 'accepted', reviewedBy: 'internal_admin' },
      new Date('2026-06-02T11:00:00.000Z'),
    )
    const invite = createWorkspaceInvite({
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: workspace.organizationId,
      organizationName: workspace.organizationName,
      role: 'customer_admin',
      workspaceId: workspace.id,
      invitedBy: 'internal_admin',
    })

    const emails = buildMissingUploadReminderEmails({
      workspace,
      uploads: [acceptedContract],
      invites: [invite],
      sentBy: 'internal_admin',
      now: new Date('2026-06-03T09:30:00.000Z'),
    })

    expect(emails).toEqual([
      expect.objectContaining({
        id: 'reminder_workspace_northstar_june_2026_missing_uploads_user_finance_northstar_ai_2026_06_03T09_30_00_000Z',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        type: 'missing_uploads',
        recipientEmail: 'finance@northstar.ai',
        recipientName: 'Northstar Finance',
        subject: 'Northstar AI June 2026 audit: 1 upload still needed',
        body: expect.stringContaining('Product usage CSV'),
        sentBy: 'internal_admin',
        sentAt: '2026-06-03T09:30:00.000Z',
        status: 'sent',
        metadata: {
          missingUploadCategories: ['usage_csv'],
          missingUploadLabels: ['Product usage CSV'],
        },
      }),
    ])
  })

  it('persists reminder emails by workspace and newest send time', async () => {
    const store = new JsonReminderEmailStore(join(tempDir, 'reminder-emails.json'))
    const workspace = createAuditWorkspace({
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      status: 'review',
      createdBy: 'internal_admin',
    })
    const invite = createWorkspaceInvite({
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: workspace.organizationId,
      organizationName: workspace.organizationName,
      role: 'customer_admin',
      workspaceId: workspace.id,
      invitedBy: 'internal_admin',
    })
    const readoutEmails = buildReadoutReminderEmails({
      workspace,
      invites: [invite],
      readoutDate: '2026-06-10',
      sentBy: 'internal_admin',
      now: new Date('2026-06-03T10:00:00.000Z'),
    })
    const olderEmails = buildReadoutReminderEmails({
      workspace,
      invites: [invite],
      readoutDate: '2026-06-09',
      sentBy: 'internal_admin',
      now: new Date('2026-06-03T09:00:00.000Z'),
    })

    await store.saveMany(olderEmails)
    await store.saveMany(readoutEmails)

    await expect(store.listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        type: 'readout',
        subject: 'Northstar AI June 2026 audit: readout on 10 Jun 2026',
        body: expect.stringContaining('10 Jun 2026'),
      }),
      expect.objectContaining({
        type: 'readout',
        subject: 'Northstar AI June 2026 audit: readout on 9 Jun 2026',
      }),
    ])
  })

  it('builds high-severity finding alert emails for customer and internal recipients', () => {
    const workspace = createAuditWorkspace({
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      status: 'review',
      createdBy: 'internal_admin',
    })
    const invite = createWorkspaceInvite({
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: workspace.organizationId,
      organizationName: workspace.organizationName,
      role: 'customer_admin',
      workspaceId: workspace.id,
      invitedBy: 'internal_admin',
    })

    const emails = buildHighSeverityFindingAlertEmails({
      workspace,
      findings: [
        finding({ id: 'finding_high_credit', severity: 'high', title: 'Credits not applied', varianceAmount: 400000 }),
        finding({ id: 'finding_low_mapping', severity: 'low', title: 'Mapping note', varianceAmount: 0 }),
      ],
      invites: [invite],
      internalRecipients: [{ email: 'internal@usageintegrity.local', name: 'Rory' }],
      sentBy: 'internal_admin',
      now: new Date('2026-06-03T12:00:00.000Z'),
    })

    expect(emails).toEqual([
      expect.objectContaining({
        id: 'reminder_workspace_northstar_june_2026_high_severity_findings_user_finance_northstar_ai_2026_06_03T12_00_00_000Z',
        type: 'high_severity_findings',
        recipientEmail: 'finance@northstar.ai',
        subject: 'Northstar AI June 2026 audit: 1 high-severity finding needs review',
        body: expect.stringContaining('Credits not applied'),
        metadata: {
          findingIds: ['finding_high_credit'],
          highSeverityCount: 1,
          totalVarianceAmount: 400000,
        },
      }),
      expect.objectContaining({
        id: 'reminder_workspace_northstar_june_2026_high_severity_findings_recipient_internal_usageintegrity_local_2026_06_03T12_00_00_000Z',
        type: 'high_severity_findings',
        recipientEmail: 'internal@usageintegrity.local',
        recipientName: 'Rory',
        body: expect.stringContaining('Credits not applied'),
      }),
    ])
  })

  it('builds failed sync alert emails for customer and internal recipients', () => {
    const workspace = createAuditWorkspace({
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      status: 'review',
      createdBy: 'internal_admin',
    })
    const invite = createWorkspaceInvite({
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: workspace.organizationId,
      organizationName: workspace.organizationName,
      role: 'customer_admin',
      workspaceId: workspace.id,
      invitedBy: 'internal_admin',
    })

    const emails = buildFailedSyncAlertEmails({
      workspace,
      connectorLabel: 'Northstar Stripe live',
      provider: 'stripe',
      status: 'failed',
      errorSummary: 'invoices: Stripe invoices sync failed with HTTP 401',
      invites: [invite],
      internalRecipients: [{ email: 'internal@usageintegrity.local', name: 'Rory' }],
      sentBy: 'user_northstar_finance',
      now: new Date('2026-06-03T12:30:00.000Z'),
    })

    expect(emails).toEqual([
      expect.objectContaining({
        type: 'failed_sync',
        recipientEmail: 'finance@northstar.ai',
        subject: 'Northstar AI June 2026 audit: Stripe sync needs attention',
        body: expect.stringContaining('invoices: Stripe invoices sync failed with HTTP 401'),
        metadata: {
          provider: 'stripe',
          connectorLabel: 'Northstar Stripe live',
          status: 'failed',
          errorSummary: 'invoices: Stripe invoices sync failed with HTTP 401',
        },
      }),
      expect.objectContaining({
        type: 'failed_sync',
        recipientEmail: 'internal@usageintegrity.local',
        recipientName: 'Rory',
      }),
    ])
  })
})

function finding(input: { id: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; title: string; varianceAmount: number }) {
  return findingSchema.parse({
    id: input.id,
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    category: 'credit_burn_mismatch',
    severity: input.severity,
    title: input.title,
    expectedAmount: input.varianceAmount,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'draft',
    evidenceRefs: [{ type: 'contract_clause', sourceId: `${input.id}_term` }],
    recommendedAction: 'Review before close.',
    metadata: {},
  })
}
