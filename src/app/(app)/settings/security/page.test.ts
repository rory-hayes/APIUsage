import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import SecurityPage from './page'

const sessionState = vi.hoisted(() => ({
  current: null as Session | null,
}))

vi.mock('@/lib/auth/server', () => ({
  getCurrentSession: vi.fn(async () => sessionState.current),
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

describe('security settings page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-security-page-'))
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
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
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('targets the active workspace in the internal deletion form', async () => {
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

    const page = await SecurityPage({ searchParams: Promise.resolve({}) })
    const form = findElement(page, (element) => element.type === 'form')

    expect(form).not.toBeNull()
    expect((form!.props as { action?: string }).action).toBe('/api/workspaces/workspace_northstar_june_2026/delete')
    expect(collectText(page)).toContain('Northstar AI')
  })

  it('links V0 NDA and DPA placeholder documents as manual security tasks', async () => {
    const page = await SecurityPage({ searchParams: Promise.resolve({}) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Legal and trust documents')
    expect(text).toContain('NDA template')
    expect(text).toContain('DPA placeholder')
    expect(text).toContain('Manual review before sending to customers')
    expect(hrefs).toContain('/security/nda-template.md')
    expect(hrefs).toContain('/security/data-processing-addendum-placeholder.md')
  })
})

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate)

      if (match) return match
    }

    return null
  }

  if (!isValidElement(node)) {
    return null
  }

  if (predicate(node)) {
    return node
  }

  return findElement((node.props as { children?: ReactNode }).children, predicate)
}

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
