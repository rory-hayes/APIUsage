import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'

import AdminWorkspacesPage from './page'

const ORIGINAL_ENV = {
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspaces page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspaces-page-'))
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('links each workspace registry row to its admin workspace hub and audit log', async () => {
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

    const page = await AdminWorkspacesPage()
    const hrefs = collectHrefs(page)

    expect(collectText(page)).toContain('Northstar AI')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026/audit-log')
  })

  it('renders V1 onboarding controls for currency and required upload checklist', async () => {
    const page = await AdminWorkspacesPage()
    const text = collectText(page)
    const controls = collectControls(page)

    expect(text).toContain('Currency')
    expect(text).toContain('Required upload checklist')
    expect(text).toContain('Provider cost CSV')
    expect(controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'currency' }),
        expect.objectContaining({ name: 'requiredUploadCategories', value: 'contracts_order_forms' }),
        expect.objectContaining({ name: 'requiredUploadCategories', value: 'usage_csv' }),
        expect.objectContaining({ name: 'requiredUploadCategories', value: 'provider_cost_csv' }),
      ]),
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
