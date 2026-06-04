import { afterEach, describe, expect, it } from 'vitest'

import { verifySessionToken } from './access'
import { createAuth0LoginSession } from './auth0-session'
import { createWorkspaceInvite, toInvitedUser } from './invites'

const ORIGINAL_ENV = {
  AUTH0_UNVERIFIED_EMAIL_ALLOWLIST: process.env.AUTH0_UNVERIFIED_EMAIL_ALLOWLIST,
}

describe('Auth0 session bridge', () => {
  afterEach(() => {
    restoreEnv()
  })

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

  it('allows explicitly allowlisted unverified Auth0 emails for live test users', () => {
    process.env.AUTH0_UNVERIFIED_EMAIL_ALLOWLIST = 'customer+e2e@acme.ai'

    const invite = createWorkspaceInvite({
      email: 'customer+e2e@acme.ai',
      name: 'Live Test User',
      organizationId: 'org_acme',
      organizationName: 'Acme AI',
      role: 'customer_admin',
      workspaceId: 'workspace_acme_may_2026',
      invitedBy: 'internal_admin',
    })

    const result = createAuth0LoginSession(
      {
        email: 'CUSTOMER+E2E@acme.ai',
        email_verified: false,
        name: 'Live Test User',
        sub: 'auth0|live-test-user',
      },
      'session-secret',
      new Date('2026-06-04T10:30:00.000Z'),
      [toInvitedUser(invite)]
    )

    expect(result).toMatchObject({
      ok: true,
      session: {
        email: 'customer+e2e@acme.ai',
        role: 'customer_admin',
      },
    })
  })
})

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
