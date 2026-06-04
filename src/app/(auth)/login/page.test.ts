import { isValidElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import Login from './page'

const ORIGINAL_ENV = {
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET: process.env.AUTH0_CLIENT_SECRET,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  AUTH0_SECRET: process.env.AUTH0_SECRET,
}

describe('login page', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('uses Auth0 as the production login entry point when configured', async () => {
    process.env.AUTH0_CLIENT_ID = 'client-id'
    process.env.AUTH0_CLIENT_SECRET = 'client-secret'
    process.env.AUTH0_DOMAIN = 'example.auth0.com'
    process.env.AUTH0_SECRET = 'x'.repeat(64)

    const page = await Login({})

    expect(collectHrefs(page)).toContain('/auth/login?returnTo=%2Fauth%2Fpost-login')
    expect(collectInputNames(page)).not.toContain('password')
    expect(collectText(page)).toContain('Continue with Auth0')
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

function collectText(node: ReactNode): string {
  if (Array.isArray(node)) {
    return node.map(collectText).join('')
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (!isValidElement(node)) {
    return ''
  }

  return collectText((node.props as { children?: ReactNode }).children)
}

function collectHrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectHrefs)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; href?: string }

  return [...(props.href ? [props.href] : []), ...collectHrefs(props.children)]
}

function collectInputNames(node: ReactNode): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectInputNames)
  }

  if (!isValidElement(node)) {
    return []
  }

  const props = node.props as { children?: ReactNode; name?: string }

  return [...(props.name ? [props.name] : []), ...collectInputNames(props.children)]
}
