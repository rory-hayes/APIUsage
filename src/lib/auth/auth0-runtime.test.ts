import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = {
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  AUTH0_SECRET: process.env.AUTH0_SECRET,
}

describe('Auth0 runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    restoreEnv()
  })

  it('does not instantiate the Auth0 SDK when Auth0 is not configured', async () => {
    delete process.env.AUTH0_CLIENT_ID
    delete process.env.AUTH0_CLIENT_SECRET
    delete process.env.AUTH0_DOMAIN
    delete process.env.AUTH0_SECRET
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { auth0 } = await import('./auth0-runtime')

    await expect(auth0.getSession()).resolves.toBeNull()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
