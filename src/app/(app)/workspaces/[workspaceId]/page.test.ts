import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspaceDetailPage from './page'

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

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('customer workspace detail page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-detail-page-'))
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

  it('renders the selected workspace overview with pinned workflow links', async () => {
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

    const page = await WorkspaceDetailPage({ params: Promise.resolve({ workspaceId: 'workspace_northstar_june_2026' }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Workspace overview')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026 audit')
    expect(text).toContain('Stripe')
    expect(text).toContain('Warehouse CSV')
    expect(text).toContain('review')
    expect(text).toContain('Complete intake')
    expect(text).toContain('Upload source files')
    expect(text).toContain('Track audit status')
    expect(text).toContain('Review findings')
    expect(text).toContain('Open evidence pack')
    expect(text).not.toContain('Acme AI')
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/workspaces/workspace_northstar_june_2026/intake',
        '/workspaces/workspace_northstar_june_2026/uploads',
        '/workspaces/workspace_northstar_june_2026/status',
        '/workspaces/workspace_northstar_june_2026/findings',
        '/workspaces/workspace_northstar_june_2026/evidence-pack',
      ]),
    )
  })

  it('hides workspaces outside the current session', async () => {
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

    await expect(WorkspaceDetailPage({ params: Promise.resolve({ workspaceId: 'workspace_acme_june_2026' }) })).rejects.toThrow(
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

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
