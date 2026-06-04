import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createManualAccountMapping } from '@/lib/audit/account-mapping'
import { parsedRecordSchema } from '@/lib/audit/parse-jobs'
import { contractTermSchema } from '@/lib/audit/schemas'
import { getAccountMappingStore, getContractTermStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceMappingsPage from './page'

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
  AUDIT_ACCOUNT_MAPPING_PATH: process.env.AUDIT_ACCOUNT_MAPPING_PATH,
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_PARSED_RECORD_PATH: process.env.AUDIT_PARSED_RECORD_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace mappings page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-mappings-page-'))
    process.env.AUDIT_ACCOUNT_MAPPING_PATH = join(tempDir, 'account-mappings.json')
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_PARSED_RECORD_PATH = join(tempDir, 'parsed-records.json')
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

  it('renders workspace-specific mapping health, saved mappings, and unmapped identifiers', async () => {
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
    await getParsedRecordStore().saveMany([
      usageRecord({ workspace: northstar, accountId: 'acct_northstar_usage', customerName: 'Northstar AI' }),
      usageRecord({ workspace: northstar, id: 'usage_unmapped', accountId: 'acct_unmapped_usage', customerName: 'Unmapped Usage Co' }),
      invoiceRecord({ workspace: northstar, externalCustomerId: 'cus_northstar_stripe', customerEmail: 'billing@northstar.ai' }),
      invoiceRecord({ workspace: northstar, id: 'invoice_unmapped', externalCustomerId: 'cus_unmapped_stripe', customerEmail: 'ap@unmapped.ai' }),
      usageRecord({ workspace: acme, accountId: 'acct_acme_usage', customerName: 'Acme AI' }),
      invoiceRecord({ workspace: acme, externalCustomerId: 'cus_acme_stripe', customerEmail: 'billing@acme.ai' }),
    ])
    await getContractTermStore().saveMany([
      contractTermSchema.parse({
        id: 'term_northstar_contract_customer',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        customerId: 'contract_northstar_unmapped',
        type: 'allowance',
        allowance: 100000,
        unit: 'api calls',
        status: 'candidate',
        evidence: {
          sourceFileId: 'src_northstar_contract',
          page: 4,
          snippet: 'Included allowance: 100,000 API calls per month.',
        },
      }),
    ])
    await getAccountMappingStore().saveMany([
      createManualAccountMapping(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          displayName: 'Northstar AI',
          usageAccountId: 'acct_northstar_usage',
          stripeCustomerId: 'cus_northstar_stripe',
          stripeCustomerEmail: 'billing@northstar.ai',
          reviewerId: 'internal_admin',
          note: 'Confirmed by customer mapping CSV.',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
      createManualAccountMapping(
        {
          organizationId: acme.organizationId,
          workspaceId: acme.id,
          displayName: 'Acme AI',
          usageAccountId: 'acct_acme_usage',
          stripeCustomerId: 'cus_acme_stripe',
          reviewerId: 'internal_admin',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
    ])

    const page = await AdminWorkspaceMappingsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)

    expect(text).toContain('Account mappings')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('1 saved mapping')
    expect(text).toContain('3 unmapped identifiers')
    expect(text).toContain('acct_unmapped_usage')
    expect(text).toContain('cus_unmapped_stripe')
    expect(text).toContain('contract_northstar_unmapped')
    expect(text).toContain('Confirmed by customer mapping CSV.')
    expect(text).toContain('Manual override')
    expect(text).toContain('Suggest mappings')
    expect(text).not.toContain('Acme AI')
    expect(text).not.toContain('acct_acme_usage')
    expect(text).not.toContain('cus_acme_stripe')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
  })

  it('hides mapping workspaces that do not exist', async () => {
    await expect(
      AdminWorkspaceMappingsPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

function usageRecord({
  workspace,
  id = 'usage_northstar',
  accountId,
  customerName,
}: {
  workspace: { id: string; organizationId: string }
  id?: string
  accountId: string
  customerName: string
}) {
  return parsedRecordSchema.parse({
    id,
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    jobId: `job_${id}`,
    uploadId: `upload_${id}`,
    sourceFileId: `source_${id}`,
    recordType: 'usage',
    sourceRowNumber: 2,
    data: {
      id,
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      accountId,
      customerName,
      meter: 'api_calls',
      quantity: 1000,
      unit: 'calls',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T23:59:59.000Z',
      sourceRefs: [{ sourceFileId: `source_${id}`, rowNumber: 2 }],
      metadata: {},
    },
  })
}

function invoiceRecord({
  workspace,
  id = 'invoice_northstar',
  externalCustomerId,
  customerEmail,
}: {
  workspace: { id: string; organizationId: string }
  id?: string
  externalCustomerId: string
  customerEmail: string
}) {
  return parsedRecordSchema.parse({
    id,
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    jobId: `job_${id}`,
    uploadId: `upload_${id}`,
    sourceFileId: `source_${id}`,
    recordType: 'invoice_line',
    sourceRowNumber: 2,
    data: {
      id,
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      invoiceId: `in_${id}`,
      externalCustomerId,
      customerEmail,
      description: 'June API calls',
      amount: 25000,
      currency: 'eur',
      status: 'open',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T23:59:59.000Z',
      sourceRefs: [{ sourceFileId: `source_${id}`, rowNumber: 2 }],
      metadata: {},
    },
  })
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
