import { Logo } from '@/app/logo'
import { Button } from '@/components/button'
import { Checkbox, CheckboxField } from '@/components/checkbox'
import { Field, Label } from '@/components/fieldset'
import { Heading } from '@/components/heading'
import { Input } from '@/components/input'
import { Strong, Text, TextLink } from '@/components/text'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Login',
}

export default async function Login({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const params = await searchParams
  const hasInvalidCredentials = params?.error === 'invalid'

  return (
    <form action="/api/auth/login" method="POST" className="grid w-full max-w-sm grid-cols-1 gap-8">
      <Logo className="h-8 text-zinc-950 dark:text-white forced-colors:text-[CanvasText]" />
      <Heading>Sign in to your audit workspace</Heading>
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
      <Button type="submit" className="w-full">
        Sign in
      </Button>
      <Text>
        Need access?{' '}
        <TextLink href="/register">
          <Strong>Request an invite</Strong>
        </TextLink>
      </Text>
    </form>
  )
}
