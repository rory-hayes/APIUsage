import { NextResponse } from 'next/server'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { getAuditLogStore, getInviteStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { DEFAULT_SESSION_TTL_SECONDS, getSessionSecret, SESSION_COOKIE_NAME, type Session } from '@/lib/auth/access'
import { auth0 } from '@/lib/auth/auth0-runtime'
import { createAuth0LoginSession } from '@/lib/auth/auth0-session'

export async function GET(request: Request) {
  const auth0Session = await auth0.getSession()

  if (!auth0Session) {
    return redirectToLogin(request, 'auth0')
  }

  const dynamicInvitedUsers = await getInviteStore().listActiveInvitedUsers()
  const result = createAuth0LoginSession(auth0Session.user, getSessionSecret(), new Date(), dynamicInvitedUsers)

  if (!result.ok) {
    return redirectToLogin(request, result.error)
  }

  await appendLoginAuditEvent(result.session)

  const response = NextResponse.redirect(new URL('/', request.url), { status: 303 })
  response.cookies.set(SESSION_COOKIE_NAME, result.token, {
    httpOnly: true,
    maxAge: DEFAULT_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return response
}

function redirectToLogin(request: Request, error: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url), { status: 303 })
}

async function appendLoginAuditEvent(session: Session): Promise<void> {
  const workspaceId = session.workspaceIds[0]

  if (!workspaceId) {
    return
  }

  const workspace = await getWorkspaceStore().getById(workspaceId)

  await getAuditLogStore().append(
    createAuditLogEvent({
      action: 'user_login',
      actorId: session.userId,
      organizationId: workspace?.organizationId ?? session.organizationId,
      targetId: workspaceId,
      targetType: 'workspace',
      workspaceId,
      metadata: {
        authProvider: 'auth0',
        email: session.email,
        role: session.role,
      },
    })
  )
}
