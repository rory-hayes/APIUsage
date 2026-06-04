import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createIntakeResponse } from '@/lib/audit/intake'
import { getIntakeStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import WorkspaceIntakePage from './page'

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
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`)
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace intake page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-intake-page-'))
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    sessionState.current = {
      userId: 'user_northstar_finance',
      email: 'finance@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_acme_may_2026', 'workspace_northstar_june_2026'],
      expiresAt: '2026-06-03T23:59:59.000Z',
    }
  })

  afterEach(async () => {
    sessionState.current = null
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders intake for the requested accessible workspace only', async () => {
    const northstar = createAuditWorkspace(
      {
        id: 'workspace_northstar_june_2026',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-02T09:00:00.000Z'),
    )
    const acme = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstar)
    await getWorkspaceStore().save(acme)
    await getIntakeStore().save(
      createIntakeResponse({
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        updatedBy: 'user_northstar_finance',
        answers: {
          billing_model: 'Northstar enterprise subscription with API overages',
          billing_systems: 'Stripe and HubSpot',
        },
      }),
    )
    await getIntakeStore().save(
      createIntakeResponse({
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        updatedBy: 'user_acme_finance',
        answers: {
          billing_model: 'Acme legacy plan',
        },
      }),
    )

    const page = await WorkspaceIntakePage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const controls = collectControls(page)

    expect(text).toContain('Intake')
    expect(text).toContain('Commercial, billing, usage, and close-process context for Northstar AI - June 2026.')
    expect(text).toContain('in progress')
    expect(text).toContain('29% complete')
    expect(text).toContain('Billing model')
    expect(text).toContain('Northstar enterprise subscription with API overages')
    expect(text).toContain('Stripe and HubSpot')
    expect(text).not.toContain('Acme AI')
    expect(text).not.toContain('Acme legacy plan')
    expect(controls).toContainEqual({ name: 'workspaceId', value: northstar.id })
  })

  it('hides intake workspaces outside the current session', async () => {
    await getWorkspaceStore().save(
      createAuditWorkspace({
        id: 'workspace_outside_session',
        organizationId: 'org_other',
        organizationName: 'Other Co',
        name: 'June 2026 audit',
        auditPeriod: 'June 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'intake',
        createdBy: 'internal_admin',
      }),
    )

    await expect(WorkspaceIntakePage({ params: Promise.resolve({ workspaceId: 'workspace_outside_session' }) })).rejects.toThrow(
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

function collectControls(node: ReactNode): Array<{ name: string; value?: unknown }> {
  if (Array.isArray(node)) {
    return node.flatMap(collectControls)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string; value?: unknown }

  return [...(props.name ? [{ name: props.name, value: props.value }] : []), ...collectControls(props.children)]
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
