import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from '../audit/persistence'
import { invitedUserSchema, type InvitedUser } from './access'

export const inviteStatusSchema = z.enum(['active', 'revoked'])
export const inviteRoleSchema = z.enum(['customer_admin', 'customer_member'])

export const inviteRecordSchema = invitedUserSchema
  .extend({
    role: inviteRoleSchema,
    status: inviteStatusSchema,
    invitedBy: z.string().min(1),
    invitedAt: z.string().datetime(),
  })

export type InviteRecord = z.infer<typeof inviteRecordSchema>

export type CreateWorkspaceInviteInput = {
  email: string
  name: string
  organizationId: string
  organizationName: string
  role: z.infer<typeof inviteRoleSchema>
  workspaceId: string
  invitedBy: string
}

export function createWorkspaceInvite(input: CreateWorkspaceInviteInput, now = new Date()): InviteRecord {
  const email = input.email.trim().toLowerCase()

  return inviteRecordSchema.parse({
    id: `user_${slug(email)}`,
    email,
    name: input.name.trim(),
    organizationId: input.organizationId.trim(),
    organizationName: input.organizationName.trim(),
    role: input.role,
    workspaceIds: [input.workspaceId.trim()],
    status: 'active',
    invitedBy: input.invitedBy,
    invitedAt: now.toISOString(),
  })
}

export function createWorkspaceInviteFromFormData(formData: FormData, invitedBy: string, organizationId: string, organizationName: string): InviteRecord {
  return createWorkspaceInvite({
    email: requiredString(formData, 'email'),
    name: requiredString(formData, 'name'),
    organizationId,
    organizationName,
    role: inviteRoleSchema.parse(formData.get('role')),
    workspaceId: requiredString(formData, 'workspaceId'),
    invitedBy,
  })
}

export function toInvitedUser(invite: InviteRecord): InvitedUser {
  return invitedUserSchema.parse({
    id: invite.id,
    email: invite.email,
    name: invite.name,
    organizationId: invite.organizationId,
    organizationName: invite.organizationName,
    role: invite.role,
    workspaceIds: invite.workspaceIds,
  })
}

export class JsonInviteStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<InviteRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortByNewest(z.array(inviteRecordSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<InviteRecord[]> {
    const invites = await this.list()

    return invites.filter((invite) => invite.workspaceIds.includes(workspaceId))
  }

  async listActiveInvitedUsers(): Promise<InvitedUser[]> {
    const invites = await this.list()

    return invites.filter((invite) => invite.status === 'active').map(toInvitedUser)
  }

  async save(invite: InviteRecord): Promise<void> {
    const invites = await this.list()
    const nextById = new Map(invites.map((existing) => [existing.id, existing]))
    nextById.set(invite.id, invite)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(sortByNewest([...nextById.values()]), null, 2), 'utf8')
  }
}

function sortByNewest(invites: InviteRecord[]): InviteRecord[] {
  return [...invites].sort((a, b) => new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime())
}

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key)

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required invite field: ${key}`)
  }

  return value
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
