import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspacesPage from './page'

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
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('customer workspaces page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspaces-page-'))
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_northstar_june_2026', 'workspace_northstar_may_2026'],
      expiresAt: '2026-06-02T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('shows only workspaces available to the current customer with safe selector links', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace(
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
      ),
    )
    await getWorkspaceStore().save(
      createAuditWorkspace(
        {
          id: 'workspace_northstar_may_2026',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          name: 'May 2026 audit',
          auditPeriod: 'May 2026',
          billingSystem: 'Stripe',
          usageSource: 'Warehouse CSV',
          status: 'complete',
          createdBy: 'internal_admin',
        },
        new Date('2026-05-01T09:00:00.000Z'),
      ),
    )
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

    const page = await WorkspacesPage()
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Workspaces')
    expect(text).toContain('June 2026 audit')
    expect(text).toContain('May 2026 audit')
    expect(text).toContain('review')
    expect(text).toContain('complete')
    expect(text).not.toContain('Acme AI')
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/api/workspaces/workspace_northstar_june_2026/select?next=%2Fworkspaces%2Fworkspace_northstar_june_2026',
        '/api/workspaces/workspace_northstar_may_2026/select?next=%2Fworkspaces%2Fworkspace_northstar_may_2026',
      ]),
    )
    expect(hrefs).not.toContain('/api/workspaces/workspace_acme_june_2026/select?next=%2Fworkspaces%2Fworkspace_acme_june_2026')
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

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
