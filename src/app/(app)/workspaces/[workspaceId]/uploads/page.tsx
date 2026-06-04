import { notFound } from 'next/navigation'
import type { ComponentProps } from 'react'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Field, Label } from '@/components/fieldset'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { getUploadStore, getUploadTaskCommentStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import {
  getWorkspaceRequiredUploadCategories,
  getWorkspaceUploadChecklist,
  type UploadCategory,
  type UploadTaskComment,
  type UploadVersion,
} from '@/lib/audit/uploads'
import { listSessionWorkspaces } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'

import { addUploadTaskCommentAction, uploadFileAction } from '../../../uploads/actions'

export const dynamic = 'force-dynamic'

type BadgeColor = ComponentProps<typeof Badge>['color']

export default async function WorkspaceUploadsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireSession()
  const { workspaceId } = await params
  const workspace = listSessionWorkspaces(session, await getWorkspaceStore().list()).find((candidate) => candidate.id === workspaceId)

  if (!workspace) {
    notFound()
  }

  const persistedUploads = await getUploadStore().listByWorkspace(workspace.id)
  const requiredUploadCategories = getWorkspaceRequiredUploadCategories(workspace)
  const uploadChecklist = getWorkspaceUploadChecklist(persistedUploads, workspace.id, requiredUploadCategories)
  const comments = commentsByCategory(await getUploadTaskCommentStore().listByWorkspace(workspace.id))

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to workspace
          </Button>
          <Heading className="mt-6">Uploads</Heading>
          <Text className="mt-2">
            Required source files for {workspace.organizationName} - {workspace.auditPeriod}.
          </Text>
        </div>
      </div>

      <form action={uploadFileAction} className="mt-8 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <input type="hidden" name="workspaceId" value={workspace.id} />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1.5fr_auto] lg:items-end">
          <Field>
            <Label>Source category</Label>
            <Select name="category" defaultValue="usage_csv">
              {requiredUploadCategories.map((item) => (
                <option key={item.category} value={item.category}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field>
            <Label>File</Label>
            <Input name="file" type="file" required />
          </Field>
          <Button type="submit">Upload file</Button>
        </div>
      </form>

      <Subheading className="mt-10">Checklist</Subheading>
      <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>Source category</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Owner</TableHeader>
            <TableHeader>Latest file</TableHeader>
            <TableHeader className="text-right">Files</TableHeader>
            <TableHeader>Comments</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {uploadChecklist.map((item) => (
            <TableRow key={item.category}>
              <TableCell className="font-medium">{item.label}</TableCell>
              <TableCell>
                <Badge color={statusColor(item.status)}>{item.status.replaceAll('_', ' ')}</Badge>
              </TableCell>
              <TableCell>{item.owner}</TableCell>
              <TableCell className="text-zinc-500">
                <div>{item.latestUpload?.filename ?? 'Not received'}</div>
                {uploadVersionHistory(item.versions)}
              </TableCell>
              <TableCell className="text-right">{item.files}</TableCell>
              <TableCell>{uploadTaskComments(workspace.id, item.category, comments.get(item.category) ?? [])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

function statusColor(status: string): BadgeColor {
  if (status === 'accepted') return 'green'
  if (status === 'needs_review' || status === 'needs_clarification') return 'amber'
  if (status === 'duplicate') return 'blue'
  if (status === 'missing' || status === 'rejected') return 'red'
  return 'zinc'
}

function commentsByCategory(comments: UploadTaskComment[]): Map<UploadCategory, UploadTaskComment[]> {
  const grouped = new Map<UploadCategory, UploadTaskComment[]>()

  for (const comment of comments) {
    grouped.set(comment.category, [...(grouped.get(comment.category) ?? []), comment])
  }

  return grouped
}

function uploadTaskComments(workspaceId: string, category: UploadCategory, comments: UploadTaskComment[]) {
  return (
    <div className="grid min-w-64 gap-3">
      <div className="grid gap-2">
        {comments.length === 0 ? <Text>No comments yet.</Text> : null}
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-md border border-zinc-950/10 p-3 text-sm dark:border-white/10">
            <div className="font-medium text-zinc-950 dark:text-white">{comment.authorName}</div>
            <div className="mt-1 text-zinc-500 dark:text-zinc-400">{comment.body}</div>
          </div>
        ))}
      </div>
      <form action={addUploadTaskCommentAction} className="grid gap-2">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="category" value={category} />
        <Textarea name="body" aria-label={`Comment for ${category.replaceAll('_', ' ')}`} placeholder="Add a note about this file task" />
        <div>
          <Button type="submit" outline>
            Add comment
          </Button>
        </div>
      </form>
    </div>
  )
}

function uploadVersionHistory(versions: UploadVersion[]) {
  if (versions.length <= 1) {
    return null
  }

  return (
    <div className="mt-2 grid gap-1 text-xs text-zinc-500 dark:text-zinc-400">
      <div className="font-medium text-zinc-700 dark:text-zinc-300">Version history</div>
      {versions.map((version) => (
        <div key={version.uploadId}>
          {`v${version.version}${version.isLatest ? ' latest' : ''}`} - {version.filename} - {versionComparison(version)}
        </div>
      ))}
    </div>
  )
}

function versionComparison(version: UploadVersion) {
  if (version.changedFromPrevious === null) {
    return 'Original upload'
  }

  return version.changedFromPrevious ? `Changed from v${version.version - 1}` : `Unchanged from v${version.version - 1}`
}
