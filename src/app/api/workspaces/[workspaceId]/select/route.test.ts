import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_WORKSPACE_ID, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { createAuditWorkspace } from '@/lib/audit/workspaces'
import { createSessionToken, findInvitedUserByEmail, SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/access'

import { GET } from './route'

const ORIGINAL_ENV = {
  AUDIT_SESSION_SECRET: process.env.AUDIT_SESSION_SECRET,
  AUDIT_WORKSPACE_PATH: process.env.AUDIT_WORKSPACE_PATH,
}

describe('workspace selection route', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-workspace-select-route-'))
    process.env.AUDIT_SESSION_SECRET = 'workspace-select-session-secret'
    process.env.AUDIT_WORKSPACE_PATH = join(tempDir, 'workspaces.json')
  })

  afterEach(async () => {
    restoreEnv()
    await rm(tempDir, { force: true, recursive: true })
  })

  it('pins a selected workspace for internal admins and redirects back to the app', async () => {
    const northstar = await saveNorthstarWorkspace()

    const response = await GET(selectRequest(sessionCookie('internal@usageintegrity.local'), northstar.id, '/admin'), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/admin')
    const selectedSession = verifySessionToken(readSessionCookie(response), process.env.AUDIT_SESSION_SECRET!)
    expect(selectedSession).toMatchObject({
      userId: 'internal_admin',
      role: 'internal_admin',
      workspaceIds: [northstar.id, DEFAULT_WORKSPACE_ID],
    })
  })

  it('blocks customer users from selecting workspaces outside their session', async () => {
    const northstar = await saveNorthstarWorkspace()

    const response = await GET(selectRequest(sessionCookie('customer@acme.ai'), northstar.id, '/'), {
      params: Promise.resolve({ workspaceId: northstar.id }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workspace access denied' })
  })

  it('does not redirect to external next URLs', async () => {
    const response = await GET(selectRequest(sessionCookie('internal@usageintegrity.local'), DEFAULT_WORKSPACE_ID, 'https://evil.example'), {
      params: Promise.resolve({ workspaceId: DEFAULT_WORKSPACE_ID }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })
})

async function saveNorthstarWorkspace() {
  const workspace = createAuditWorkspace(
    {
      id: 'workspace_northstar_june_2026',
      organizationId: 'org_northstar',
      organizationName: 'Northstar AI',
      name: 'June 2026 audit',
      auditPeriod: 'June 2026',
      billingSystem: 'Stripe',
      usageSource: 'Warehouse CSV',
      status: 'review',
      createdBy: 'internal_admin',
    },
    new Date('2026-06-02T09:00:00.000Z'),
  )
  await getWorkspaceStore().save(workspace)

  return workspace
}

function selectRequest(cookie: string, workspaceId: string, next: string) {
  return new Request(`http://localhost/api/workspaces/${workspaceId}/select?next=${encodeURIComponent(next)}`, {
    headers: { Cookie: cookie },
    method: 'GET',
  })
}

function sessionCookie(email: string) {
  const user = findInvitedUserByEmail(email)

  if (!user) {
    throw new Error(`Missing invited user fixture: ${email}`)
  }

  return `${SESSION_COOKIE_NAME}=${createSessionToken(user, process.env.AUDIT_SESSION_SECRET!)}`
}

function readSessionCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie')
  const token = setCookie?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))?.[1]

  if (!token) {
    throw new Error(`Missing ${SESSION_COOKIE_NAME} set-cookie header`)
  }

  return token
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
