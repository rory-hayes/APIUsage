import { describe, expect, it } from 'vitest'

import { SESSION_COOKIE_NAME } from '@/lib/auth/access'

import { GET } from './route'

describe('logout route', () => {
  it('clears the app session and continues through Auth0 logout', async () => {
    const response = await GET(new Request('https://api-usage-mu.vercel.app/logout'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://api-usage-mu.vercel.app/auth/logout?returnTo=%2F')
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  })
})
