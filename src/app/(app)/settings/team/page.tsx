import { Badge } from '@/components/badge'
import { Heading } from '@/components/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { getInviteStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { defaultInvitedUsers, type InvitedUser, type Session } from '@/lib/auth/access'
import { type InviteRecord } from '@/lib/auth/invites'
import { requireSession } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

type TeamMember = {
  id: string
  email: string
  name: string
  role: Session['role']
  status: 'active'
  source: string
}

export default async function TeamSettingsPage() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const invites = await getInviteStore().listByWorkspace(workspace.id)
  const teamMembers = buildTeamMembers(session, workspace.id, invites)

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Team</Heading>
          <Text className="mt-2">Invite-only members with access to {workspace.organizationName}.</Text>
        </div>
        <Badge color="blue">{teamMembers.length} active</Badge>
      </div>

      <Table className="mt-8 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>User</TableHeader>
            <TableHeader>Role</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Source</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {teamMembers.map((member) => (
            <TableRow key={member.id}>
              <TableCell>
                <div className="font-medium">{member.name}</div>
                <div className="text-zinc-500">{member.email}</div>
              </TableCell>
              <TableCell>{member.role.replaceAll('_', ' ')}</TableCell>
              <TableCell>
                <Badge color="green">{member.status}</Badge>
              </TableCell>
              <TableCell>{member.source}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

function buildTeamMembers(session: Session, workspaceId: string, invites: InviteRecord[]): TeamMember[] {
  const byEmail = new Map<string, TeamMember>()
  const canViewInternalMembers = session.role === 'internal_admin'

  addMember(byEmail, {
    id: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    status: 'active',
    source: 'Current session',
  })

  for (const user of defaultInvitedUsers.filter((user) => user.workspaceIds.includes(workspaceId))) {
    const member = teamMemberFromInvitedUser(user, 'Seed invite')

    if (canViewInternalMembers || member.role !== 'internal_admin') {
      addMember(byEmail, member)
    }
  }

  for (const invite of invites.filter((invite) => invite.status === 'active')) {
    addMember(byEmail, {
      id: invite.id,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      status: 'active',
      source: 'Workspace invite',
    })
  }

  return [...byEmail.values()]
}

function teamMemberFromInvitedUser(user: InvitedUser, source: string): TeamMember {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: 'active',
    source,
  }
}

function addMember(members: Map<string, TeamMember>, member: TeamMember) {
  const key = member.email.toLowerCase()

  if (!members.has(key)) {
    members.set(key, member)
  }
}
