import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAuditLogEvent, JsonAuditLogStore } from './audit-log'

describe('audit log', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-audit-log-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates a deterministic audit event with actor, action, target, and metadata', () => {
    const event = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'internal_admin',
        action: 'parse_run',
        targetType: 'upload',
        targetId: 'upl_001',
        metadata: {
          parser: 'usage_csv',
          recordCount: 12,
        },
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )

    expect(event).toEqual({
      id: 'audit_workspace_001_parse_run_upload_upl_001_2026_06_01T10_00_00_000Z',
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      action: 'parse_run',
      targetType: 'upload',
      targetId: 'upl_001',
      metadata: {
        parser: 'usage_csv',
        recordCount: 12,
      },
      createdAt: '2026-06-01T10:00:00.000Z',
    })
  })

  it('supports file download audit events', () => {
    const event = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'internal_admin',
        action: 'file_downloaded',
        targetType: 'upload',
        targetId: 'upl_001',
      },
      new Date('2026-06-01T10:30:00.000Z'),
    )

    expect(event.action).toBe('file_downloaded')
  })

  it('supports contract term extraction and review audit events', () => {
    const extracted = createAuditLogEvent({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      action: 'contract_terms_extracted',
      targetType: 'upload',
      targetId: 'upl_contract',
    })
    const reviewed = createAuditLogEvent({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      action: 'contract_term_reviewed',
      targetType: 'contract_term',
      targetId: 'term_001',
    })

    expect(extracted.action).toBe('contract_terms_extracted')
    expect(reviewed.targetType).toBe('contract_term')
  })

  it('supports account mapping audit events', () => {
    const event = createAuditLogEvent({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      action: 'account_mapping_saved',
      targetType: 'account_mapping',
      targetId: 'map_001',
    })

    expect(event.action).toBe('account_mapping_saved')
    expect(event.targetType).toBe('account_mapping')
  })

  it('supports workspace creation audit events', () => {
    const event = createAuditLogEvent({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      action: 'workspace_created',
      targetType: 'workspace',
      targetId: 'workspace_001',
    })

    expect(event.action).toBe('workspace_created')
    expect(event.targetType).toBe('workspace')
  })

  it('supports finding discussion audit events', () => {
    const event = createAuditLogEvent({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'user_customer',
      action: 'finding_commented',
      targetType: 'finding',
      targetId: 'finding_001',
      metadata: {
        bodyLength: 42,
        authorRole: 'customer_admin',
      },
    })

    expect(event.action).toBe('finding_commented')
    expect(event.targetType).toBe('finding')
  })

  it('supports invite creation audit events', () => {
    const event = createAuditLogEvent({
      organizationId: 'org_001',
      workspaceId: 'workspace_001',
      actorId: 'internal_admin',
      action: 'invite_created',
      targetType: 'workspace',
      targetId: 'workspace_001',
      metadata: {
        email: 'billing@example.com',
        role: 'customer_admin',
      },
    })

    expect(event.action).toBe('invite_created')
    expect(event.metadata.email).toBe('billing@example.com')
  })

  it('persists audit events and reloads them by workspace newest first', async () => {
    const store = new JsonAuditLogStore(join(tempDir, 'audit-log.json'))
    const older = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'user_customer',
        action: 'file_uploaded',
        targetType: 'upload',
        targetId: 'upl_001',
      },
      new Date('2026-06-01T09:00:00.000Z'),
    )
    const newer = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'internal_admin',
        action: 'finding_reviewed',
        targetType: 'finding',
        targetId: 'finding_001',
      },
      new Date('2026-06-01T11:00:00.000Z'),
    )
    const otherWorkspace = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_002',
        actorId: 'internal_admin',
        action: 'check_run',
        targetType: 'workspace',
        targetId: 'workspace_002',
      },
      new Date('2026-06-01T12:00:00.000Z'),
    )

    await store.append(older)
    await store.append(newer)
    await store.append(otherWorkspace)

    await expect(store.listByWorkspace('workspace_001')).resolves.toEqual([newer, older])
    await expect(store.listByWorkspace('workspace_002')).resolves.toEqual([otherWorkspace])
  })

  it('preserves repeated audit events even when their generated ids collide', async () => {
    const store = new JsonAuditLogStore(join(tempDir, 'audit-log.json'))
    const firstDownload = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'internal_admin',
        action: 'file_downloaded',
        targetType: 'upload',
        targetId: 'upl_001',
        metadata: {
          attempt: 1,
        },
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )
    const secondDownload = createAuditLogEvent(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        actorId: 'internal_admin',
        action: 'file_downloaded',
        targetType: 'upload',
        targetId: 'upl_001',
        metadata: {
          attempt: 2,
        },
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )

    await store.append(firstDownload)
    await store.append(secondDownload)

    const events = await store.listByWorkspace('workspace_001')

    expect(events).toHaveLength(2)
    expect(events.map((event) => event.metadata.attempt)).toEqual([1, 2])
    expect(new Set(events.map((event) => event.id)).size).toBe(2)
  })
})
