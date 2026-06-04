import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  approvePricingRule,
  createPricingRule,
  isMaterialPricingRuleChange,
  JsonPricingRuleStore,
  rejectPricingRule,
  requestPricingRuleCustomerApproval,
  updatePricingRule,
} from './pricing-rules'

describe('pricing rule configuration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-pricing-rules-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates active rules for rates, allowances, overages, discounts, and effective dates', () => {
    const now = new Date('2026-06-03T09:00:00.000Z')
    const rate = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'API call standard rate',
        type: 'rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        billingPeriod: 'monthly',
        rate: 2.5,
        currency: 'EUR',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-12-31',
        createdBy: 'user_finance',
      },
      now,
    )
    const allowance = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'Included API calls',
        type: 'allowance',
        meter: 'api_calls',
        unit: 'calls',
        billingPeriod: 'monthly',
        allowance: 100_000,
        effectiveFrom: '2026-06-01',
        createdBy: 'user_finance',
      },
      now,
    )
    const overage = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'API overage rate',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        billingPeriod: 'monthly',
        threshold: 100_000,
        rate: 1.25,
        currency: 'EUR',
        effectiveFrom: '2026-06-01',
        createdBy: 'user_finance',
      },
      now,
    )
    const discount = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'Launch discount',
        type: 'discount',
        discountPercent: 15,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-09-30',
        createdBy: 'user_finance',
      },
      now,
    )

    expect(rate).toMatchObject({
      id: 'pricing_rule_workspace_001_api_call_standard_rate_2026_06_03T09_00_00_000Z',
      status: 'active',
      version: 1,
      currency: 'eur',
      createdBy: 'user_finance',
      updatedBy: 'user_finance',
      createdAt: '2026-06-03T09:00:00.000Z',
      updatedAt: '2026-06-03T09:00:00.000Z',
    })
    expect(allowance).toMatchObject({
      type: 'allowance',
      allowance: 100_000,
      effectiveFrom: '2026-06-01',
    })
    expect(overage).toMatchObject({
      type: 'overage_rate',
      rate: 1.25,
      threshold: 100_000,
      currency: 'eur',
    })
    expect(discount).toMatchObject({
      type: 'discount',
      discountPercent: 15,
      effectiveTo: '2026-09-30',
    })
  })

  it('updates configured rule values while preserving creation metadata', () => {
    const created = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'API overage rate',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        rate: 1.25,
        currency: 'EUR',
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    const updated = updatePricingRule(
      created,
      {
        name: 'API overage rate - amended',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        rate: 1.5,
        threshold: 125_000,
        currency: 'EUR',
        effectiveFrom: '2026-07-01',
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-04T10:30:00.000Z'),
    )

    expect(updated).toMatchObject({
      id: created.id,
      organizationId: created.organizationId,
      workspaceId: created.workspaceId,
      createdBy: 'user_finance',
      createdAt: '2026-06-03T09:00:00.000Z',
      updatedBy: 'internal_admin',
      updatedAt: '2026-06-04T10:30:00.000Z',
      name: 'API overage rate - amended',
      rate: 1.5,
      threshold: 125_000,
      effectiveFrom: '2026-07-01',
    })
  })

  it('detects material commercial changes that require customer approval', () => {
    const created = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'API overage rate',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        rate: 1.25,
        threshold: 100_000,
        currency: 'EUR',
        effectiveFrom: '2026-06-01',
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    const renamed = updatePricingRule(
      created,
      {
        name: 'API overage rate - renamed',
        type: created.type,
        meter: created.meter,
        unit: created.unit,
        rate: created.rate,
        threshold: created.threshold,
        currency: created.currency,
        effectiveFrom: created.effectiveFrom,
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )
    const repriced = updatePricingRule(
      created,
      {
        name: created.name,
        type: created.type,
        meter: created.meter,
        unit: created.unit,
        rate: 1.5,
        threshold: created.threshold,
        currency: created.currency,
        effectiveFrom: created.effectiveFrom,
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )

    expect(isMaterialPricingRuleChange(created, renamed)).toBe(false)
    expect(isMaterialPricingRuleChange(created, repriced)).toBe(true)
  })

  it('increments versions only for material pricing rule changes', () => {
    const created = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'API overage rate',
        type: 'overage_rate',
        meter: 'api_calls',
        unit: '1k_api_calls',
        rate: 1.25,
        threshold: 100_000,
        currency: 'EUR',
        effectiveFrom: '2026-06-01',
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    const renamed = updatePricingRule(
      created,
      {
        name: 'API overage rate - renamed',
        type: created.type,
        meter: created.meter,
        unit: created.unit,
        rate: created.rate,
        threshold: created.threshold,
        currency: created.currency,
        effectiveFrom: created.effectiveFrom,
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )
    const repriced = updatePricingRule(
      renamed,
      {
        name: renamed.name,
        type: renamed.type,
        meter: renamed.meter,
        unit: renamed.unit,
        rate: 1.5,
        threshold: renamed.threshold,
        currency: renamed.currency,
        effectiveFrom: renamed.effectiveFrom,
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T11:00:00.000Z'),
    )

    expect(created.version).toBe(1)
    expect(renamed.version).toBe(1)
    expect(repriced.version).toBe(2)
  })

  it('marks a material pricing rule change as pending customer approval', () => {
    const rule = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'API overage rate',
        type: 'overage_rate',
        rate: 1.5,
        currency: 'EUR',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    const pending = requestPricingRuleCustomerApproval(
      rule,
      {
        requestedBy: 'internal_admin',
        reason: 'Internal amendment changes API overage economics.',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )

    expect(pending).toMatchObject({
      id: rule.id,
      status: 'pending_customer_approval',
      updatedBy: 'internal_admin',
      updatedAt: '2026-06-03T10:00:00.000Z',
      metadata: {
        customerApprovalRequestedBy: 'internal_admin',
        customerApprovalRequestedAt: '2026-06-03T10:00:00.000Z',
        customerApprovalReason: 'Internal amendment changes API overage economics.',
      },
    })
  })

  it('approves or rejects pending pricing rules with customer decision metadata', () => {
    const pending = requestPricingRuleCustomerApproval(
      createPricingRule(
        {
          organizationId: 'org_001',
          workspaceId: 'workspace_001',
          name: 'API overage rate',
          type: 'overage_rate',
          rate: 1.5,
          currency: 'EUR',
          createdBy: 'internal_admin',
        },
        new Date('2026-06-03T09:00:00.000Z'),
      ),
      {
        requestedBy: 'internal_admin',
      },
      new Date('2026-06-03T10:00:00.000Z'),
    )

    expect(
      approvePricingRule(
        pending,
        {
          approvedBy: 'user_customer_admin',
          note: 'Approved for July close.',
        },
        new Date('2026-06-04T11:00:00.000Z'),
      ),
    ).toMatchObject({
      status: 'active',
      updatedBy: 'user_customer_admin',
      metadata: {
        customerApprovedBy: 'user_customer_admin',
        customerApprovedAt: '2026-06-04T11:00:00.000Z',
        customerApprovalNote: 'Approved for July close.',
      },
    })
    expect(
      rejectPricingRule(
        pending,
        {
          rejectedBy: 'user_customer_admin',
          note: 'Signed order form still says EUR 1.25.',
        },
        new Date('2026-06-04T11:15:00.000Z'),
      ),
    ).toMatchObject({
      status: 'rejected',
      updatedBy: 'user_customer_admin',
      metadata: {
        customerRejectedBy: 'user_customer_admin',
        customerRejectedAt: '2026-06-04T11:15:00.000Z',
        customerRejectionNote: 'Signed order form still says EUR 1.25.',
      },
    })
  })

  it('persists and deletes pricing rules by workspace', async () => {
    const store = new JsonPricingRuleStore(join(tempDir, 'pricing-rules.json'))
    const target = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        name: 'Target discount',
        type: 'discount',
        discountPercent: 10,
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )
    const other = createPricingRule(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        name: 'Other discount',
        type: 'discount',
        discountPercent: 5,
        createdBy: 'user_finance',
      },
      new Date('2026-06-03T09:05:00.000Z'),
    )

    await store.saveMany([target, other])

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([target])
    await expect(store.listByWorkspace('workspace_002')).resolves.toEqual([other])
    await expect(store.deleteByWorkspace('workspace_001')).resolves.toBe(1)
    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(store.listByWorkspace('workspace_002')).resolves.toEqual([other])
  })

  it('rejects missing type-specific values and inverted effective date ranges', () => {
    const base = {
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      name: 'Invalid pricing rule',
      createdBy: 'user_finance',
    }

    expect(() => createPricingRule({ ...base, type: 'rate' })).toThrow('Rate rules require a rate')
    expect(() => createPricingRule({ ...base, type: 'allowance' })).toThrow('Allowance rules require an allowance')
    expect(() => createPricingRule({ ...base, type: 'overage_rate' })).toThrow('Overage rules require a rate')
    expect(() => createPricingRule({ ...base, type: 'discount' })).toThrow('Discount rules require a discount percent')
    expect(() =>
      createPricingRule({
        ...base,
        type: 'discount',
        discountPercent: 10,
        effectiveFrom: '2026-10-01',
        effectiveTo: '2026-09-30',
      }),
    ).toThrow('Effective end date must be on or after effective start date')
  })
})
