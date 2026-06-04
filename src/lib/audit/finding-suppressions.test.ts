import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findingSchema, type Finding } from './schemas'
import { JsonFindingSuppressionStore, applyFindingSuppressions, createFindingSuppressionFromRejectedFinding } from './finding-suppressions'

describe('finding suppressions', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-finding-suppressions-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('persists a rejected-finding suppression and filters matching future findings', async () => {
    const store = new JsonFindingSuppressionStore(join(tempDir, 'finding-suppressions.json'))
    const rejected = finding({
      id: 'finding_rejected_manual_invoice',
      category: 'usage_exists_no_invoice',
      customerId: 'cus_northstar',
      metadata: {
        accountKey: 'acct_northstar',
        meter: 'llm_tokens',
        customerName: 'Northstar AI',
      },
    })
    const suppression = createFindingSuppressionFromRejectedFinding(rejected, {
      createdBy: 'internal_admin',
      reason: 'False positive: manually invoiced enterprise usage.',
      createdAt: new Date('2026-06-03T09:00:00.000Z'),
    })

    await store.save(suppression)

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([suppression])
    expect(
      applyFindingSuppressions(
        [
          finding({
            id: 'finding_future_same',
            category: 'usage_exists_no_invoice',
            metadata: { customerName: 'Northstar AI' },
          }),
        ],
        [suppression],
      ),
    ).toEqual([])
    expect(applyFindingSuppressions([finding({ id: 'finding_future_other_meter', category: 'usage_exists_no_invoice', metadata: { meter: 'api_calls' } })], [suppression])).toHaveLength(1)
    expect(applyFindingSuppressions([finding({ id: 'finding_future_other_category', category: 'wrong_overage_rate' })], [suppression])).toHaveLength(1)
  })
})

function finding(input: {
  id: string
  category: Finding['category']
  customerId?: string
  metadata?: Record<string, unknown>
}): Finding {
  return findingSchema.parse({
    id: input.id,
    organizationId: 'org_001',
    workspaceId: 'workspace_001',
    customerId: input.customerId ?? 'cus_northstar',
    category: input.category,
    severity: 'medium',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 0,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.72,
    status: 'draft',
    evidenceRefs: [{ type: 'usage_record', sourceId: `${input.id}_usage` }],
    recommendedAction: 'Review the customer invoice.',
    metadata: {
      accountKey: 'acct_northstar',
      meter: 'llm_tokens',
      ...input.metadata,
    },
  })
}
