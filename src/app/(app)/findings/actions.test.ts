import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuditLogStore, getFindingCommentStore, getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { findingSchema, type Finding } from '@/lib/audit/schemas'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import { addFindingCommentAction, updateFindingAssignmentAction, updateFindingWorkflowStatusAction } from './actions'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`)
  }),
}))

const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: navigation.redirect,
}))

vi.mock('next/cache', () => ({
  revalidatePath: cache.revalidatePath,
}))

const ORIGINAL_ENV = {
  AUDIT_FINDING_COMMENT_PATH: process.env.AUDIT_FINDING_COMMENT_PATH,
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('finding actions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-finding-actions-'))
    process.env.AUDIT_FINDING_COMMENT_PATH = join(tempDir, 'finding-comments.json')
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    vi.clearAllMocks()
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('lets a customer assign a visible finding to an owner team and audits the change', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_usage_gap',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'open',
      }),
    ])
    const formData = new FormData()
    formData.set('workspaceId', workspace.id)
    formData.set('findingId', 'finding_northstar_usage_gap')
    formData.set('assignmentOwner', 'engineering')
    formData.set('assignmentNote', 'Engineering should confirm the usage event feed.')

    await expect(updateFindingAssignmentAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/findings/finding_northstar_usage_gap',
    )

    await expect(getFindingStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        id: 'finding_northstar_usage_gap',
        assignment: expect.objectContaining({
          owner: 'engineering',
          assignedBy: 'user_northstar_finance',
          note: 'Engineering should confirm the usage event feed.',
        }),
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'finding_assigned',
        actorId: 'user_northstar_finance',
        targetType: 'finding',
        targetId: 'finding_northstar_usage_gap',
        metadata: expect.objectContaining({
          owner: 'engineering',
          previousOwner: null,
          hasNote: true,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/findings')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/findings')
  })

  it('lets customers and internal admins discuss a visible finding and audits comments', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_usage_gap',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'approved_internal',
      }),
    ])

    const customerFormData = new FormData()
    customerFormData.set('workspaceId', workspace.id)
    customerFormData.set('findingId', 'finding_northstar_usage_gap')
    customerFormData.set('body', 'We can confirm this usage was expected but not invoiced.')

    await expect(addFindingCommentAction(customerFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/findings/finding_northstar_usage_gap',
    )

    sessionState.current = {
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      name: 'Rory',
      organizationId: 'org_internal',
      organizationName: 'Usage Revenue Integrity OS',
      role: 'internal_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
    const internalFormData = new FormData()
    internalFormData.set('workspaceId', workspace.id)
    internalFormData.set('findingId', 'finding_northstar_usage_gap')
    internalFormData.set('body', 'I will attach this to the readout notes.')

    await expect(addFindingCommentAction(internalFormData)).rejects.toThrow(
      'NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/findings/finding_northstar_usage_gap',
    )

    const comments = await getFindingCommentStore().listByFinding(workspace.id, 'finding_northstar_usage_gap')
    expect(comments).toHaveLength(2)
    expect(comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorId: 'user_northstar_finance',
          authorName: 'Northstar Finance',
          authorRole: 'customer_admin',
          body: 'We can confirm this usage was expected but not invoiced.',
          findingId: 'finding_northstar_usage_gap',
        }),
        expect.objectContaining({
          authorId: 'internal_admin',
          authorName: 'Rory',
          authorRole: 'internal_admin',
          body: 'I will attach this to the readout notes.',
          findingId: 'finding_northstar_usage_gap',
        }),
      ]),
    )

    const auditEvents = await getAuditLogStore().listByWorkspace(workspace.id)
    expect(auditEvents).toHaveLength(2)
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'finding_commented',
          actorId: 'user_northstar_finance',
          targetType: 'finding',
          targetId: 'finding_northstar_usage_gap',
          metadata: expect.objectContaining({
            authorRole: 'customer_admin',
            bodyLength: 56,
          }),
        }),
        expect.objectContaining({
          action: 'finding_commented',
          actorId: 'internal_admin',
          targetType: 'finding',
          targetId: 'finding_northstar_usage_gap',
          metadata: expect.objectContaining({
            authorRole: 'internal_admin',
            bodyLength: 40,
          }),
        }),
      ]),
    )
    expect(cache.revalidatePath).toHaveBeenCalledWith('/findings/finding_northstar_usage_gap')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/findings/finding_northstar_usage_gap')
  })

  it('lets a customer move a visible finding into investigation with audited history', async () => {
    const workspace = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(workspace)
    await getFindingStore().saveMany([
      finding({
        id: 'finding_northstar_usage_gap',
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        status: 'open',
      }),
    ])
    const formData = new FormData()
    formData.set('workspaceId', workspace.id)
    formData.set('findingId', 'finding_northstar_usage_gap')
    formData.set('workflowStatus', 'investigating')
    formData.set('workflowStatusNote', 'Engineering is checking the usage feed.')

    await expect(updateFindingWorkflowStatusAction(formData)).rejects.toThrow(
      'NEXT_REDIRECT:/workspaces/workspace_northstar_june_2026/findings/finding_northstar_usage_gap',
    )

    await expect(getFindingStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        id: 'finding_northstar_usage_gap',
        status: 'investigating',
        reviewerId: 'user_northstar_finance',
        metadata: expect.objectContaining({
          issueStatusChangedBy: 'user_northstar_finance',
          issueStatusHistory: [
            expect.objectContaining({
              fromStatus: 'open',
              toStatus: 'investigating',
              note: 'Engineering is checking the usage feed.',
              actorId: 'user_northstar_finance',
            }),
          ],
        }),
      }),
    ])
    await expect(getAuditLogStore().listByWorkspace(workspace.id)).resolves.toEqual([
      expect.objectContaining({
        action: 'finding_issue_status_changed',
        actorId: 'user_northstar_finance',
        targetType: 'finding',
        targetId: 'finding_northstar_usage_gap',
        metadata: expect.objectContaining({
          fromStatus: 'open',
          status: 'investigating',
          hasNote: true,
        }),
      }),
    ])
    expect(cache.revalidatePath).toHaveBeenCalledWith('/findings/finding_northstar_usage_gap')
    expect(cache.revalidatePath).toHaveBeenCalledWith('/workspaces/workspace_northstar_june_2026/findings/finding_northstar_usage_gap')
  })
})

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_northstar_usage_gap',
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    customerId: 'contract_northstar',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Northstar usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.91,
    status: 'open',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_northstar' }],
    recommendedAction: 'Review billing configuration before close.',
    metadata: { customerName: 'Northstar AI' },
    ...overrides,
  })
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
