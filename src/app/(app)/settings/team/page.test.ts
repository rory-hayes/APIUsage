import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getInviteStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { createWorkspaceInvite } from '@/lib/auth/invites'
import { type Session } from '@/lib/auth/access'

import TeamSettingsPage from './page'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => {
    if (!sessionState.current) {
      throw new Error('Missing test session')
    }

    return sessionState.current
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('team settings page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-team-settings-page-'))
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
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
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('lists the current user and active invites for the active workspace only', async () => {
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
    await getInviteStore().save(
      createWorkspaceInvite(
        {
          email: 'analyst@northstar.ai',
          name: 'Northstar Analyst',
          organizationId: workspace.organizationId,
          organizationName: workspace.organizationName,
          role: 'customer_member',
          workspaceId: workspace.id,
          invitedBy: 'internal_admin',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
    )
    await getInviteStore().save(
      createWorkspaceInvite(
        {
          email: 'finance@acme.ai',
          name: 'Acme Finance',
          organizationId: 'org_acme',
          organizationName: 'Acme AI',
          role: 'customer_admin',
          workspaceId: 'workspace_acme_may_2026',
          invitedBy: 'internal_admin',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
    )

    const page = await TeamSettingsPage()
    const text = collectText(page)

    expect(text).toContain('Team')
    expect(text).toContain('Northstar Finance')
    expect(text).toContain('finance@northstar.ai')
    expect(text).toContain('customer admin')
    expect(text).toContain('Northstar Analyst')
    expect(text).toContain('analyst@northstar.ai')
    expect(text).toContain('customer member')
    expect(text).toContain('active')
    expect(text).not.toContain('Acme Finance')
    expect(text).not.toContain('finance@acme.ai')
  })

  it('does not expose internal operator accounts in a customer team view', async () => {
    sessionState.current = {
      userId: 'user_customer_admin',
      email: 'customer@acme.ai',
      name: 'Acme Finance Admin',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }

    const page = await TeamSettingsPage()
    const text = collectText(page)

    expect(text).toContain('Acme Finance Admin')
    expect(text).toContain('Acme Audit Member')
    expect(text).not.toContain('Rory')
    expect(text).not.toContain('internal@usageintegrity.local')
    expect(text).not.toContain('internal admin')
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
