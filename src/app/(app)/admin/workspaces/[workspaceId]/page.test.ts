import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildReadoutReminderEmails } from '@/lib/audit/reminders'
import { getInviteStore, getReminderEmailStore, getUploadStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createUploadRecord, reviewUploadRecord } from '@/lib/audit/uploads'
import { addMonitoringPeriodToWorkspace, createAuditWorkspace } from '@/lib/audit/workspaces'
import { createWorkspaceInvite } from '@/lib/auth/invites'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceDetailPage from './page'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

vi.mock('@/lib/auth/server', () => ({
  requireInternalAdmin: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_REMINDER_EMAIL_PATH: process.env.AUDIT_REMINDER_EMAIL_PATH,
  AUDIT_UPLOAD_METADATA_PATH: process.env.AUDIT_UPLOAD_METADATA_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace detail page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-detail-page-'))
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_REMINDER_EMAIL_PATH = join(tempDir, 'reminder-emails.json')
    process.env.AUDIT_UPLOAD_METADATA_PATH = join(tempDir, 'uploads.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      name: 'Rory',
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders a selected workspace hub with scoped admin workflow links', async () => {
    const northstar = addMonitoringPeriodToWorkspace(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_may_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'May 2026 audit',
          auditPeriod: 'May 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          requiredUploadCategories: ['contracts_order_forms', 'usage_csv'],
          status: 'review',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
      {
        label: 'June 2026',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        status: 'planned',
      },
    )
    const invite = createWorkspaceInvite({
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: northstar.organizationId,
      organizationName: northstar.organizationName,
      role: 'customer_admin',
      workspaceId: northstar.id,
      invitedBy: 'internal_admin',
    })
    await getWorkspaceStore().save(northstar)
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_acme_june_2026',
          organizationId: 'org_acme',
          organizationName: 'Acme AI',
          name: 'June 2026 audit',
          auditPeriod: 'June 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          status: 'review',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-02T09:00:00.000Z'),
      ),
    )
    await getInviteStore().save(invite)
    await getUploadStore().save(
      reviewUploadRecord(
        createUploadRecord({
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          category: 'contracts_order_forms',
          filename: 'northstar-order-form.pdf',
          byteSize: 256,
          contentType: 'application/pdf',
          storageKey: 'workspaces/workspace_northstar_may_2026/northstar-order-form.pdf',
          uploadedBy: 'user_customer',
        }),
        { status: 'accepted', reviewedBy: 'internal_admin' },
      ),
    )
    await getReminderEmailStore().saveMany(
      buildReadoutReminderEmails({
        workspace: northstar,
        invites: [invite],
        readoutDate: '2026-06-10',
        sentBy: 'internal_admin',
        now: new Date('2026-06-03T10:00:00.000Z'),
      }),
    )

    const page = await AdminWorkspaceDetailPage({ params: Promise.resolve({ workspaceId: 'workspace_northstar_may_2026' }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controls = collectControls(page)

    expect(text).toContain('Admin workspace')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('May 2026 audit')
    expect(text).toContain('Stripe')
    expect(text).toContain('Warehouse CSV')
    expect(text).toContain('review')
    expect(text).toContain('Monitoring periods')
    expect(text).toContain('May 2026')
    expect(text).toContain('2026-05-01')
    expect(text).toContain('2026-05-31')
    expect(text).toContain('active')
    expect(text).toContain('June 2026')
    expect(text).toContain('2026-06-01')
    expect(text).toContain('2026-06-30')
    expect(text).toContain('planned')
    expect(text).toContain('Review uploads')
    expect(text).toContain('Resolve mappings')
    expect(text).toContain('Approve contract terms')
    expect(text).toContain('Document field meanings')
    expect(text).toContain('Inspect runs')
    expect(text).toContain('Review findings')
    expect(text).toContain('Build report')
    expect(text).toContain('Audit log')
    expect(text).toContain('Reminder emails')
    expect(text).toContain('Missing upload reminder')
    expect(text).toContain('Product usage CSV')
    expect(text).toContain('Readout reminder')
    expect(text).toContain('Last reminders')
    expect(text).toContain('finance@northstar.ai')
    expect(text).toContain('readout on 10 Jun 2026')
    expect(text).not.toContain('Acme AI')
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/admin/workspaces/workspace_northstar_may_2026/uploads',
        '/admin/workspaces/workspace_northstar_may_2026/mappings',
        '/admin/workspaces/workspace_northstar_may_2026/contract-terms',
        '/admin/workspaces/workspace_northstar_may_2026/data-dictionary',
        '/admin/workspaces/workspace_northstar_may_2026/runs',
        '/admin/workspaces/workspace_northstar_may_2026/findings',
        '/admin/workspaces/workspace_northstar_may_2026/report-builder',
        '/admin/workspaces/workspace_northstar_may_2026/audit-log',
      ]),
    )
    expect(controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'workspaceId', value: 'workspace_northstar_may_2026' }),
        expect.objectContaining({ name: 'label' }),
        expect.objectContaining({ name: 'periodStart' }),
        expect.objectContaining({ name: 'periodEnd' }),
        expect.objectContaining({ name: 'status', defaultValue: 'planned' }),
        expect.objectContaining({ name: 'readoutDate' }),
      ]),
    )
  })

  it('hides unknown workspace hubs from internal operators', async () => {
    await expect(AdminWorkspaceDetailPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
  })
})

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join('')
  }

  if (!isValidElement(node)) {
    return ''
  }

  return collectText((node.props as { children?: ReactNode }).children)
}

function collectHrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectHrefs)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; href?: string }

  return [...(props.href ? [props.href] : []), ...collectHrefs(props.children)]
}

function collectControls(node: ReactNode): Array<{ name: string; defaultValue?: unknown; value?: unknown }> {
  if (Array.isArray(node)) {
    return node.flatMap(collectControls)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; defaultValue?: unknown; name?: string; value?: unknown }

  return [
    ...(props.name ? [{ name: props.name, defaultValue: props.defaultValue, value: props.value }] : []),
    ...collectControls(props.children),
  ]
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
