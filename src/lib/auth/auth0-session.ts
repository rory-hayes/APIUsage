import {
  createSessionTokenFromSession,
  findInvitedUserByEmail,
  verifySessionToken,
  type InvitedUser,
  type Session,
} from './access'

export type Auth0UserProfile = {
  email?: string | null
  email_verified?: boolean
  name?: string | null
  sub?: string | null
}

export function isAuth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET &&
    process.env.AUTH0_SECRET
  )
}

export type Auth0LoginSessionResult =
  | {
      ok: true
      token: string
      session: Session
    }
  | {
      ok: false
      error: 'missing_email' | 'email_unverified' | 'not_invited'
    }

export function createAuth0LoginSession(
  profile: Auth0UserProfile,
  secret: string,
  now = new Date(),
  additionalInvitedUsers: InvitedUser[] = []
): Auth0LoginSessionResult {
  if (profile.email_verified === false) {
    return {
      ok: false,
      error: 'email_unverified',
    }
  }

  const email = profile.email?.trim().toLowerCase()

  if (!email) {
    return {
      ok: false,
      error: 'missing_email',
    }
  }

  const invitedUser = findInvitedUserByEmail(email, additionalInvitedUsers)

  if (!invitedUser) {
    return {
      ok: false,
      error: 'not_invited',
    }
  }

  const token = createSessionTokenFromSession(
    {
      userId: invitedUser.id,
      email: invitedUser.email,
      name: profile.name?.trim() || invitedUser.name,
      organizationId: invitedUser.organizationId,
      organizationName: invitedUser.organizationName,
      role: invitedUser.role,
      workspaceIds: invitedUser.workspaceIds,
    },
    secret,
    now
  )

  return {
    ok: true,
    token,
    session: verifySessionToken(token, secret, now),
  }
}
