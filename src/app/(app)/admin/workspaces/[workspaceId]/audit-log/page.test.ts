import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { getAuditLogStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AuditLogPage from './page'

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

const ORIGINAL_ENV = {
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace audit log page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-audit-log-page-'))
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
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

  it('renders audit events for the requested workspace only', async () => {
    const northstarWorkspace = createAuditWorkspace(
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
    await getWorkspaceStore().save(northstarWorkspace)
    await getAuditLogStore().append(
      createAuditLogEvent(
        {
          organizationId: northstarWorkspace.organizationId,
          workspaceId: northstarWorkspace.id,
          actorId: 'internal_admin',
          action: 'finding_published',
          targetType: 'finding',
          targetId: 'finding_northstar_unbilled_overage',
          metadata: {
            status: 'approved_internal',
          },
        },
        new Date('2026-06-02T11:00:00.000Z'),
      ),
    )
    await getAuditLogStore().append(
      createAuditLogEvent(
        {
          organizationId: 'org_acme',
          workspaceId: 'workspace_acme_may_2026',
          actorId: 'internal_admin',
          action: 'file_uploaded',
          targetType: 'upload',
          targetId: 'upl_acme_usage',
        },
        new Date('2026-06-02T12:00:00.000Z'),
      ),
    )

    const page = await AuditLogPage({ params: Promise.resolve({ workspaceId: northstarWorkspace.id }) })
    const text = collectText(page)

    expect(text).toContain('Audit log')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('Finding published')
    expect(text).toContain('finding_northstar_unbilled_overage')
    expect(text).toContain('approved_internal')
    expect(text).not.toContain('upl_acme_usage')
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

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
