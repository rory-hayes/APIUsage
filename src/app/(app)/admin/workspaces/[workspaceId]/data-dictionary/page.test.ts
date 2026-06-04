import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDataDictionaryEntry } from '@/lib/audit/data-dictionary'
import { getDataDictionaryStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceDataDictionaryPage from './page'

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
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`)
  }),
}))

const ORIGINAL_ENV = {
  AUDIT_DATA_DICTIONARY_PATH: process.env.AUDIT_DATA_DICTIONARY_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace data dictionary page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-data-dictionary-page-'))
    process.env.AUDIT_DATA_DICTIONARY_PATH = join(tempDir, 'data-dictionary.json')
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

  it('renders workspace-specific field meanings and a documentation form', async () => {
    const northstar = createAuditWorkspace(
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
    const acme = createAuditWorkspace(
      {
        id: 'workspace_acme_may_2026',
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        name: 'May 2026 audit',
        auditPeriod: 'May 2026',
        billingSystem: 'Stripe',
        usageSource: 'Warehouse CSV',
        status: 'review',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    await getWorkspaceStore().save(northstar)
    await getWorkspaceStore().save(acme)
    await getDataDictionaryStore().saveMany([
      createDataDictionaryEntry({
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        sourceCategory: 'usage_csv',
        sourceField: 'meter_name',
        normalizedField: 'meter',
        dataType: 'string',
        meaning: 'Northstar calls this the billable API usage meter.',
        exampleValue: 'llm_tokens',
        notes: 'Confirmed by RevOps during onboarding.',
        createdBy: 'internal_admin',
      }),
      createDataDictionaryEntry({
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        sourceCategory: 'stripe_invoices_export',
        sourceField: 'amount_due',
        meaning: 'Acme-only invoice note.',
        createdBy: 'internal_admin',
      }),
    ])

    const page = await AdminWorkspaceDataDictionaryPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Data dictionary')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('1 documented field')
    expect(text).toContain('usage csv')
    expect(text).toContain('meter_name')
    expect(text).toContain('meter')
    expect(text).toContain('Northstar calls this the billable API usage meter.')
    expect(text).toContain('llm_tokens')
    expect(text).toContain('Confirmed by RevOps during onboarding.')
    expect(text).toContain('Document field meaning')
    expect(text).not.toContain('Acme-only invoice note.')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
    expect(controlNames).toEqual(
      expect.arrayContaining(['workspaceId', 'sourceCategory', 'sourceField', 'normalizedField', 'dataType', 'meaning', 'exampleValue', 'notes']),
    )
  })

  it('hides data dictionary workspaces that do not exist', async () => {
    await expect(
      AdminWorkspaceDataDictionaryPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
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

function collectControlNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectControlNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }

  return [...(props.name ? [props.name] : []), ...collectControlNames(props.children)]
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
