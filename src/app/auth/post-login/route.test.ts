import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ORGANIZATION_ID, DEFAULT_WORKSPACE_ID, getAuditLogStore } from '@/lib/audit/upload-runtime'
import { SESSION_COOKIE_NAME } from '@/lib/auth/access'

const { getAuth0Session } = vi.hoisted(() => ({
  getAuth0Session: vi.fn(),
}))

vi.mock('@/lib/auth/auth0-runtime', () => ({
  auth0: {
    getSession: getAuth0Session,
  },
}))

import { GET } from './route'

const ORIGINAL_ENV = {
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('Auth0 post-login route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-auth0-post-login-'))
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_SESSION_SECRET = 'auth0-post-login-session-secret'
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
    getAuth0Session.mockReset()
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('sets the app session after Auth0 authenticates an invited user', async () => {
    getAuth0Session.mockResolvedValue({
      user: {
        email: 'customer@acme.ai',
        email_verified: true,
        name: 'Acme Auth0 Admin',
        sub: 'auth0|acme-admin',
      },
    })

    const response = await GET(new Request('https://api-usage-mu.vercel.app/auth/post-login'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://api-usage-mu.vercel.app/')
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toMatchObject([
      {
        action: 'user_login',
        actorId: 'user_customer_admin',
        organizationId: DEFAULT_ORGANIZATION_ID,
        targetId: DEFAULT_WORKSPACE_ID,
        targetType: 'workspace',
        workspaceId: DEFAULT_WORKSPACE_ID,
        metadata: {
          authProvider: 'auth0',
          email: 'customer@acme.ai',
          role: 'customer_admin',
        },
      },
    ])
  })

  it('redirects Auth0 users without app access back to login', async () => {
    getAuth0Session.mockResolvedValue({
      user: {
        email: 'stranger@example.com',
        email_verified: true,
        name: 'No Invite',
        sub: 'auth0|no-invite',
      },
    })

    const response = await GET(new Request('https://api-usage-mu.vercel.app/auth/post-login'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://api-usage-mu.vercel.app/login?error=not_invited')
    expect(response.headers.get('set-cookie')).toBeNull()
    await expect(getAuditLogStore().listByWorkspace(DEFAULT_WORKSPACE_ID)).resolves.toEqual([])
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
