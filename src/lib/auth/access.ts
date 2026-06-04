import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const SESSION_COOKIE_NAME = 'uri_session'
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60

export const userRoleSchema = z.enum(['customer_admin', 'customer_member', 'internal_admin'])

export type UserRole = z.infer<typeof userRoleSchema>

export const invitedUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  role: userRoleSchema,
  workspaceIds: z.array(z.string().min(1)).min(1),
})

export type InvitedUser = z.infer<typeof invitedUserSchema>

export const sessionSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string().min(1),
  role: userRoleSchema,
  workspaceIds: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().datetime(),
})

export type Session = z.infer<typeof sessionSchema>

export type AccessDecision =
  | {
      allowed: true
    }
  | {
      allowed: false
      reason: 'login_required' | 'internal_admin_required'
    }

export type LoginSessionResult =
  | {
      ok: true
      token: string
      session: Session
    }
  | {
      ok: false
      error: 'invalid_credentials'
    }

export const defaultInvitedUsers: InvitedUser[] = [
  {
    id: 'internal_admin',
    email: 'internal@usageintegrity.local',
    name: 'Rory',
    organizationId: 'org_internal',
    organizationName: 'Usage Revenue Integrity OS',
    role: 'internal_admin',
    workspaceIds: ['workspace_acme_may_2026'],
  },
  {
    id: 'user_customer_admin',
    email: 'customer@acme.ai',
    name: 'Acme Finance Admin',
    organizationId: 'org_acme',
    organizationName: 'Acme AI',
    role: 'customer_admin',
    workspaceIds: ['workspace_acme_may_2026'],
  },
  {
    id: 'user_customer_member',
    email: 'member@acme.ai',
    name: 'Acme Audit Member',
    organizationId: 'org_acme',
    organizationName: 'Acme AI',
    role: 'customer_member',
    workspaceIds: ['workspace_acme_may_2026'],
  },
].map((user) => invitedUserSchema.parse(user))

export function findInvitedUserByEmail(email: string, additionalInvitedUsers: InvitedUser[] = []): InvitedUser | null {
  const normalizedEmail = email.trim().toLowerCase()
  const invitedUsers = [...additionalInvitedUsers, ...defaultInvitedUsers]

  return invitedUsers.find((user) => user.email === normalizedEmail) ?? null
}

export function authenticateInvitedUser(
  email: string,
  password: string,
  localPassword = process.env.AUDIT_LOCAL_AUTH_PASSWORD ?? 'pilot',
  additionalInvitedUsers: InvitedUser[] = [],
) {
  const user = findInvitedUserByEmail(email, additionalInvitedUsers)

  if (!user || password !== localPassword) {
    return null
  }

  return user
}

export function createLoginSession(
  input: {
    email: string
    password: string
  },
  secret: string,
  now = new Date(),
  additionalInvitedUsers: InvitedUser[] = [],
): LoginSessionResult {
  const user = authenticateInvitedUser(input.email, input.password, process.env.AUDIT_LOCAL_AUTH_PASSWORD ?? 'pilot', additionalInvitedUsers)

  if (!user) {
    return {
      ok: false,
      error: 'invalid_credentials',
    }
  }

  const token = createSessionToken(user, secret, now)

  return {
    ok: true,
    token,
    session: verifySessionToken(token, secret, now),
  }
}

export function createSessionToken(
  user: InvitedUser,
  secret: string,
  now = new Date(),
  expiresInSeconds = DEFAULT_SESSION_TTL_SECONDS,
): string {
  return createSessionTokenFromSession(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      role: user.role,
      workspaceIds: user.workspaceIds,
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    },
    secret,
  )
}

export function createSessionTokenFromSession(
  session: Omit<Session, 'expiresAt'> & { expiresAt?: string },
  secret: string,
  now = new Date(),
  expiresInSeconds = DEFAULT_SESSION_TTL_SECONDS,
): string {
  const nextSession = sessionSchema.parse({
    ...session,
    expiresAt: session.expiresAt ?? new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
  })
  const encodedPayload = base64UrlEncode(JSON.stringify(nextSession))
  const signature = signSessionPayload(encodedPayload, secret)

  return `${encodedPayload}.${signature}`
}

export function verifySessionToken(token: string, secret: string, now = new Date()): Session {
  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    throw new Error('Malformed session token')
  }

  const expectedSignature = signSessionPayload(encodedPayload, secret)

  if (!safeEqual(signature, expectedSignature)) {
    throw new Error('Invalid session token signature')
  }

  const session = sessionSchema.parse(JSON.parse(base64UrlDecode(encodedPayload)))

  if (new Date(session.expiresAt).getTime() < now.getTime()) {
    throw new Error('Session has expired')
  }

  return session
}

export function readSessionFromCookieHeader(cookieHeader: string | null, secret: string, now = new Date()): Session | null {
  const token = readCookieValue(cookieHeader, SESSION_COOKIE_NAME)

  if (!token) {
    return null
  }

  try {
    return verifySessionToken(token, secret, now)
  } catch {
    return null
  }
}

export function canAccessPath(session: Session | null, pathname: string): AccessDecision {
  if (isPublicPath(pathname)) {
    return { allowed: true }
  }

  if (!session) {
    return { allowed: false, reason: 'login_required' }
  }

  if (pathname.startsWith('/admin') && session.role !== 'internal_admin') {
    return { allowed: false, reason: 'internal_admin_required' }
  }

  return { allowed: true }
}

export function canAccessWorkspace(session: Session | null, workspaceId: string): boolean {
  return Boolean(session?.workspaceIds.includes(workspaceId))
}

export function isInternalAdmin(session: Session | null): boolean {
  return session?.role === 'internal_admin'
}

export function getSessionSecret() {
  return process.env.AUDIT_SESSION_SECRET ?? 'local-development-session-secret'
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/logout')
  )
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null
  }

  const prefix = `${name}=`
  const cookie = cookieHeader
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))

  return cookie ? cookie.slice(prefix.length) : null
}

function signSessionPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)

  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false
  }

  return timingSafeEqual(leftBytes, rightBytes)
}
