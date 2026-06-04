import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createContractTermVersion, reviewContractTerm } from '@/lib/audit/contract-terms'
import { createPricingRule } from '@/lib/audit/pricing-rules'
import { contractTermSchema, type ContractTerm } from '@/lib/audit/schemas'
import { getContractTermStore, getPricingRuleStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { type Session } from '@/lib/auth/access'

import AdminWorkspaceContractTermsPage from './page'

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
  AUDIT_CONTRACT_TERM_PATH: process.env.AUDIT_CONTRACT_TERM_PATH,
  AUDIT_PRICING_RULE_PATH: process.env.AUDIT_PRICING_RULE_PATH,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('admin workspace contract terms page', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-admin-workspace-contract-terms-page-'))
    process.env.AUDIT_CONTRACT_TERM_PATH = join(tempDir, 'contract-terms.json')
    process.env.AUDIT_PRICING_RULE_PATH = join(tempDir, 'pricing-rules.json')
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

  it('renders workspace-specific terms, evidence, version counts, and review controls', async () => {
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
    const candidate = contractTerm({
      id: 'term_northstar_overage',
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      customerId: 'contract_northstar',
      type: 'overage_rate',
      rate: 2.5,
      currency: 'eur',
      unit: '1k_api_calls',
      confidence: 0.9,
      status: 'candidate',
      evidence: {
        sourceFileId: 'src_northstar_order_form',
        page: 4,
        snippet: 'Overage charged at EUR 2.50 per 1k API calls.',
      },
      metadata: {
        evidenceQuality: {
          level: 'strong',
          signals: ['source page captured', 'evidence snippet captured'],
          missingSignals: ['effective date window missing'],
        },
      },
    })
    const reviewed = reviewContractTerm(
      candidate,
      {
        status: 'candidate',
        reviewerId: 'internal_admin',
        note: 'Adjusted after checking amendment.',
        updates: {
          rate: 2.75,
        },
      },
      new Date('2026-06-02T10:00:00.000Z'),
    )
    await getContractTermStore().saveMany([
      reviewed,
      contractTerm({
        id: 'term_northstar_allowance',
        organizationId: northstar.organizationId,
        workspaceId: northstar.id,
        customerId: 'contract_northstar',
        type: 'allowance',
        allowance: 100000,
        billingPeriod: 'monthly',
        threshold: 500,
        unit: 'api_calls',
        status: 'approved',
        evidence: {
          sourceFileId: 'src_northstar_order_form',
          page: 3,
          snippet: 'Included allowance: 100,000 API calls per month.',
        },
      }),
      contractTerm({
        id: 'term_acme_overage',
        organizationId: acme.organizationId,
        workspaceId: acme.id,
        customerId: 'contract_acme',
        type: 'overage_rate',
        rate: 1.25,
        currency: 'eur',
        status: 'candidate',
        evidence: {
          sourceFileId: 'src_acme_order_form',
          snippet: 'Acme overage charged at EUR 1.25.',
        },
      }),
    ])
    await getContractTermStore().appendVersion(
      createContractTermVersion(candidate, reviewed, {
        reviewerId: 'internal_admin',
        note: 'Adjusted after checking amendment.',
        reviewedAt: new Date('2026-06-02T10:00:00.000Z'),
      }),
    )

    const page = await AdminWorkspaceContractTermsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)
    const hrefs = collectHrefs(page)
    const controlNames = collectControlNames(page)

    expect(text).toContain('Contract terms')
    expect(text).toContain('Northstar AI')
    expect(text).toContain('June 2026')
    expect(text).toContain('2 terms')
    expect(text).toContain('1 candidate')
    expect(text).toContain('1 approved')
    expect(text).toContain('overage rate')
    expect(text).toContain('2.75 eur per 1k_api_calls')
    expect(text).toContain('monthly')
    expect(text).toContain('threshold 500')
    expect(text).toContain('Included allowance: 100,000 API calls per month.')
    expect(text).toContain('Overage charged at EUR 2.50 per 1k API calls.')
    expect(text).toContain('90% confidence')
    expect(text).toContain('strong evidence')
    expect(text).toContain('Signals: 2 captured')
    expect(text).toContain('Missing: 1 needs review')
    expect(text).toContain('1 version')
    expect(text).toContain('Approve')
    expect(text).toContain('Reject')
    expect(text).toContain('Add manual term')
    expect(text).not.toContain('Acme AI')
    expect(text).not.toContain('Acme overage')
    expect(hrefs).toContain('/admin/workspaces/workspace_northstar_june_2026')
    expect(controlNames).toEqual(expect.arrayContaining(['workspaceId', 'termId', 'rate', 'allowance', 'billingPeriod', 'threshold', 'evidenceSnippet']))
  })

  it('shows contract-to-pricing-rule comparison status for each comparable term', async () => {
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
    const matchedAllowance = contractTerm({
      id: 'term_northstar_allowance',
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      type: 'allowance',
      meter: 'api_calls',
      unit: 'calls',
      billingPeriod: 'monthly',
      allowance: 100000,
      status: 'approved',
    })
    const mismatchedOverage = contractTerm({
      id: 'term_northstar_overage',
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      type: 'overage_rate',
      meter: 'api_calls',
      unit: '1k_api_calls',
      billingPeriod: 'monthly',
      threshold: 100000,
      rate: 2.5,
      currency: 'eur',
      effectiveTo: '2026-12-31',
      status: 'candidate',
    })
    const missingDiscount = contractTerm({
      id: 'term_northstar_discount',
      organizationId: northstar.organizationId,
      workspaceId: northstar.id,
      type: 'discount',
      discountPercent: 15,
      effectiveTo: '2026-09-30',
      status: 'candidate',
    })
    await getContractTermStore().saveMany([matchedAllowance, mismatchedOverage, missingDiscount])
    await getPricingRuleStore().saveMany([
      createPricingRule(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          name: 'Northstar included API calls',
          type: 'allowance',
          meter: 'api_calls',
          unit: 'calls',
          billingPeriod: 'monthly',
          allowance: 100000,
          createdBy: 'user_finance',
        },
        new Date('2026-06-03T09:00:00.000Z'),
      ),
      createPricingRule(
        {
          organizationId: northstar.organizationId,
          workspaceId: northstar.id,
          name: 'Northstar API overage',
          type: 'overage_rate',
          meter: 'api_calls',
          unit: '1k_api_calls',
          billingPeriod: 'monthly',
          threshold: 125000,
          rate: 2.75,
          currency: 'EUR',
          effectiveTo: '2027-05-31',
          createdBy: 'user_finance',
        },
        new Date('2026-06-03T09:05:00.000Z'),
      ),
    ])

    const page = await AdminWorkspaceContractTermsPage({ params: Promise.resolve({ workspaceId: northstar.id }) })
    const text = collectText(page)

    expect(text).toContain('Pricing rule comparison')
    expect(text).toContain('1 matched · 1 mismatch · 1 missing rule')
    expect(text).toContain('Pricing matched')
    expect(text).toContain('Northstar included API calls')
    expect(text).toContain('Pricing mismatch')
    expect(text).toContain('Northstar API overage')
    expect(text).toContain('rate: contract 2.5 vs rule 2.75')
    expect(text).toContain('threshold: contract 100,000 vs rule 125,000')
    expect(text).toContain('effective to: contract 2026-12-31 vs rule 2027-05-31')
    expect(text).toContain('No pricing rule')
    expect(text).toContain('Configure a pricing rule for this extracted term.')
  })

  it('hides contract-term workspaces that do not exist', async () => {
    await expect(
      AdminWorkspaceContractTermsPage({ params: Promise.resolve({ workspaceId: 'workspace_missing' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

function contractTerm(
  input: Partial<ContractTerm> & {
    id: string
    organizationId: string
    workspaceId: string
    type: ContractTerm['type']
    billingPeriod?: string
    threshold?: number
  },
) {
  return contractTermSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    customerId: input.customerId,
    type: input.type,
    meter: input.meter,
    unit: input.unit,
    rate: input.rate,
    allowance: input.allowance,
    billingPeriod: input.billingPeriod,
    threshold: input.threshold,
    creditAmount: input.creditAmount,
    minimumAmount: input.minimumAmount,
    discountPercent: input.discountPercent,
    currency: input.currency,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    status: input.status ?? 'candidate',
    evidence: input.evidence,
    confidence: input.confidence,
    metadata: input.metadata ?? {},
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
