import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/description-list'
import { Heading, Subheading } from '@/components/heading'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { listSessionWorkspaces, type AuditWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

const workflowLinks = [
  {
    label: 'Complete intake',
    detail: 'Answer billing model, usage, credit, overage, and month-end context questions.',
    next: '/intake',
  },
  {
    label: 'Upload source files',
    detail: 'Send contracts, pricing docs, billing exports, usage CSVs, and supporting data.',
    next: '/uploads',
  },
  {
    label: 'Track audit status',
    detail: 'Review intake, upload, parser, and finding readiness for this workspace.',
    next: '/status',
  },
  {
    label: 'Review findings',
    detail: 'Open approved revenue and margin integrity findings for customer review.',
    next: '/findings',
  },
  {
    label: 'Open evidence pack',
    detail: 'Download or preview the human-reviewed evidence pack and readout summary.',
    next: '/evidence-pack',
  },
]

export default async function WorkspaceDetailPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const session = await requireSession()
  const accessibleWorkspaces = listSessionWorkspaces(session, await getWorkspaceStore().list())
  const workspace = accessibleWorkspaces.find((candidate) => candidate.id === workspaceId)

  if (!workspace) {
    notFound()
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href="/workspaces" plain>
            Back to workspaces
          </Button>
          <Heading className="mt-6">Workspace overview</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Invite-only audit workspace for usage, billing,
            contract, and margin review.
          </Text>
        </div>
        <Badge color={statusColor(workspace.status)}>{workspace.status.replaceAll('_', ' ')}</Badge>
      </div>

      <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.55fr)]">
        <div>
          <Subheading>Workspace workflow</Subheading>
          <div className="mt-4 grid gap-4">
            {workflowLinks.map((link) => (
              <div key={link.next} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-zinc-950 dark:text-white">{link.label}</div>
                    <Text className="mt-2">{link.detail}</Text>
                  </div>
                  <Button href={workspaceRouteHref(workspace.id, link.next)} outline>
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside>
          <Subheading>Workspace details</Subheading>
          <DescriptionList className="mt-4">
            <DescriptionTerm>Customer</DescriptionTerm>
            <DescriptionDetails>{workspace.organizationName}</DescriptionDetails>
            <DescriptionTerm>Workspace</DescriptionTerm>
            <DescriptionDetails>{workspace.name}</DescriptionDetails>
            <DescriptionTerm>Audit period</DescriptionTerm>
            <DescriptionDetails>{workspace.auditPeriod}</DescriptionDetails>
            <DescriptionTerm>Billing system</DescriptionTerm>
            <DescriptionDetails>{workspace.billingSystem}</DescriptionDetails>
            <DescriptionTerm>Usage source</DescriptionTerm>
            <DescriptionDetails>{workspace.usageSource}</DescriptionDetails>
            <DescriptionTerm>Workspace ID</DescriptionTerm>
            <DescriptionDetails>{workspace.id}</DescriptionDetails>
          </DescriptionList>
        </aside>
      </section>
    </>
  )
}

function workspaceRouteHref(workspaceId: AuditWorkspace['id'], next: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}${next}`
}
