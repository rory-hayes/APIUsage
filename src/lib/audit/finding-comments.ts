import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'

export const findingCommentSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  findingId: z.string().min(1),
  body: z.string().trim().min(1),
  authorId: z.string().min(1),
  authorName: z.string().min(1),
  authorRole: z.enum(['customer_admin', 'customer_member', 'internal_admin']),
  createdAt: z.string().datetime(),
})

export type FindingComment = z.infer<typeof findingCommentSchema>

export type CreateFindingCommentInput = {
  organizationId: string
  workspaceId: string
  findingId: string
  body: string
  authorId: string
  authorName: string
  authorRole: FindingComment['authorRole']
}

export function createFindingComment(input: CreateFindingCommentInput, now = new Date()): FindingComment {
  const createdAt = now.toISOString()
  const body = input.body.trim()
  const fingerprint = createHash('sha256')
    .update(`${input.workspaceId}:${input.findingId}:${input.authorId}:${body}:${createdAt}`)
    .digest('hex')
    .slice(0, 12)

  return findingCommentSchema.parse({
    ...input,
    body,
    id: `fcomment_${slug(input.workspaceId)}_${slug(input.findingId)}_${slugTimestamp(createdAt)}_${fingerprint}`,
    createdAt,
  })
}

export class JsonFindingCommentStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<FindingComment[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return sortCommentsOldestFirst(z.array(findingCommentSchema).parse(JSON.parse(raw)))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<FindingComment[]> {
    const comments = await this.list()

    return comments.filter((comment) => comment.workspaceId === workspaceId)
  }

  async listByFinding(workspaceId: string, findingId: string): Promise<FindingComment[]> {
    const comments = await this.listByWorkspace(workspaceId)

    return comments.filter((comment) => comment.findingId === findingId)
  }

  async save(comment: FindingComment): Promise<void> {
    const comments = await this.list()
    const next = sortCommentsOldestFirst([...comments.filter((existing) => existing.id !== comment.id), comment])

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const comments = await this.list()
    const next = comments.filter((comment) => comment.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return comments.length - next.length
  }
}

function sortCommentsOldestFirst(comments: FindingComment[]): FindingComment[] {
  return [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
}

function slugTimestamp(value: string): string {
  return value.replace(/[-:.]/g, '_')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
