import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createPilotConversionRecord, JsonPilotConversionStore } from './pilot-conversions'

describe('pilot conversion tracking', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-pilot-conversions-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates a customer-level conversion record with commercial amounts and renewal date', () => {
    const record = createPilotConversionRecord(
      {
        organizationId: ' org_northstar ',
        organizationName: ' Northstar AI ',
        auditFeeAmount: 1250000,
        monitoringOfferAmount: 300000,
        conversionStatus: 'converted',
        renewalDate: '2026-12-31',
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T09:15:00.000Z'),
    )

    expect(record).toEqual({
      id: 'pilot_conversion_org_northstar',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      currency: 'eur',
      auditFeeAmount: 1250000,
      monitoringOfferAmount: 300000,
      conversionStatus: 'converted',
      renewalDate: '2026-12-31',
      updatedBy: 'internal_admin',
      updatedAt: '2026-06-03T09:15:00.000Z',
      metadata: {},
    })
  })

  it('upserts conversion records by organization and lists customers alphabetically', async () => {
    const store = new JsonPilotConversionStore(join(tempDir, 'pilot-conversions.json'))
    const northstar = createPilotConversionRecord(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        auditFeeAmount: 1250000,
        monitoringOfferAmount: 300000,
        conversionStatus: 'offered',
        renewalDate: '2026-12-31',
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T09:15:00.000Z'),
    )
    const acme = createPilotConversionRecord(
      {
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        auditFeeAmount: 950000,
        monitoringOfferAmount: 250000,
        conversionStatus: 'declined',
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T09:20:00.000Z'),
    )
    const convertedNorthstar = createPilotConversionRecord(
      {
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        auditFeeAmount: 1250000,
        monitoringOfferAmount: 350000,
        conversionStatus: 'converted',
        renewalDate: '2027-01-31',
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T09:25:00.000Z'),
    )

    await store.save(northstar)
    await store.save(acme)
    await store.save(convertedNorthstar)

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        organizationId: 'org_acme',
        organizationName: 'Acme AI',
        conversionStatus: 'declined',
      }),
      expect.objectContaining({
        organizationId: 'org_northstar',
        monitoringOfferAmount: 350000,
        conversionStatus: 'converted',
        renewalDate: '2027-01-31',
      }),
    ])
    await expect(store.getByOrganization('org_northstar')).resolves.toMatchObject({
      organizationId: 'org_northstar',
      monitoringOfferAmount: 350000,
      conversionStatus: 'converted',
    })
  })
})
