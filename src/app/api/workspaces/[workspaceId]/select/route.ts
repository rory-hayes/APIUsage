import { NextResponse } from 'next/server'

import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import {
  DEFAULT_SESSION_TTL_SECONDS,
  createSessionTokenFromSession,
  getSessionSecret,
  readSessionFromCookieHeader,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/access'

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params
  const secret = getSessionSecret()
  const session = readSessionFromCookieHeader(request.headers.get('cookie'), secret)

  if (!session) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 })
  }

  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (session.role !== 'internal_admin' && !session.workspaceIds.includes(workspace.id)) {
    return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
  }

  const workspaceIds = [workspace.id, ...session.workspaceIds.filter((id) => id !== workspace.id)]
  const token = createSessionTokenFromSession({ ...session, workspaceIds }, secret)
  const response = NextResponse.redirect(new URL(safeNextPath(request), request.url), { status: 303 })

  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: DEFAULT_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })

  return response
}

function safeNextPath(request: Request) {
  const next = new URL(request.url).searchParams.get('next')

  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return '/'
  }

  return next
}
