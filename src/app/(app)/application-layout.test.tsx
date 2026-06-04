import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS } from '@/lib/audit/uploads'
import { type AuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import { ApplicationLayout } from './application-layout'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
}))

describe('application layout', () => {
  it('links workspace dropdown items through the workspace selector endpoint', () => {
    const layout = ApplicationLayout({
      children: null,
      currentWorkspace: workspaces[0],
      session,
      workspaces,
    })

    expect(collectHrefs(layout)).toContain('/api/workspaces/workspace_northstar_june_2026/select?next=%2Fadmin')
    expect(collectHrefs(layout)).toContain('/workspaces')
    expect(collectHrefs(layout)).toContain('/admin/customers')
    expect(collectHrefs(layout)).toContain('/settings/team')
  })
})

const session: Session = {
  userId: 'internal_admin',
  email: 'internal@usageintegrity.local',
  name: 'Rory',
  organizationId: 'org_internal',
  organizationName: 'Usage Revenue Integrity OS',
  role: 'internal_admin',
  workspaceIds: ['workspace_acme_may_2026'],
  expiresAt: '2026-06-02T23:59:59.000Z',
}

const workspaces: AuditWorkspace[] = [
  {
    id: 'workspace_acme_may_2026',
    organizationId: 'org_acme',
    organizationName: 'Acme AI',
    name: 'May 2026 audit',
    auditPeriod: 'May 2026',
    billingSystem: 'Stripe',
    usageSource: 'Warehouse CSV',
    currency: 'eur',
    requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
    monitoringPeriods: [
      {
        id: 'period_may_2026',
        label: 'May 2026',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
        status: 'active',
      },
    ],
    status: 'evidence_review',
    createdBy: 'internal_admin',
    createdAt: '2026-06-01T09:00:00.000Z',
  },
  {
    id: 'workspace_northstar_june_2026',
    organizationId: 'org_northstar',
    organizationName: 'Northstar AI',
    name: 'June 2026 audit',
    auditPeriod: 'June 2026',
    billingSystem: 'Stripe',
    usageSource: 'Warehouse CSV',
    currency: 'eur',
    requiredUploadCategories: DEFAULT_REQUIRED_UPLOAD_CATEGORY_IDS,
    monitoringPeriods: [
      {
        id: 'period_june_2026',
        label: 'June 2026',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        status: 'active',
      },
    ],
    status: 'review',
    createdBy: 'internal_admin',
    createdAt: '2026-06-02T09:00:00.000Z',
  },
]

function collectHrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectHrefs)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; href?: string; navbar?: ReactNode; sidebar?: ReactNode }

  return [
    ...(props.href ? [props.href] : []),
    ...collectHrefs(props.navbar),
    ...collectHrefs(props.sidebar),
    ...collectHrefs(props.children),
  ]
}
