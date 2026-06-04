import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Checkbox, CheckboxField, CheckboxGroup } from '@/components/checkbox'
import { Description, Field, FieldGroup, Fieldset, Label } from '@/components/fieldset'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { statusColor } from '@/lib/audit/demo-workspace'
import { getInviteStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { REQUIRED_UPLOAD_CATEGORIES } from '@/lib/audit/uploads'
import { createInviteAction, createWorkspaceAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function AdminWorkspacesPage() {
  const [workspaces, invites] = await Promise.all([getWorkspaceStore().list(), getInviteStore().list()])

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Workspaces</Heading>
          <Text className="mt-2">Invite-only audit workspaces for active customer reviews.</Text>
        </div>
        <Badge color="blue">{workspaces.length} active</Badge>
      </div>

      <section className="mt-10 grid gap-8 xl:grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)]">
        <form action={createWorkspaceAction} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <Fieldset>
            <Subheading>Create workspace</Subheading>
            <FieldGroup className="mt-6">
              <Field>
                <Label>Organization ID</Label>
                <Input name="organizationId" placeholder="org_customer" required />
              </Field>
              <Field>
                <Label>Organization name</Label>
                <Input name="organizationName" placeholder="Customer Ltd" required />
              </Field>
              <Field>
                <Label>Workspace name</Label>
                <Input name="name" placeholder="June 2026 audit" required />
              </Field>
              <Field>
                <Label>Audit period</Label>
                <Input name="auditPeriod" placeholder="June 2026" required />
              </Field>
              <Field>
                <Label>Billing system</Label>
                <Select name="billingSystem" defaultValue="Stripe" required>
                  <option value="Stripe">Stripe</option>
                  <option value="Chargebee">Chargebee</option>
                  <option value="Other">Other</option>
                </Select>
              </Field>
              <Field>
                <Label>Currency</Label>
                <Select name="currency" defaultValue="eur" required>
                  <option value="eur">EUR</option>
                  <option value="usd">USD</option>
                  <option value="gbp">GBP</option>
                </Select>
              </Field>
              <Field>
                <Label>Usage source</Label>
                <Input name="usageSource" placeholder="Warehouse CSV" required />
              </Field>
              <Field>
                <Label>Required upload checklist</Label>
                <Description>Select the source categories this workspace needs before review can start.</Description>
                <CheckboxGroup className="mt-3">
                  {REQUIRED_UPLOAD_CATEGORIES.map((item) => (
                    <CheckboxField key={item.category}>
                      <Checkbox name="requiredUploadCategories" value={item.category} defaultChecked={item.required} />
                      <Label>{item.label}</Label>
                      <Description>{item.owner}</Description>
                    </CheckboxField>
                  ))}
                </CheckboxGroup>
              </Field>
            </FieldGroup>
            <div className="mt-6">
              <Button type="submit">Create workspace</Button>
            </div>
          </Fieldset>
        </form>

        <div>
          <Subheading>Workspace registry</Subheading>
          <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
            <TableHead>
              <TableRow>
                <TableHeader>Workspace</TableHeader>
                <TableHeader>Customer</TableHeader>
                <TableHeader>Billing</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Created</TableHeader>
                <TableHeader>Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {workspaces.map((workspace) => (
                <TableRow key={workspace.id}>
                  <TableCell>
                    <div className="font-medium">{workspace.name}</div>
                    <div className="text-zinc-500">{workspace.id}</div>
                  </TableCell>
                  <TableCell>
                    <div>{workspace.organizationName}</div>
                    <div className="text-zinc-500">
                      {workspace.auditPeriod} · {workspace.currency.toUpperCase()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{workspace.billingSystem}</div>
                    <div className="text-zinc-500">{workspace.usageSource}</div>
                  </TableCell>
                  <TableCell>
                    <Badge color={statusColor(workspace.status)}>{workspace.status.replaceAll('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>{new Date(workspace.createdAt).toLocaleDateString('en-IE')}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} outline>
                        Open
                      </Button>
                      <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}/audit-log`} outline>
                        Audit log
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="mt-12 grid gap-8 xl:grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)]">
        <form action={createInviteAction} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <Fieldset>
            <Subheading>Invite customer</Subheading>
            <FieldGroup className="mt-6">
              <Field>
                <Label>Workspace</Label>
                <Select name="workspaceId" required>
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.organizationName} · {workspace.auditPeriod}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label>Name</Label>
                <Input name="name" placeholder="Finance lead" required />
              </Field>
              <Field>
                <Label>Email</Label>
                <Input name="email" type="email" placeholder="finance@example.com" required />
              </Field>
              <Field>
                <Label>Role</Label>
                <Select name="role" defaultValue="customer_admin" required>
                  <option value="customer_admin">Customer admin</option>
                  <option value="customer_member">Customer member</option>
                </Select>
              </Field>
            </FieldGroup>
            <div className="mt-6">
              <Button type="submit">Create invite</Button>
            </div>
          </Fieldset>
        </form>

        <div>
          <Subheading>Invited users</Subheading>
          {invites.length === 0 ? (
            <Text className="mt-4">No dynamic customer invites have been created yet.</Text>
          ) : (
            <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
              <TableHead>
                <TableRow>
                  <TableHeader>User</TableHeader>
                  <TableHeader>Workspace</TableHeader>
                  <TableHeader>Role</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Invited</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell>
                      <div className="font-medium">{invite.name}</div>
                      <div className="text-zinc-500">{invite.email}</div>
                    </TableCell>
                    <TableCell>{formatInviteWorkspaces(invite.workspaceIds, workspaces)}</TableCell>
                    <TableCell>{invite.role.replaceAll('_', ' ')}</TableCell>
                    <TableCell>
                      <Badge color={invite.status === 'active' ? 'green' : 'zinc'}>{invite.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(invite.invitedAt).toLocaleDateString('en-IE')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </>
  )
}

function formatInviteWorkspaces(workspaceIds: string[], workspaces: Array<{ id: string; organizationName: string; auditPeriod: string }>) {
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))

  return workspaceIds
    .map((workspaceId) => {
      const workspace = workspaceById.get(workspaceId)

      return workspace ? `${workspace.organizationName} · ${workspace.auditPeriod}` : workspaceId
    })
    .join(', ')
}
