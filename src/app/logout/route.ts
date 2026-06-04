import { NextResponse } from 'next/server'

import { SESSION_COOKIE_NAME } from '@/lib/auth/access'

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/auth/logout?returnTo=%2F', request.url))

  response.cookies.delete(SESSION_COOKIE_NAME)

  return response
}
