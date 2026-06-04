import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { getAuditLogStore, getInviteStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import {
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  type Session,
  createLoginSession,
  getSessionSecret,
} from '@/lib/auth/access'

const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(request: Request) {
  const formData = await request.formData()
  const input = loginInputSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!input.success) {
    return invalidCredentialsResponse(request)
  }

  const dynamicInvitedUsers = await getInviteStore().listActiveInvitedUsers()
  const result = createLoginSession(input.data, getSessionSecret(), new Date(), dynamicInvitedUsers)

  if (!result.ok) {
    return invalidCredentialsResponse(request)
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

function invalidCredentialsResponse(request: Request) {
  return NextResponse.redirect(new URL('/login?error=invalid', request.url), { status: 303 })
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
        email: session.email,
        role: session.role,
      },
    }),
  )
}
