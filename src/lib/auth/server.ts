import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  DEFAULT_SESSION_TTL_SECONDS,
  getSessionSecret,
  isInternalAdmin,
  SESSION_COOKIE_NAME,
  type Session,
  verifySessionToken,
} from './access'

export async function getCurrentSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!token) {
    return null
  }

  try {
    return verifySessionToken(token, getSessionSecret())
  } catch {
    return null
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getCurrentSession()

  if (!session) {
    redirect('/login')
  }

  return session
}

export async function requireInternalAdmin(): Promise<Session> {
  const session = await requireSession()

  if (!isInternalAdmin(session)) {
    redirect('/')
  }

  return session
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: DEFAULT_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()

  cookieStore.delete(SESSION_COOKIE_NAME)
}
