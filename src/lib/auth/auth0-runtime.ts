import { Auth0Client } from '@auth0/nextjs-auth0/server'
import { NextResponse } from 'next/server'

import { isAuth0Configured } from './auth0-session'

let auth0Client: Auth0Client | null = null

export const auth0 = {
  async getSession() {
    if (!isAuth0Configured()) {
      return null
    }

    return getAuth0Client().getSession()
  },
  async middleware(request: Request) {
    if (!isAuth0Configured()) {
      return NextResponse.next()
    }

    return getAuth0Client().middleware(request)
  },
}

function getAuth0Client() {
  auth0Client ??= new Auth0Client({
    authorizationParameters: {
      scope: 'openid profile email',
    },
    enableAccessTokenEndpoint: false,
    signInReturnToPath: '/auth/post-login',
  })

  return auth0Client
}
