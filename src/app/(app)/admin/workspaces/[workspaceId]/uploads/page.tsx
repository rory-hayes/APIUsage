import { notFound } from 'next/navigation'
import { type ReactNode } from 'react'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { statusColor } from '@/lib/audit/demo-workspace'
import {
  createUploadDownloadToken,
  getWorkspaceRequiredUploadCategories,
  getWorkspaceUploadChecklist,
  REQUIRED_UPLOAD_CATEGORIES,
  type UploadCategory,
  type UploadRecord,
  type UploadTaskComment,
  type UploadVersion,
} from '@/lib/audit/uploads'
import {
  DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
  getDownloadTokenSecret,
  getUploadStore,
  getUploadTaskCommentStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'

import { extractContractTermsAction } from '../../../actions'
import { addUploadTaskCommentAction, reviewUploadAction, runParseAction } from '../../../../uploads/actions'

export const dynamic = 'force-dynamic'

const categoryLabels = new Map(REQUIRED_UPLOAD_CATEGORIES.map((definition) => [definition.category, definition.label] as const))

export default async function AdminWorkspaceUploadsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const uploads = await getUploadStore().listByWorkspace(workspace.id)
  const checklist = getWorkspaceUploadChecklist(uploads, workspace.id, getWorkspaceRequiredUploadCategories(workspace))
  const comments = commentsByCategory(await getUploadTaskCommentStore().listByWorkspace(workspace.id))
  const reviewQueueCount = uploads.filter((upload) => upload.status === 'needs_review' || upload.status === 'needs_clarification').length
  const missingRequiredCount = checklist.filter((item) => item.required && item.status === 'missing').length
  const acceptedCount = uploads.filter((upload) => upload.status === 'accepted').length

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to workspace
          </Button>
          <Heading className="mt-6">Upload review</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Review received files, run parsers, and capture contract
            terms before reconciliation.
          </Text>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        <Summary label="Files">{plural(uploads.length, 'file')}</Summary>
        <Summary label="Review queue">{plural(reviewQueueCount, 'file')}</Summary>
        <Summary label="Accepted">{acceptedCount === 1 ? '1 accepted' : `${acceptedCount.toLocaleString('en-IE')} accepted`}</Summary>
        <Summary label="Missing required">{plural(missingRequiredCount, 'requirement')}</Summary>
      </div>

      <Subheading className="mt-12">Checklist</Subheading>
      <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>Requirement</TableHeader>
            <TableHeader>Owner</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Files</TableHeader>
            <TableHeader>Comments</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {checklist.map((item) => (
            <TableRow key={item.category}>
              <TableCell>
                <div className="font-medium">{item.label}</div>
                <div className="text-zinc-500">{item.required ? 'Required' : 'Optional'}</div>
              </TableCell>
              <TableCell>{item.owner}</TableCell>
              <TableCell>
                <Badge color={statusColor(item.status)}>{item.status.replaceAll('_', ' ')}</Badge>
              </TableCell>
              <TableCell>
                <div>{plural(item.files, 'file')}</div>
                {item.latestUpload ? <div className="mt-1 text-zinc-500">{item.latestUpload.filename}</div> : null}
                {uploadVersionHistory(item.versions)}
              </TableCell>
              <TableCell>{uploadTaskComments(workspace.id, item.category, comments.get(item.category) ?? [])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Subheading className="mt-12">Uploaded files</Subheading>
      {uploads.length === 0 ? (
        <Text className="mt-4">No customer-uploaded files have been received for this workspace yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>File</TableHeader>
              <TableHeader>Category</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Actions</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {uploads.map((upload) => (
              <TableRow key={upload.id}>
                <TableCell>
                  <div className="font-medium">{upload.filename}</div>
                  <div className="text-zinc-500">{fileSummary(upload)}</div>
                  {upload.reviewNote ? <div className="mt-1 max-w-sm text-zinc-500">{upload.reviewNote}</div> : null}
                </TableCell>
                <TableCell>{categoryLabel(upload.category)}</TableCell>
                <TableCell>
                  <Badge color={statusColor(upload.status)}>{upload.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>
                  <div className="grid gap-3">
                    <Button href={downloadHref(upload.id, upload.workspaceId)} outline>
                      Download
                    </Button>
                    <form action={runParseAction} className="grid gap-3">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="uploadId" value={upload.id} />
                      {upload.category === 'usage_csv' ? usageCsvMappingFields(upload) : null}
                      {upload.category === 'provider_cost_csv' ? providerCostCsvMappingFields(upload) : null}
                      <div>
                        <Button type="submit" outline>
                          Run parser
                        </Button>
                      </div>
                    </form>
                    {isContractTermSource(upload.category) ? (
                      <form action={extractContractTermsAction}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="uploadId" value={upload.id} />
                        <Button type="submit" outline>
                          Extract terms
                        </Button>
                      </form>
                    ) : null}
                    <form action={reviewUploadAction} className="grid gap-3 border-t border-zinc-950/10 pt-3 dark:border-white/10">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="uploadId" value={upload.id} />
                      <Textarea
                        name="reviewNote"
                        aria-label={`Review note for ${upload.filename}`}
                        defaultValue={upload.reviewNote ?? ''}
                        placeholder="Optional review note"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" name="status" value="accepted">
                          Accept
                        </Button>
                        <Button type="submit" name="status" value="needs_clarification" outline>
                          Needs clarification
                        </Button>
                        <Button type="submit" name="status" value="duplicate" outline>
                          Duplicate
                        </Button>
                        <Button type="submit" name="status" value="rejected" outline>
                          Reject
                        </Button>
                      </div>
                    </form>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function Summary({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{children}</div>
    </div>
  )
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

function usageCsvMappingFields(upload: UploadRecord) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input
        name="usageAccountIdColumn"
        aria-label="Usage account ID column"
        defaultValue={usageMappingValue(upload, 'accountId', 'account_id')}
        placeholder="Account column"
      />
      <Input
        name="usageCustomerIdColumn"
        aria-label="Usage customer ID column"
        defaultValue={usageMappingValue(upload, 'customerId', '')}
        placeholder="Customer ID column"
      />
      <Input
        name="usageCustomerNameColumn"
        aria-label="Usage customer name column"
        defaultValue={usageMappingValue(upload, 'customerName', 'customer_name')}
        placeholder="Customer name column"
      />
      <Input
        name="usageMeterColumn"
        aria-label="Usage meter column"
        defaultValue={usageMappingValue(upload, 'meter', 'meter_name')}
        placeholder="Meter column"
        required
      />
      <Input
        name="usageQuantityColumn"
        aria-label="Usage quantity column"
        defaultValue={usageMappingValue(upload, 'quantity', 'total')}
        placeholder="Quantity column"
        required
      />
      <Input
        name="usageUnitColumn"
        aria-label="Usage unit column"
        defaultValue={usageMappingValue(upload, 'unit', 'unit')}
        placeholder="Unit column"
        required
      />
      <Input
        name="usagePeriodStartColumn"
        aria-label="Usage period start column"
        defaultValue={usageMappingValue(upload, 'periodStart', 'start')}
        placeholder="Start column"
        required
      />
      <Input
        name="usagePeriodEndColumn"
        aria-label="Usage period end column"
        defaultValue={usageMappingValue(upload, 'periodEnd', 'end')}
        placeholder="End column"
        required
      />
    </div>
  )
}

function providerCostCsvMappingFields(upload: UploadRecord) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input
        name="costAccountIdColumn"
        aria-label="Cost account ID column"
        defaultValue={providerCostMappingValue(upload, 'accountId', 'account_id')}
        placeholder="Account column"
      />
      <Input
        name="costCustomerIdColumn"
        aria-label="Cost customer ID column"
        defaultValue={providerCostMappingValue(upload, 'customerId', '')}
        placeholder="Customer ID column"
      />
      <Input
        name="costCustomerNameColumn"
        aria-label="Cost customer name column"
        defaultValue={providerCostMappingValue(upload, 'customerName', 'customer_name')}
        placeholder="Customer name column"
      />
      <Input
        name="costProviderColumn"
        aria-label="Cost provider column"
        defaultValue={providerCostMappingValue(upload, 'provider', 'provider')}
        placeholder="Provider column"
        required
      />
      <Input
        name="costProductColumn"
        aria-label="Cost product column"
        defaultValue={providerCostMappingValue(upload, 'product', 'product')}
        placeholder="Product column"
      />
      <Input
        name="costModelColumn"
        aria-label="Cost model column"
        defaultValue={providerCostMappingValue(upload, 'model', 'model')}
        placeholder="Model column"
      />
      <Input
        name="costAmountColumn"
        aria-label="Cost amount column"
        defaultValue={providerCostMappingValue(upload, 'costAmount', 'cost')}
        placeholder="Cost column"
        required
      />
      <Input
        name="costCurrencyColumn"
        aria-label="Cost currency column"
        defaultValue={providerCostMappingValue(upload, 'currency', 'currency')}
        placeholder="Currency column"
        required
      />
      <Input
        name="costPeriodStartColumn"
        aria-label="Cost period start column"
        defaultValue={providerCostMappingValue(upload, 'periodStart', 'start')}
        placeholder="Start column"
        required
      />
      <Input
        name="costPeriodEndColumn"
        aria-label="Cost period end column"
        defaultValue={providerCostMappingValue(upload, 'periodEnd', 'end')}
        placeholder="End column"
        required
      />
    </div>
  )
}

function usageMappingValue(upload: UploadRecord, key: string, fallback: string) {
  return uploadMappingValue(upload, 'usageCsvMapping', key, fallback)
}

function providerCostMappingValue(upload: UploadRecord, key: string, fallback: string) {
  return uploadMappingValue(upload, 'providerCostCsvMapping', key, fallback)
}

function uploadMappingValue(upload: UploadRecord, metadataKey: string, key: string, fallback: string) {
  const mapping = upload.metadata[metadataKey]

  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
    return fallback
  }

  const value = (mapping as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : fallback
}

function isContractTermSource(category: string) {
  return category === 'contracts_order_forms' || category === 'pricing_docs'
}

function categoryLabel(category: UploadRecord['category']) {
  return categoryLabels.get(category) ?? category.replaceAll('_', ' ')
}

function fileSummary(upload: UploadRecord) {
  const parts = [`${Math.ceil(upload.byteSize / 1024)} KB`, upload.checksum?.slice(0, 12), `uploaded ${formatDate(upload.uploadedAt)}`]

  return parts.filter(Boolean).join(' - ')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function downloadHref(uploadId: string, workspaceId: string) {
  const token = createUploadDownloadToken(
    {
      uploadId,
      workspaceId,
      expiresInSeconds: DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
    },
    getDownloadTokenSecret(),
  )

  return `/api/uploads/${encodeURIComponent(uploadId)}/download?token=${encodeURIComponent(token)}`
}

function plural(count: number, singular: string) {
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-IE')} ${singular}s`
}
