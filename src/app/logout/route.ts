import { NextResponse } from 'next/server'

import { SESSION_COOKIE_NAME } from '@/lib/auth/access'

export async function GET(request: Request) {
  const returnTo = new URL('/', request.url).toString()
  const logoutUrl = new URL('/auth/logout', request.url)
  logoutUrl.searchParams.set('returnTo', returnTo)

  const response = NextResponse.redirect(logoutUrl)

  response.cookies.delete(SESSION_COOKIE_NAME)

  return response
}
