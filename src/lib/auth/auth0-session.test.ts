import { describe, expect, it } from 'vitest'

import { verifySessionToken } from './access'
import { createAuth0LoginSession } from './auth0-session'
import { createWorkspaceInvite, toInvitedUser } from './invites'

describe('Auth0 session bridge', () => {
  it('creates an app session for an invited Auth0 user', () => {
    const invite = createWorkspaceInvite({
      email: 'billing@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceId: 'workspace_northstar_june_2026',
      invitedBy: 'internal_admin',
    })

    const result = createAuth0LoginSession(
      {
        email: 'BILLING@Northstar.ai',
        email_verified: true,
        name: 'Billing Lead',
        sub: 'auth0|northstar-billing',
      },
      'session-secret',
      new Date('2026-06-04T10:00:00.000Z'),
      [toInvitedUser(invite)]
    )

    expect(result).toMatchObject({
      ok: true,
      session: {
        email: 'billing@northstar.ai',
        name: 'Billing Lead',
        organizationId: 'org_northstar',
        role: 'customer_admin',
        workspaceIds: ['workspace_northstar_june_2026'],
      },
    })
    expect(
      result.ok && verifySessionToken(result.token, 'session-secret', new Date('2026-06-04T10:05:00.000Z'))
    ).toMatchObject({
      userId: 'user_billing_northstar_ai',
      email: 'billing@northstar.ai',
    })
  })

  it('rejects Auth0 users that are not invited or have explicitly unverified email', () => {
    expect(
      createAuth0LoginSession(
        {
          email: 'stranger@example.com',
          email_verified: true,
          name: 'Stranger',
          sub: 'auth0|stranger',
        },
        'session-secret'
      )
    ).toEqual({
      ok: false,
      error: 'not_invited',
    })

    expect(
      createAuth0LoginSession(
        {
          email: 'customer@acme.ai',
          email_verified: false,
          name: 'Acme Finance Admin',
          sub: 'auth0|acme',
        },
        'session-secret'
      )
    ).toEqual({
      ok: false,
      error: 'email_unverified',
    })
  })
})
