import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createWorkspaceInvite, JsonInviteStore, toInvitedUser } from './invites'

describe('workspace invites', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-invites-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('creates an active invited customer user for a specific workspace', () => {
    const invite = createWorkspaceInvite(
      {
        email: ' Billing@Northstar.ai ',
        name: 'Northstar Finance',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        role: 'customer_admin',
        workspaceId: 'workspace_northstar_june_2026',
        invitedBy: 'internal_admin',
      },
      new Date('2026-06-02T11:00:00.000Z'),
    )

    expect(invite).toEqual({
      id: 'user_billing_northstar_ai',
      email: 'billing@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
      status: 'active',
      invitedBy: 'internal_admin',
      invitedAt: '2026-06-02T11:00:00.000Z',
    })
    expect(toInvitedUser(invite)).toMatchObject({
      email: 'billing@northstar.ai',
      role: 'customer_admin',
      workspaceIds: ['workspace_northstar_june_2026'],
    })
  })

  it('does not allow dynamic invites to grant internal admin access', () => {
    expect(() =>
      createWorkspaceInvite({
        email: 'attacker@example.com',
        name: 'Escalation Attempt',
        organizationId: 'org_customer',
        organizationName: 'Customer Ltd',
        role: 'internal_admin' as never,
        workspaceId: 'workspace_customer_june_2026',
        invitedBy: 'internal_admin',
      }),
    ).toThrow()
  })

  it('persists invites and exposes active invited users by workspace', async () => {
    const store = new JsonInviteStore(join(tempDir, 'invites.json'))
    const activeInvite = createWorkspaceInvite(
      {
        email: 'billing@northstar.ai',
        name: 'Northstar Finance',
        organizationId: 'org_northstar',
        organizationName: 'Northstar AI',
        role: 'customer_admin',
        workspaceId: 'workspace_northstar_june_2026',
        invitedBy: 'internal_admin',
      },
      new Date('2026-06-02T11:00:00.000Z'),
    )
    const revokedInvite = {
      ...createWorkspaceInvite(
        {
          email: 'old@northstar.ai',
          name: 'Old Northstar User',
          organizationId: 'org_northstar',
          organizationName: 'Northstar AI',
          role: 'customer_member',
          workspaceId: 'workspace_northstar_june_2026',
          invitedBy: 'internal_admin',
        },
        new Date('2026-06-02T10:00:00.000Z'),
      ),
      status: 'revoked' as const,
    }

    await store.save(activeInvite)
    await store.save(revokedInvite)

    await expect(store.listByWorkspace('workspace_northstar_june_2026')).resolves.toEqual([activeInvite, revokedInvite])
    await expect(store.listActiveInvitedUsers()).resolves.toEqual([toInvitedUser(activeInvite)])
  })
})
