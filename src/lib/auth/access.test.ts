import { describe, expect, it } from 'vitest'

import {
  authenticateInvitedUser,
  canAccessPath,
  canAccessWorkspace,
  createLoginSession,
  createSessionToken,
  findInvitedUserByEmail,
  readSessionFromCookieHeader,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from './access'
import { createWorkspaceInvite, toInvitedUser } from './invites'

describe('auth access control', () => {
  it('authenticates only invited users with the local V0 password', () => {
    expect(findInvitedUserByEmail('customer@acme.ai')).toMatchObject({
      id: 'user_customer_admin',
      role: 'customer_admin',
      organizationId: 'org_acme',
      workspaceIds: ['workspace_acme_may_2026'],
    })

    expect(authenticateInvitedUser('customer@acme.ai', 'pilot')).toMatchObject({
      email: 'customer@acme.ai',
      role: 'customer_admin',
    })
    expect(authenticateInvitedUser('stranger@example.com', 'pilot')).toBeNull()
    expect(authenticateInvitedUser('customer@acme.ai', 'wrong')).toBeNull()
  })

  it('creates signed expiring session tokens and rejects expired or tampered tokens', () => {
    const user = findInvitedUserByEmail('internal@usageintegrity.local')
    expect(user).not.toBeNull()

    const token = createSessionToken(user!, 'session-secret', new Date('2026-06-01T10:00:00.000Z'))
    const session = verifySessionToken(token, 'session-secret', new Date('2026-06-01T10:59:59.000Z'))

    expect(session).toMatchObject({
      userId: 'internal_admin',
      email: 'internal@usageintegrity.local',
      role: 'internal_admin',
      organizationId: 'org_internal',
      workspaceIds: ['workspace_acme_may_2026'],
      expiresAt: '2026-06-01T11:00:00.000Z',
    })
    expect(() => verifySessionToken(token, 'session-secret', new Date('2026-06-01T11:00:01.000Z'))).toThrow(
      'Session has expired',
    )

    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
    expect(() => verifySessionToken(tampered, 'session-secret', new Date('2026-06-01T10:30:00.000Z'))).toThrow(
      'Invalid session token signature',
    )
  })

  it('allows internal admins into admin routes and blocks customer users from admin routes', () => {
    const internal = verifySessionToken(
      createSessionToken(findInvitedUserByEmail('internal@usageintegrity.local')!, 'session-secret'),
      'session-secret',
    )
    const customer = verifySessionToken(createSessionToken(findInvitedUserByEmail('customer@acme.ai')!, 'session-secret'), 'session-secret')

    expect(canAccessPath(internal, '/admin')).toEqual({ allowed: true })
    expect(canAccessPath(customer, '/admin')).toEqual({ allowed: false, reason: 'internal_admin_required' })
    expect(canAccessPath(null, '/uploads')).toEqual({ allowed: false, reason: 'login_required' })
  })

  it('restricts workspace access to memberships on the session', () => {
    const customer = verifySessionToken(createSessionToken(findInvitedUserByEmail('customer@acme.ai')!, 'session-secret'), 'session-secret')

    expect(canAccessWorkspace(customer, 'workspace_acme_may_2026')).toBe(true)
    expect(canAccessWorkspace(customer, 'workspace_other_tenant')).toBe(false)
  })

  it('creates login sessions for invited credentials and rejects invalid attempts', () => {
    const result = createLoginSession(
      {
        email: 'customer@acme.ai',
        password: 'pilot',
      },
      'session-secret',
      new Date('2026-06-01T10:00:00.000Z'),
    )

    expect(result).toMatchObject({
      ok: true,
      session: {
        userId: 'user_customer_admin',
        role: 'customer_admin',
      },
    })
    expect(result.ok && verifySessionToken(result.token, 'session-secret', new Date('2026-06-01T10:05:00.000Z'))).toMatchObject({
      userId: 'user_customer_admin',
    })
    expect(createLoginSession({ email: 'stranger@example.com', password: 'pilot' }, 'session-secret')).toEqual({
      ok: false,
      error: 'invalid_credentials',
    })
  })

  it('authenticates dynamically invited customer users without opening public signup', () => {
    const invite = createWorkspaceInvite({
      email: 'billing@northstar.ai',
      name: 'Northstar Finance',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      role: 'customer_admin',
      workspaceId: 'workspace_northstar_june_2026',
      invitedBy: 'internal_admin',
    })
    const dynamicInvitedUsers = [toInvitedUser(invite)]

    expect(findInvitedUserByEmail('BILLING@NORTHSTAR.AI', dynamicInvitedUsers)).toMatchObject({
      email: 'billing@northstar.ai',
      workspaceIds: ['workspace_northstar_june_2026'],
    })
    expect(authenticateInvitedUser('billing@northstar.ai', 'pilot', 'pilot', dynamicInvitedUsers)).toMatchObject({
      role: 'customer_admin',
      organizationId: 'org_northstar',
    })
    expect(createLoginSession({ email: 'billing@northstar.ai', password: 'pilot' }, 'session-secret', undefined, dynamicInvitedUsers)).toMatchObject({
      ok: true,
      session: {
        userId: 'user_billing_northstar_ai',
        workspaceIds: ['workspace_northstar_june_2026'],
      },
    })
    expect(createLoginSession({ email: 'not-invited@northstar.ai', password: 'pilot' }, 'session-secret', undefined, dynamicInvitedUsers)).toEqual({
      ok: false,
      error: 'invalid_credentials',
    })
  })

  it('reads a session from a cookie header and ignores missing, expired, or tampered cookies', () => {
    const user = findInvitedUserByEmail('customer@acme.ai')
    expect(user).not.toBeNull()
    const token = createSessionToken(user!, 'session-secret', new Date('2026-06-01T10:00:00.000Z'), 300)
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`

    expect(
      readSessionFromCookieHeader(`theme=light; ${SESSION_COOKIE_NAME}=${token}; other=value`, 'session-secret', new Date('2026-06-01T10:04:00.000Z')),
    ).toMatchObject({
      userId: 'user_customer_admin',
      role: 'customer_admin',
    })
    expect(readSessionFromCookieHeader(null, 'session-secret')).toBeNull()
    expect(readSessionFromCookieHeader(`theme=light`, 'session-secret')).toBeNull()
    expect(readSessionFromCookieHeader(`${SESSION_COOKIE_NAME}=${tampered}`, 'session-secret')).toBeNull()
    expect(readSessionFromCookieHeader(`${SESSION_COOKIE_NAME}=${token}`, 'session-secret', new Date('2026-06-01T10:06:00.000Z'))).toBeNull()
  })
})
