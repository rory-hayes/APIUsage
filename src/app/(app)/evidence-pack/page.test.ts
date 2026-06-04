import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import EvidencePackPage from './page'

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
  AUDIT_FINDING_PATH: process.env.AUDIT_FINDING_PATH,
  AUDIT_INTAKE_PATH: process.env.AUDIT_INTAKE_PATH,
  AUDIT_REPORT_BUILDER_PATH: process.env.AUDIT_REPORT_BUILDER_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('evidence pack page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-evidence-pack-page-'))
    process.env.AUDIT_FINDING_PATH = join(tempDir, 'findings.json')
    process.env.AUDIT_INTAKE_PATH = join(tempDir, 'intake.json')
    process.env.AUDIT_REPORT_BUILDER_PATH = join(tempDir, 'report-builder.json')
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

  it('uses server-side audited export URLs', async () => {
    await saveNorthstarWorkspace()

    const page = await EvidencePackPage()
    const hrefs = collectHrefs(page)

    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=markdown')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=csv')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=pdf')
    expect(hrefs).toContain('/api/workspaces/workspace_northstar_june_2026/evidence-pack?format=readout')
    expect(hrefs.some((href) => href.startsWith('data:'))).toBe(false)
  })
})

async function saveNorthstarWorkspace() {
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
