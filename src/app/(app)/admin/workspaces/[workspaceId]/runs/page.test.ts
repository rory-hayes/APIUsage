import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { parseJobSchema } from '@/lib/audit/parse-jobs'
import { createRuleRunRecord } from '@/lib/audit/rule-runs'
import { getAuditLogStore, getParseJobStore, getRuleRunStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceRunsPage from './page'

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
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_PARSE_JOB_PATH: process.env.AUDIT_PARSE_JOB_PATH,
  AUDIT_RULE_RUN_PATH: process.env.AUDIT_RULE_RUN_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace runs page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-runs-page-'))
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_PARSE_JOB_PATH = join(tempDir, 'parse-jobs.json')
    process.env.AUDIT_RULE_RUN_PATH = join(tempDir, 'rule-runs.json')
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

  it('renders parser and reconciliation runs for the requested workspace only', async () => {
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
    await getWorkspaceStore().save(northstar)
    await getParseJobStore().save(
      parseJobSchema.parse({
        id: 'parse_northstar_usage',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        uploadId: 'upl_northstar_usage',
        sourceFileId: 'src_northstar_usage',
        filename: 'northstar-usage.csv',
        category: 'usage_csv',
        parser: 'usage_csv',
        status: 'completed_with_errors',
        recordCount: 24,
        errorCount: 1,
        errors: [{ rowNumber: 4, message: 'Missing meter name' }],
        ranAt: '2026-06-02T11:00:00.000Z',
      }),
    )
    await getParseJobStore().save(
      parseJobSchema.parse({
        id: 'parse_acme_usage',
        organizationId: 'org_acme',
        workspaceId: 'workspace_acme_may_2026',
        uploadId: 'upl_acme_usage',
        sourceFileId: 'src_acme_usage',
        filename: 'acme-usage.csv',
        category: 'usage_csv',
        parser: 'usage_csv',
        status: 'complete',
        recordCount: 99,
        errorCount: 0,
        errors: [],
        ranAt: '2026-06-02T12:00:00.000Z',
      }),
    )
    await getAuditLogStore().append(
      createAuditLogEvent(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          actorId: 'internal_admin',
          action: 'check_run',
          targetType: 'workspace',
          targetId: northstar.id,
          metadata: {
            checkIds: ['usage_without_invoice', 'wrong_overage_rate', 'cost_exceeds_revenue'],
            parsedRecordCount: 24,
            findingCount: 3,
          },
        },
        new Date('2026-06-02T12:30:00.000Z'),
      ),
    )
    await getRuleRunStore().save(
      createRuleRunRecord({
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        actorId: 'internal_admin',
        ruleVersion: 'reconciliation_rules_v1',
        status: 'reviewing',
        inputs: {
          ruleTemplateIds: ['usage_without_invoice', 'wrong_overage_rate'],
          parsedRecordCount: 20,
          contractTermCount: 2,
          accountMappingCount: 1,
        },
        output: {
          findingCount: 2,
          findingIds: ['finding_usage', 'finding_resolved_rate'],
          findingCategories: ['usage_exists_no_invoice', 'wrong_overage_rate'],
        },
        errors: [],
        startedAt: new Date('2026-06-01T12:30:00.000Z'),
        completedAt: new Date('2026-06-01T12:30:03.000Z'),
      }),
    )
    await getRuleRunStore().save(
      createRuleRunRecord({
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        actorId: 'internal_admin',
        ruleVersion: 'reconciliation_rules_v1',
        status: 'reviewing',
        inputs: {
          ruleTemplateIds: ['usage_without_invoice', 'wrong_overage_rate', 'cost_exceeds_revenue'],
          parsedRecordCount: 24,
          contractTermCount: 2,
          accountMappingCount: 1,
          pricingRuleVersions: [
            {
              pricingRuleId: 'pricing_rule_northstar_api_overage',
              name: 'Northstar API overage',
              version: 2,
              status: 'active',
            },
          ],
        },
        output: {
          findingCount: 3,
          findingIds: ['finding_usage', 'finding_rate', 'finding_cost'],
          findingCategories: ['usage_exists_no_invoice', 'wrong_overage_rate', 'cost_exceeds_revenue'],
        },
        errors: [{ message: 'Cost export row 9 was skipped during rule evaluation' }],
        startedAt: new Date('2026-06-02T12:30:00.000Z'),
        completedAt: new Date('2026-06-02T12:30:03.000Z'),
      }),
    )
    await getAuditLogStore().append(
      createAuditLogEvent(
        {
          organizationId: 'org_acme',
          workspaceId: 'workspace_acme_may_2026',
          actorId: 'internal_admin',
          action: 'check_run',
          targetType: 'workspace',
          targetId: 'workspace_acme_may_2026',
          metadata: {
            parsedRecordCount: 99,
            findingCount: 1,
          },
        },
        new Date('2026-06-02T13:00:00.000Z'),
      ),
    )

    const page = await AdminWorkspaceRunsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controls = collectControls(page)

    expect(text).toContain('Run history')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('Run checks')
    expect(text).toContain('Rule template library')
    expect(text).toContain('Usage without invoice')
    expect(text).toContain('Cost exceeds revenue')
    expect(text).toContain('northstar-usage.csv')
    expect(text).toContain('completed with errors')
    expect(text).toContain('24 records')
    expect(text).toContain('Missing meter name')
    expect(text).toContain('Reconciliation checks')
    expect(text).toContain('Rule version reconciliation_rules_v1')
    expect(text).toContain('Pricing rules: Northstar API overage v2')
    expect(text).toContain('Run comparison')
    expect(text).toContain('2 new · 1 recurring · 1 resolved since previous run')
    expect(text).toContain('3 findings')
    expect(text).toContain('3 checks')
    expect(text).toContain('24 records · 2 contract terms · 1 mapping')
    expect(text).toContain('usage exists no invoice, wrong overage rate, cost exceeds revenue')
    expect(text).toContain('Cost export row 9 was skipped during rule evaluation')
    expect(text).not.toContain('acme-usage.csv')
    expect(text).not.toContain('99 records')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
    expect(controls).toContainEqual({ name: 'workspaceId', value: 'workspace_northstar_june_2026' })
    expect(controls).toContainEqual({ name: 'ruleTemplateIds', value: 'usage_without_invoice' })
    expect(controls).toContainEqual({ name: 'ruleTemplateIds', value: 'cost_exceeds_revenue' })
  })

  it('hides run history for workspaces that do not exist', async () => {
    await expect(AdminWorkspaceRunsPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) })).rejects.toThrow(
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
