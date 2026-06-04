import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFindingComment, JsonFindingCommentStore } from './finding-comments'

describe('finding comments', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-finding-comments-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates a trimmed finding comment with author and finding scope', () => {
    const comment = createFindingComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        findingId: 'finding_001',
        body: '  Please confirm the invoice adjustment.  ',
        authorId: 'user_customer',
        authorName: 'Acme Finance',
        authorRole: 'customer_admin',
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )

    expect(comment).toMatchObject({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      findingId: 'finding_001',
      body: 'Please confirm the invoice adjustment.',
      authorId: 'user_customer',
      authorName: 'Acme Finance',
      authorRole: 'customer_admin',
      createdAt: '2026-06-01T10:00:00.000Z',
    })
    expect(comment.id).toMatch(/^fcomment_workspace_001_finding_001_2026_06_01T10_00_00_000Z_[a-f0-9]{12}$/)
  })

  it('persists comments oldest first and filters by workspace and finding', async () => {
    const store = new JsonFindingCommentStore(join(tempDir, 'finding-comments.json'))
    const older = createFindingComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        findingId: 'finding_001',
        body: 'Customer context.',
        authorId: 'user_customer',
        authorName: 'Acme Finance',
        authorRole: 'customer_admin',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const newer = createFindingComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        findingId: 'finding_001',
        body: 'Internal follow-up.',
        authorId: 'internal_admin',
        authorName: 'Rory',
        authorRole: 'internal_admin',
      },
      new Date('2026-06-01T11:00:00.000Z'),
    )
    const otherFinding = createFindingComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        findingId: 'finding_002',
        body: 'Different issue.',
        authorId: 'internal_admin',
        authorName: 'Rory',
        authorRole: 'internal_admin',
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )
    const otherWorkspace = createFindingComment(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        findingId: 'finding_003',
        body: 'Preserve this workspace.',
        authorId: 'user_other',
        authorName: 'Other Finance',
        authorRole: 'customer_admin',
      },
      new Date('2026-06-01T12:00:00.000Z'),
    )

    await store.save(newer)
    await store.save(otherFinding)
    await store.save(older)
    await store.save(otherWorkspace)

    await expect(store.listByFinding('workspace_001', 'finding_001')).resolves.toEqual([older, newer])
    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([older, otherFinding, newer])
    await expect(store.deleteByWorkspace('workspace_001')).resolves.toBe(3)
    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([])
    await expect(store.listByWorkspace('workspace_002')).resolves.toEqual([otherWorkspace])
  })
})
