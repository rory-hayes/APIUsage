import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JsonAppBillingStore, appBillingRecordSchema, createAppBillingRecordFromFormData } from './app-billing'

describe('app Stripe billing records', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-app-billing-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates a Stripe-tracked billing record from admin form data', () => {
    const formData = new FormData()
    formData.set('organizationId', 'org_northstar')
    formData.set('organizationName', 'Northstar AI')
    formData.set('planId', 'monitoring')
    formData.set('stripeCustomerId', 'cus_123')
    formData.set('stripeInvoiceId', 'in_123')
    formData.set('stripeInvoiceStatus', 'open')
    formData.set('stripeHostedInvoiceUrl', 'https://invoice.stripe.com/i/acct_test/in_123')
    formData.set('stripeSubscriptionId', 'sub_123')
    formData.set('stripeSubscriptionStatus', 'active')
    formData.set('note', 'Monitoring retainer invoice sent in Stripe.')

    const record = createAppBillingRecordFromFormData(formData, 'internal_admin', new Date('2026-06-03T09:00:00.000Z'))

    expect(record).toMatchObject({
      id: 'app_billing_org_northstar',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      provider: 'stripe',
      planId: 'monitoring',
      stripeCustomerId: 'cus_123',
      stripeInvoiceId: 'in_123',
      stripeInvoiceStatus: 'open',
      stripeHostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_test/in_123',
      stripeSubscriptionId: 'sub_123',
      stripeSubscriptionStatus: 'active',
      billingStatus: 'active',
      note: 'Monitoring retainer invoice sent in Stripe.',
      updatedBy: 'internal_admin',
      updatedAt: '2026-06-03T09:00:00.000Z',
    })
  })

  it('validates Stripe billing records strictly and requires a Stripe tracking identifier', () => {
    expect(
      appBillingRecordSchema.safeParse({
        id: 'app_billing_org_northstar',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        provider: 'stripe',
        planId: 'monitoring',
        billingStatus: 'tracked',
        updatedBy: 'internal_admin',
        updatedAt: '2026-06-03T09:00:00.000Z',
      }).success,
    ).toBe(false)

    expect(
      appBillingRecordSchema.safeParse({
        id: 'app_billing_org_northstar',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        provider: 'stripe',
        planId: 'audit',
        stripeCustomerId: 'cus_123',
        billingStatus: 'tracked',
        updatedBy: 'internal_admin',
        updatedAt: '2026-06-03T09:00:00.000Z',
        unexpected: 'not allowed',
      }).success,
    ).toBe(false)
  })

  it('persists one billing record per organization', async () => {
    const store = new JsonAppBillingStore(join(tempDir, 'app-billing.json'))
    const first = appBillingRecordSchema.parse({
      id: 'app_billing_org_northstar',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      provider: 'stripe',
      planId: 'audit',
      stripeCustomerId: 'cus_123',
      stripeInvoiceId: 'in_123',
      stripeInvoiceStatus: 'open',
      billingStatus: 'invoiced',
      updatedBy: 'internal_admin',
      updatedAt: '2026-06-03T09:00:00.000Z',
    })
    const updated = appBillingRecordSchema.parse({
      ...first,
      planId: 'monitoring',
      stripeSubscriptionId: 'sub_123',
      stripeSubscriptionStatus: 'active',
      billingStatus: 'active',
      updatedAt: '2026-06-04T09:00:00.000Z',
    })

    await store.save(first)
    await store.save(updated)

    await expect(store.list()).resolves.toEqual([updated])
    await expect(store.getByOrganization('org_northstar')).resolves.toEqual(updated)
    await expect(store.getByOrganization('org_missing')).resolves.toBeNull()
  })
})
