import { Logo } from '@/app/logo'
import { Button } from '@/components/button'
import { Checkbox, CheckboxField } from '@/components/checkbox'
import { Field, Label } from '@/components/fieldset'
import { Heading } from '@/components/heading'
import { Input } from '@/components/input'
import { Strong, Text, TextLink } from '@/components/text'
import { isAuth0Configured } from '@/lib/auth/auth0-session'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login',
}

export default async function Login({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const params = await searchParams
  const auth0Configured = isAuth0Configured()
  const error = params?.error
  const hasInvalidCredentials = error === 'invalid'
  const hasAuth0AccessError =
    error === 'not_invited' || error === 'email_unverified' || error === 'missing_email' || error === 'auth0'

  return (
    <form action="/api/auth/login" method="POST" className="grid w-full max-w-md grid-cols-1 gap-7">
      <Logo className="h-8 text-zinc-950 forced-colors:text-[CanvasText]" />
      <div>
        <Heading>Sign in to your audit workspace</Heading>
        <Text className="mt-2">Access your invited revenue audit workspace.</Text>
      </div>
      {auth0Configured ? (
        <>
          {hasAuth0AccessError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm/6 font-medium text-red-700">
              Your Auth0 account is not linked to an active workspace invite.
            </div>
          ) : null}
          <Button href="/auth/login?returnTo=%2Fauth%2Fpost-login" className="w-full py-2.5">
            Continue with Auth0
          </Button>
        </>
      ) : (
        <>
          {hasInvalidCredentials ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm/6 font-medium text-red-700">
              Use an invited email and the current workspace password.
            </div>
          ) : null}
          <Field>
            <Label>Email</Label>
            <Input type="email" name="email" autoComplete="email" required />
          </Field>
          <Field>
            <Label>Password</Label>
            <Input type="password" name="password" autoComplete="current-password" required />
          </Field>
          <div className="flex items-center justify-between">
            <CheckboxField>
              <Checkbox name="remember" />
              <Label>Remember me</Label>
            </CheckboxField>
            <Text>
              <TextLink href="/forgot-password">
                <Strong>Forgot password?</Strong>
              </TextLink>
            </Text>
          </div>
          <Button type="submit" className="w-full py-2.5">
            Sign in
          </Button>
        </>
      )}
      <Text>
        Need access?{' '}
        <TextLink href="/register">
          <Strong>Request an invite</Strong>
        </TextLink>
      </Text>
    </form>
  )
}
