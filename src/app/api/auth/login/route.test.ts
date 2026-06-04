import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_ORGANIZATION_ID, DEFAULT_WORKSPACE_ID, getAuditLogStore } from '@/lib/audit/upload-runtime'
import { SESSION_COOKIE_NAME } from '@/lib/auth/access'

import { POST } from './route'

const ORIGINAL_ENV = {
  AUDIT_INVITE_PATH: process.env.AUDIT_INVITE_PATH,
  AUDIT_LOG_PATH: process.env.AUDIT_LOG_PATH,
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('login route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-login-route-'))
    process.env.AUDIT_INVITE_PATH = join(tempDir, 'invites.json')
    process.env.AUDIT_LOG_PATH = join(tempDir, 'audit-log.json')
    process.env.AUDIT_SESSION_SECRET = 'login-route-session-secret'
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('sets a session cookie and redirects invited users into the app', async () => {
    const formData = new FormData()
    formData.set('email', 'customer@acme.ai')
    formData.set('password', 'pilot')

    const response = await POST(new Request('http://localhost/api/auth/login', { body: formData, method: 'POST' }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/')
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
          email: 'customer@acme.ai',
          role: 'customer_admin',
        },
      },
    ])
  })

  it('redirects invalid credentials back to login without a session cookie', async () => {
    const formData = new FormData()
    formData.set('email', 'stranger@example.com')
    formData.set('password', 'pilot')

    const response = await POST(new Request('http://localhost/api/auth/login', { body: formData, method: 'POST' }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/login?error=invalid')
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
