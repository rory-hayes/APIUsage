import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyReportBuilderConfig, createReportBuilderConfig, JsonReportBuilderConfigStore } from './report-builder'
import { findingSchema, type Finding } from './schemas'

describe('audit report builder config', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-report-builder-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('filters selected findings and strips customer notes that were not selected for the final pack', () => {
    const includedWithNote = finding({
      id: 'finding_with_note',
      title: 'Selected finding with note',
      customerNote: 'Include this customer-facing note.',
    })
    const includedWithoutNote = finding({
      id: 'finding_without_note',
      title: 'Selected finding without note',
      customerNote: 'Do not include this note.',
    })
    const unselected = finding({
      id: 'finding_unselected',
      title: 'Unselected finding',
      customerNote: 'This note should not matter.',
    })
    const config = createReportBuilderConfig(
      {
        workspaceId: 'workspace_northstar_june_2026',
        selectedFindingIds: ['finding_with_note', 'finding_without_note'],
        noteFindingIds: ['finding_with_note'],
        updatedBy: 'internal_admin',
      },
      new Date('2026-06-03T09:30:00.000Z'),
    )

    const selected = applyReportBuilderConfig([includedWithNote, includedWithoutNote, unselected], config)

    expect(selected.map((item) => item.id)).toEqual(['finding_with_note', 'finding_without_note'])
    expect(selected[0].customerNote).toBe('Include this customer-facing note.')
    expect(selected[1].customerNote).toBeUndefined()
  })

  it('persists one report builder config per workspace', async () => {
    const store = new JsonReportBuilderConfigStore(join(tempDir, 'report-builder.json'))
    const first = createReportBuilderConfig({
      workspaceId: 'workspace_northstar_june_2026',
      selectedFindingIds: ['finding_001'],
      noteFindingIds: ['finding_001'],
      updatedBy: 'internal_admin',
    })
    const replacement = createReportBuilderConfig({
      workspaceId: 'workspace_northstar_june_2026',
      selectedFindingIds: ['finding_002'],
      noteFindingIds: [],
      updatedBy: 'internal_admin',
    })

    await store.save(first)
    await store.save(replacement)

    await expect(store.getByWorkspace('workspace_northstar_june_2026')).resolves.toMatchObject({
      selectedFindingIds: ['finding_002'],
      noteFindingIds: [],
    })
  })
})

function finding(overrides: Partial<Finding>): Finding {
  return findingSchema.parse({
    id: 'finding_001',
    organizationId: 'org_northstar',
    workspaceId: 'workspace_northstar_june_2026',
    category: 'usage_exists_no_invoice',
    severity: 'high',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 500000,
    actualAmount: 0,
    varianceAmount: 500000,
    currency: 'eur',
    confidence: 0.91,
    status: 'open',
    evidenceRefs: [{ type: 'usage_record', sourceId: 'usage_001' }],
    recommendedAction: 'Review billing configuration before the close.',
    customerNote: 'We found usage that may not have been included on your invoice.',
    metadata: {
      customerName: 'Northstar Customer',
    },
    ...overrides,
  })
}
