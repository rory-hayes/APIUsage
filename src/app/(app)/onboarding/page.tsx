import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace, type AuditWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

const onboardingSteps = [
  {
    label: 'Confirm workspace',
    detail: 'Review customer, audit period, billing system, and usage source details before work begins.',
    href: 'workspace',
  },
  {
    label: 'Complete intake',
    detail: 'Capture billing model, usage, credit, overage, and month-end process context.',
    href: '/intake',
  },
  {
    label: 'Upload source files',
    detail: 'Provide contracts, billing exports, usage files, and supporting evidence for internal review.',
    href: '/uploads',
  },
  {
    label: 'Track readiness',
    detail: 'Follow intake, upload, parser, reconciliation, and evidence pack progress in one place.',
    href: '/status',
  },
  {
    label: 'Invite teammates',
    detail: 'Check who has access to this workspace and coordinate the finance and billing handoff.',
    href: '/settings/team',
  },
]

export default async function OnboardingPage() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Onboarding</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.name}. Start the invite-only audit workflow for {workspace.auditPeriod}.
          </Text>
        </div>
        <Badge color={statusColor(workspace.status)}>{workspace.status.replaceAll('_', ' ')}</Badge>
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        {onboardingSteps.map((step) => (
          <div key={step.label} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Subheading>{step.label}</Subheading>
                <Text className="mt-2">{step.detail}</Text>
              </div>
              <Button href={stepHref(step.href, workspace)} outline>
                Open
              </Button>
            </div>
          </div>
        ))}
      </section>
    </>
  )
}

function stepHref(href: string, workspace: AuditWorkspace) {
  if (href === 'workspace') {
    return `/workspaces/${encodeURIComponent(workspace.id)}`
  }

  return href
}
