import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDataDictionaryEntry, JsonDataDictionaryStore } from './data-dictionary'

describe('data dictionary', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-data-dictionary-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates a workspace-scoped field meaning entry with reviewer metadata', () => {
    const entry = createDataDictionaryEntry(
      {
        organizationId: 'org_northstar',
        workspaceId: 'workspace_northstar_june_2026',
        sourceCategory: 'usage_csv',
        sourceField: ' meter_name ',
        normalizedField: 'meter',
        dataType: 'string',
        meaning: 'Customer-specific usage meter from the warehouse export.',
        exampleValue: 'llm_tokens',
        notes: 'Finance confirms this maps to billable API usage.',
        createdBy: 'internal_admin',
      },
      new Date('2026-06-03T09:00:00.000Z'),
    )

    expect(entry).toMatchObject({
      id: 'dict_workspace_northstar_june_2026_usage_csv_meter_name',
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      sourceCategory: 'usage_csv',
      sourceField: 'meter_name',
      normalizedField: 'meter',
      dataType: 'string',
      meaning: 'Customer-specific usage meter from the warehouse export.',
      exampleValue: 'llm_tokens',
      notes: 'Finance confirms this maps to billable API usage.',
      createdBy: 'internal_admin',
      updatedBy: 'internal_admin',
      createdAt: '2026-06-03T09:00:00.000Z',
      updatedAt: '2026-06-03T09:00:00.000Z',
    })
  })

  it('persists and filters entries by workspace', async () => {
    const store = new JsonDataDictionaryStore(join(tempDir, 'data-dictionary.json'))
    const northstarEntry = createDataDictionaryEntry({
      organizationId: 'org_northstar',
      workspaceId: 'workspace_northstar_june_2026',
      sourceCategory: 'usage_csv',
      sourceField: 'meter_name',
      meaning: 'Northstar meter name.',
      createdBy: 'internal_admin',
    })
    const acmeEntry = createDataDictionaryEntry({
      organizationId: 'org_acme',
      workspaceId: 'workspace_acme_may_2026',
      sourceCategory: 'stripe_invoices_export',
      sourceField: 'amount_due',
      meaning: 'Acme invoice amount due.',
      createdBy: 'internal_admin',
    })

    await store.saveMany([northstarEntry, acmeEntry])

    await expect(store.listByWorkspace('workspace_northstar_june_2026')).resolves.toEqual([northstarEntry])
  })
})
