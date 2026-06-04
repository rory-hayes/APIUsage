import { Logo } from '@/app/logo'
import { Button } from '@/components/button'
import { Field, Label } from '@/components/fieldset'
import { Heading } from '@/components/heading'
import { Input } from '@/components/input'
import { Strong, Text, TextLink } from '@/components/text'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Request invite',
}

export default function RequestInvite() {
  return (
    <form action="" method="POST" className="grid w-full max-w-sm grid-cols-1 gap-8">
      <Logo className="h-8 text-zinc-950 dark:text-white forced-colors:text-[CanvasText]" />
      <Heading>Request workspace access</Heading>
      <Field>
        <Label>Work email</Label>
        <Input type="email" name="email" autoComplete="email" />
      </Field>
      <Field>
        <Label>Full name</Label>
        <Input name="name" autoComplete="name" />
      </Field>
      <Field>
        <Label>Company</Label>
        <Input name="company" autoComplete="organization" />
      </Field>
      <Field>
        <Label>Billing system</Label>
        <Input name="billing_system" placeholder="Stripe, Chargebee, or other" />
      </Field>
      <Button type="submit" className="w-full">
        Request invite
      </Button>
      <Text>
        Already have an account?{' '}
        <TextLink href="/login">
          <Strong>Sign in</Strong>
        </TextLink>
      </Text>
    </form>
  )
}
