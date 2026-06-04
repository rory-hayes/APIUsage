import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/description-list'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { type AuditLogEvent } from '@/lib/audit/audit-log'
import { getUnmappedAccountReport, type AccountMapping } from '@/lib/audit/account-mapping'
import { buildIntakeAnswerList, getIntakeCompleteness } from '@/lib/audit/intake'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { summarizeParsedRecord } from '@/lib/audit/parsed-record-display'
import { type ContractTerm, type Finding } from '@/lib/audit/schemas'
import {
  DEFAULT_DOWNLOAD_TOKEN_TTL_SECONDS,
  getAccountMappingStore,
  getAuditLogStore,
  getContractTermStore,
  getDownloadTokenSecret,
  getFindingStore,
  getIntakeStore,
  getParsedRecordStore,
  getParseJobStore,
  getUploadStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace, type AuditWorkspace } from '@/lib/audit/workspaces'
import { requireInternalAdmin } from '@/lib/auth/server'
import { Fragment, type ComponentProps } from 'react'
import { createUploadDownloadToken, getUploadChecklist } from '@/lib/audit/uploads'
import {
  approveAccountMappingAction,
  createManualContractTermAction,
  extractContractTermsAction,
  mergeFindingAction,
  reviewContractTermAction,
  reviewFindingAction,
  runReconciliationAction,
  saveManualAccountMappingAction,
  suggestAccountMappingsAction,
} from './actions'
import { reviewUploadAction, runParseAction } from '../uploads/actions'

export const dynamic = 'force-dynamic'

type BadgeColor = ComponentProps<typeof Badge>['color']

type AdminPageSearchParams = Record<string, string | string[] | undefined>

const draftFindingStatusOptions = ['draft', 'needs_review', 'needs_customer_input'] as const satisfies readonly Finding['status'][]
const findingSeverityOptions = ['critical', 'high', 'medium', 'low', 'info'] as const satisfies readonly Finding['severity'][]
const findingCategoryOptions = [
  'usage_exists_no_invoice',
  'invoice_without_usage',
  'usage_above_allowance_no_overage',
  'wrong_overage_rate',
  'credit_burn_mismatch',
  'expired_discount_active',
  'minimum_not_enforced',
  'contract_terms_not_in_billing',
  'cancelled_account_usage',
  'internal_usage_billed',
  'paid_usage_marked_free',
  'cost_exceeds_revenue',
  'duplicate_usage',
  'missing_usage',
  'late_usage_after_invoice_finalization',
  'account_mapping_mismatch',
] as const satisfies readonly Finding['category'][]

export default async function AdminPage({ searchParams }: { searchParams?: Promise<AdminPageSearchParams> } = {}) {
  const session = await requireInternalAdmin()
  const params = searchParams ? await searchParams : {}
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const contractTermStore = getContractTermStore()
  const accountMappingStore = getAccountMappingStore()
  const persistedUploads = await getUploadStore().listByWorkspace(workspace.id)
  const parseJobs = await getParseJobStore().listByWorkspace(workspace.id)
  const parsedRecords = await getParsedRecordStore().listByWorkspace(workspace.id)
  const generatedFindings = await getFindingStore().listByWorkspace(workspace.id)
  const contractTerms = await contractTermStore.listByWorkspace(workspace.id)
  const accountMappings = await accountMappingStore.listByWorkspace(workspace.id)
  const contractTermVersionCounts = new Map(
    await Promise.all(contractTerms.map(async (term) => [term.id, (await contractTermStore.listVersions(term.id)).length] as const)),
  )
  const auditEvents = await getAuditLogStore().listByWorkspace(workspace.id)
  const intakeResponse = await getIntakeStore().getByWorkspace(workspace.id)
  const intakeCompleteness = intakeResponse?.completeness ?? getIntakeCompleteness({})
  const intakeAnswerList = buildIntakeAnswerList(intakeResponse?.answers ?? {})
  const parseJobById = new Map(parseJobs.map((job) => [job.id, job]))
  const uploadById = new Map(persistedUploads.map((upload) => [upload.id, upload]))
  const uploadBySourceFileId = new Map(persistedUploads.map((upload) => [upload.sourceFileId, upload]))
  const parseErrors = parseJobs.flatMap((job) =>
    job.errors.map((error) => ({
      id: `${job.id}-${error.rowNumber}-${error.message}`,
      filename: job.filename,
      rowNumber: error.rowNumber,
      message: error.message,
    })),
  )
  const uploadChecklist = getUploadChecklist(persistedUploads)
  const unmappedReport = getUnmappedAccountReport([...parsedRecords, ...contractTerms.map(contractTermToParsedRecord)], accountMappings)
  const unmappedTotal =
    unmappedReport.usageAccountIds.length +
    unmappedReport.stripeCustomerIds.length +
    unmappedReport.contractCustomerIds.length +
    unmappedReport.costAccountIds.length
  const runCards = buildRunCards({
    auditEvents,
    contractTerms,
    findings: generatedFindings,
    parsedRecords,
    workspace,
  })
  const findingFilters = {
    status: readFilter(params.findingStatus, draftFindingStatusOptions),
    severity: readFilter(params.findingSeverity, findingSeverityOptions),
    category: readFilter(params.findingCategory, findingCategoryOptions),
  }
  const actionableFindings = generatedFindings.filter(isDraftReviewFinding)
  const filteredActionableFindings = actionableFindings.filter((finding) => matchesFindingFilters(finding, findingFilters))
  const reviewItems = [
    ...(intakeCompleteness.status === 'complete'
      ? []
      : [
          {
            item: 'Intake questionnaire',
            type: 'Intake',
            status: intakeCompleteness.status,
            owner: 'Customer',
            detail: `${intakeCompleteness.answeredRequired}/${intakeCompleteness.requiredQuestions} required answers complete`,
          },
        ]),
    ...(unmappedTotal === 0
      ? []
      : [
          {
            item: 'Account mappings',
            type: 'Mapping',
            status: 'needs_review',
            owner: 'Internal',
            detail: `${unmappedTotal} unmapped identifiers`,
          },
        ]),
    ...uploadChecklist.filter(isAttentionUploadItem).map((item) => ({
      item: item.label,
      type: 'Upload',
      status: item.status,
      owner: item.owner,
      detail: item.latestUpload?.filename ?? 'File missing',
    })),
    ...actionableFindings.map((finding) => ({
      item: `${finding.id} · ${finding.category.replaceAll('_', ' ')}`,
      type: 'Finding',
      status: finding.status,
      owner: 'Internal',
      detail: findingCustomerLabel(finding),
    })),
  ]

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Review queue</Heading>
          <Text className="mt-2">
            Internal operator view for {workspace.organizationName} - {workspace.auditPeriod}: files, mappings, run
            output, and draft findings.
          </Text>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href={findingsCsvDownloadHref(workspace.id)} download={`${slug(workspace.organizationName)}-${slug(workspace.auditPeriod)}-findings.csv`} outline>
            Export findings CSV
          </Button>
          <form action={runReconciliationAction}>
            <Button type="submit">Run checks</Button>
          </form>
        </div>
      </div>

      <Subheading className="mt-10">Needs attention</Subheading>
      <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>Item</TableHeader>
            <TableHeader>Type</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Owner</TableHeader>
            <TableHeader>Detail</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {reviewItems.map((item) => (
            <TableRow key={`${item.type}-${item.item}`}>
              <TableCell className="font-medium">{item.item}</TableCell>
              <TableCell>{item.type}</TableCell>
              <TableCell>
                <Badge color={statusColor(item.status)}>{item.status.replaceAll('_', ' ')}</Badge>
              </TableCell>
              <TableCell>{item.owner}</TableCell>
              <TableCell className="text-zinc-500">{item.detail}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Subheading className="mt-12">Customer intake</Subheading>
      <div className="mt-4 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium text-zinc-950 dark:text-white">Questionnaire status</div>
            <Text className="mt-1">
              {intakeCompleteness.answeredRequired} of {intakeCompleteness.requiredQuestions} required answers complete.
            </Text>
          </div>
          <Badge color={statusColor(intakeCompleteness.status)}>{intakeCompleteness.status.replaceAll('_', ' ')}</Badge>
        </div>
        {intakeAnswerList.length === 0 ? (
          <Text className="mt-6">No intake answers have been saved yet.</Text>
        ) : (
          <DescriptionList className="mt-6">
            {intakeAnswerList.map((answer) => (
              <Fragment key={answer.key}>
                <DescriptionTerm>{answer.label}</DescriptionTerm>
                <DescriptionDetails>{answer.value}</DescriptionDetails>
              </Fragment>
            ))}
          </DescriptionList>
        )}
      </div>

      <Subheading id="account-mappings" className="mt-12">Account mappings</Subheading>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-medium text-zinc-950 dark:text-white">Mapping health</div>
              <Text className="mt-1">{accountMappings.length} saved mappings · {unmappedTotal} unmapped identifiers</Text>
            </div>
            <form action={suggestAccountMappingsAction}>
              <Button type="submit" outline>
                Suggest mappings
              </Button>
            </form>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <MappingCount label="Usage accounts" values={unmappedReport.usageAccountIds} />
            <MappingCount label="Stripe customers" values={unmappedReport.stripeCustomerIds} />
            <MappingCount label="Contract customers" values={unmappedReport.contractCustomerIds} />
            <MappingCount label="Cost accounts" values={unmappedReport.costAccountIds} />
          </div>
        </div>

        <form action={saveManualAccountMappingAction} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <div className="font-medium text-zinc-950 dark:text-white">Manual override</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input name="displayName" aria-label="Display name" placeholder="Display name" required />
            <Input name="usageAccountId" aria-label="Usage account ID" placeholder="Usage account ID" />
            <Input name="usageCustomerId" aria-label="Usage customer ID" placeholder="Usage customer ID" />
            <Input name="usageCustomerName" aria-label="Usage customer name" placeholder="Usage customer name" />
            <Input name="stripeCustomerId" aria-label="Stripe customer ID" placeholder="Stripe customer ID" />
            <Input name="stripeCustomerEmail" aria-label="Stripe customer email" type="email" placeholder="billing@example.com" />
            <Input name="contractCustomerId" aria-label="Contract customer ID" placeholder="Contract customer ID" />
            <Input name="costAccountId" aria-label="Cost account ID" placeholder="Cost account ID" />
          </div>
          <Textarea name="note" aria-label="Manual mapping note" className="mt-3" placeholder="Why this mapping is correct" />
          <div className="mt-4">
            <Button type="submit">Save mapping</Button>
          </div>
        </form>
      </div>

      {accountMappings.length === 0 ? (
        <Text className="mt-4">No account mappings have been saved yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Account</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Usage</TableHeader>
              <TableHeader>Stripe</TableHeader>
              <TableHeader>Confidence</TableHeader>
              <TableHeader>Review</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {accountMappings.map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell>
                  <div className="font-medium">{mapping.displayName}</div>
                  <div className="text-zinc-500">{mapping.matchReasons.join(', ') || mapping.source}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(mapping.status)}>{mapping.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{formatUsageMapping(mapping)}</TableCell>
                <TableCell>{formatStripeMapping(mapping)}</TableCell>
                <TableCell>{Math.round(mapping.confidence * 100)}%</TableCell>
                <TableCell>
                  {mapping.status === 'suggested' ? (
                    <form action={approveAccountMappingAction} className="grid gap-3">
                      <input type="hidden" name="mappingId" value={mapping.id} />
                      <Textarea name="note" aria-label={`Review note for ${mapping.displayName}`} placeholder="Approval note" />
                      <Button type="submit">Approve mapping</Button>
                    </form>
                  ) : (
                    <Text>{mapping.reviewerId ?? 'System'}</Text>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading id="latest-runs" className="mt-12">Latest runs</Subheading>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {runCards.map((run) => (
          <div key={run.id} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-zinc-950 dark:text-white">{run.name}</div>
              <Badge color={statusColor(run.status)}>{run.status.replaceAll('_', ' ')}</Badge>
            </div>
            <Text className="mt-2">
              {run.records} processed · {run.findings} findings
            </Text>
          </div>
        ))}
      </div>

      <Subheading id="uploaded-files" className="mt-12">Uploaded files</Subheading>
      {persistedUploads.length === 0 ? (
        <Text className="mt-4">No customer-uploaded files have been received yet.</Text>
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
            {persistedUploads.map((upload) => (
              <TableRow key={upload.id}>
                <TableCell>
                  <div className="font-medium">{upload.filename}</div>
                  <div className="text-zinc-500">
                    {Math.ceil(upload.byteSize / 1024)} KB · {upload.checksum?.slice(0, 12)}
                  </div>
                </TableCell>
                <TableCell>{upload.category.replaceAll('_', ' ')}</TableCell>
                <TableCell>
                  <Badge color={statusColor(upload.status)}>{upload.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>
                  <div className="grid gap-3">
                    <Button href={downloadHref(upload.id, upload.workspaceId)} outline>
                      Download
                    </Button>
                    <form action={runParseAction}>
                      <input type="hidden" name="uploadId" value={upload.id} />
                      {upload.category === 'usage_csv' ? usageCsvMappingFields(upload) : null}
                      {upload.category === 'provider_cost_csv' ? providerCostCsvMappingFields(upload) : null}
                      <Button type="submit" outline>
                        Run parser
                      </Button>
                    </form>
                    {isContractTermSource(upload.category) ? (
                      <form action={extractContractTermsAction}>
                        <input type="hidden" name="uploadId" value={upload.id} />
                        <Button type="submit" outline>
                          Extract terms
                        </Button>
                      </form>
                    ) : null}
                    <form action={reviewUploadAction} className="grid gap-3">
                      <input type="hidden" name="uploadId" value={upload.id} />
                      <Textarea name="reviewNote" aria-label={`Review note for ${upload.filename}`} placeholder="Optional review note" />
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

      <Subheading id="contract-terms" className="mt-12">Contract terms</Subheading>
      <form action={createManualContractTermAction} className="mt-4 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <div className="font-medium text-zinc-950 dark:text-white">Add manual term</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="type" aria-label="Contract term type" defaultValue="overage_rate" required>
            <option value="overage_rate">overage rate</option>
            <option value="allowance">allowance</option>
            <option value="credit">credit</option>
            <option value="minimum">minimum</option>
            <option value="discount">discount</option>
            <option value="rate">rate</option>
            <option value="special_term">special term</option>
          </Select>
          <Input name="customerId" aria-label="Contract customer ID" placeholder="Customer ID" />
          <Input name="meter" aria-label="Contract meter" placeholder="Meter" />
          <Input name="unit" aria-label="Contract unit" placeholder="Unit" />
          <Input name="rate" aria-label="Manual rate" type="number" step="any" placeholder="Rate" />
          <Input name="allowance" aria-label="Manual allowance" type="number" step="any" placeholder="Allowance" />
          <Input name="creditAmount" aria-label="Manual credit amount" type="number" step="any" placeholder="Credit amount" />
          <Input name="minimumAmount" aria-label="Manual minimum amount" type="number" step="any" placeholder="Minimum amount" />
          <Input name="discountPercent" aria-label="Manual discount percent" type="number" step="any" placeholder="Discount %" />
          <Input name="currency" aria-label="Manual currency" placeholder="EUR" maxLength={3} />
          <Input name="effectiveFrom" aria-label="Manual effective from" type="date" />
          <Input name="effectiveTo" aria-label="Manual effective to" type="date" />
          <Input name="evidenceSourceFileId" aria-label="Manual evidence source file ID" placeholder="Source file ID" />
          <Input name="evidencePage" aria-label="Manual evidence page" type="number" placeholder="Page" />
          <Input name="evidenceSnippet" aria-label="Manual evidence snippet" placeholder="Evidence snippet" className="lg:col-span-2" />
        </div>
        <Textarea name="note" aria-label="Manual contract term note" className="mt-3" placeholder="Why this term is correct" />
        <div className="mt-4">
          <Button type="submit">Add term</Button>
        </div>
      </form>
      {contractTerms.length === 0 ? (
        <Text className="mt-4">No candidate contract terms have been extracted yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Term</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Evidence</TableHeader>
              <TableHeader>Versions</TableHeader>
              <TableHeader>Review</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {contractTerms.map((term) => (
              <TableRow key={term.id}>
                <TableCell>
                  <div className="font-medium">{term.type.replaceAll('_', ' ')}</div>
                  <div className="text-zinc-500">{formatContractTermValue(term)}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(term.status)}>{term.status}</Badge>
                </TableCell>
                <TableCell>
                  <div className="max-w-sm text-zinc-500">{term.evidence?.snippet ?? 'No snippet captured'}</div>
                  <div className="mt-1 text-zinc-400">
                    {term.evidence?.page ? `Page ${term.evidence.page}` : 'Page n/a'} · {term.evidence?.sourceFileId ?? 'source n/a'}
                  </div>
                </TableCell>
                <TableCell>{contractTermVersionCounts.get(term.id) ?? 0}</TableCell>
                <TableCell>
                  <form action={reviewContractTermAction} className="grid gap-3">
                    <input type="hidden" name="termId" value={term.id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input name="rate" aria-label={`Rate for ${term.id}`} type="number" defaultValue={term.rate?.toString() ?? ''} />
                      <Input name="allowance" aria-label={`Allowance for ${term.id}`} type="number" defaultValue={term.allowance?.toString() ?? ''} />
                      <Input
                        name="creditAmount"
                        aria-label={`Credit amount for ${term.id}`}
                        type="number"
                        defaultValue={term.creditAmount?.toString() ?? ''}
                      />
                      <Input
                        name="minimumAmount"
                        aria-label={`Minimum amount for ${term.id}`}
                        type="number"
                        defaultValue={term.minimumAmount?.toString() ?? ''}
                      />
                      <Input
                        name="discountPercent"
                        aria-label={`Discount percent for ${term.id}`}
                        type="number"
                        defaultValue={term.discountPercent?.toString() ?? ''}
                      />
                      <Input
                        name="effectiveFrom"
                        aria-label={`Effective from for ${term.id}`}
                        type="date"
                        defaultValue={term.effectiveFrom ?? ''}
                      />
                      <Input name="effectiveTo" aria-label={`Effective to for ${term.id}`} type="date" defaultValue={term.effectiveTo ?? ''} />
                    </div>
                    <Textarea name="note" aria-label={`Review note for ${term.id}`} placeholder="Review note or edit rationale" />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" name="status" value="approved">
                        Approve
                      </Button>
                      <Button type="submit" name="status" value="rejected" outline>
                        Reject
                      </Button>
                    </div>
                  </form>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Parse jobs</Subheading>
      {parseJobs.length === 0 ? (
        <Text className="mt-4">No uploaded files have been parsed yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Source file</TableHeader>
              <TableHeader>Parser</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="text-right">Records</TableHeader>
              <TableHeader className="text-right">Errors</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {parseJobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell>
                  <div className="font-medium">{job.filename}</div>
                  <div className="text-zinc-500">{new Date(job.ranAt).toLocaleString('en-IE')}</div>
                </TableCell>
                <TableCell>{job.parser.replaceAll('_', ' ')}</TableCell>
                <TableCell>
                  <Badge color={statusColor(job.status)}>{job.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell className="text-right">{job.recordCount}</TableCell>
                <TableCell className="text-right">{job.errorCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Source lineage</Subheading>
      {parsedRecords.length === 0 ? (
        <Text className="mt-4">No normalized records have been saved yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Source</TableHeader>
              <TableHeader>Type</TableHeader>
              <TableHeader>Location</TableHeader>
              <TableHeader>Summary</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {parsedRecords.slice(0, 20).map((record) => {
              const sourceUpload = uploadById.get(record.uploadId) ?? uploadBySourceFileId.get(record.sourceFileId)
              const sourceLabel = sourceUpload?.filename ?? parseJobById.get(record.jobId)?.filename ?? record.sourceFileId

              return (
                <TableRow key={record.id}>
                  <TableCell>
                    {sourceUpload ? (
                      <Button href={downloadHref(sourceUpload.id, workspace.id)} plain>
                        {sourceLabel}
                      </Button>
                    ) : (
                      <span className="font-medium">{sourceLabel}</span>
                    )}
                    <div className="mt-1 text-xs/5 text-zinc-500">{record.sourceFileId}</div>
                  </TableCell>
                  <TableCell>{record.recordType.replaceAll('_', ' ')}</TableCell>
                  <TableCell>{formatParsedRecordLocation(record)}</TableCell>
                  <TableCell className="text-zinc-500">{summarizeParsedRecord(record)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Parse errors</Subheading>
      {parseErrors.length === 0 ? (
        <Text className="mt-4">No row-level parser errors have been recorded.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Source file</TableHeader>
              <TableHeader>Row</TableHeader>
              <TableHeader>Error</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {parseErrors.map((error) => (
              <TableRow key={error.id}>
                <TableCell>{error.filename}</TableCell>
                <TableCell>{error.rowNumber}</TableCell>
                <TableCell className="text-zinc-500">{error.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="mt-12 flex flex-wrap items-end justify-between gap-4">
        <Subheading id="draft-findings">Draft findings</Subheading>
        <Text>
          {filteredActionableFindings.length} of {actionableFindings.length} reviewable findings
        </Text>
      </div>
      <form method="GET" action="/admin" className="mt-4 rounded-lg border border-zinc-950/10 bg-white p-4 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto]">
          <label className="grid gap-2 text-sm/6 font-medium text-zinc-950 dark:text-white">
            Status
            <Select name="findingStatus" defaultValue={findingFilters.status}>
              <option value="all">All statuses</option>
              {draftFindingStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {formatFilterLabel(status)}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm/6 font-medium text-zinc-950 dark:text-white">
            Severity
            <Select name="findingSeverity" defaultValue={findingFilters.severity}>
              <option value="all">All severities</option>
              {findingSeverityOptions.map((severity) => (
                <option key={severity} value={severity}>
                  {formatFilterLabel(severity)}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm/6 font-medium text-zinc-950 dark:text-white">
            Category
            <Select name="findingCategory" defaultValue={findingFilters.category}>
              <option value="all">All categories</option>
              {findingCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {formatFilterLabel(category)}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">Apply</Button>
            <Button href="/admin" outline>
              Clear
            </Button>
          </div>
        </div>
      </form>
      {actionableFindings.length === 0 ? (
        <Text className="mt-4">No draft findings currently need review.</Text>
      ) : filteredActionableFindings.length === 0 ? (
        <Text className="mt-4">No draft findings match the selected filters.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Finding</TableHeader>
              <TableHeader>Severity</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Evidence</TableHeader>
              <TableHeader className="text-right">Variance</TableHeader>
              <TableHeader>Review</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredActionableFindings.map((finding) => (
              <TableRow key={finding.id} href={`/admin/findings/${encodeURIComponent(finding.id)}`} title={finding.title}>
                <TableCell>
                  <div className="font-medium">{finding.title}</div>
                  <div className="text-zinc-500">{finding.category.replaceAll('_', ' ')}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.severity)}>{finding.severity}</Badge>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(finding.status)}>{finding.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{finding.evidenceRefs.length}</TableCell>
                <TableCell className="text-right">{formatMinorCurrency(finding.varianceAmount ?? 0, finding.currency)}</TableCell>
                <TableCell>
                  <div className="grid gap-3">
                    <form action={reviewFindingAction} className="grid gap-3">
                      <input type="hidden" name="findingId" value={finding.id} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          name="title"
                          aria-label={`Finding title for ${finding.title}`}
                          defaultValue={finding.title}
                          className="sm:col-span-2"
                          required
                        />
                        <Select name="severity" aria-label={`Severity for ${finding.title}`} defaultValue={finding.severity}>
                          <option value="critical">critical</option>
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="low">low</option>
                          <option value="info">info</option>
                        </Select>
                        <Input
                          name="expectedAmount"
                          aria-label={`Expected amount for ${finding.title}`}
                          type="number"
                          defaultValue={finding.expectedAmount.toString()}
                          required
                        />
                        <Input
                          name="actualAmount"
                          aria-label={`Actual amount for ${finding.title}`}
                          type="number"
                          defaultValue={finding.actualAmount.toString()}
                          required
                        />
                        <Input
                          name="recommendedAction"
                          aria-label={`Recommended action for ${finding.title}`}
                          defaultValue={finding.recommendedAction}
                          className="sm:col-span-2"
                          required
                        />
                      </div>
                      <Textarea name="internalNote" aria-label={`Internal note for ${finding.title}`} placeholder="Internal reviewer note" />
                      <Textarea name="customerNote" aria-label={`Customer note for ${finding.title}`} placeholder="Customer-facing note" />
                      <label className="flex items-center gap-2 text-sm/6 text-zinc-600 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          name="suppressFutureMatches"
                          value="on"
                          className="size-4 rounded border-zinc-300 text-zinc-900"
                        />
                        Suppress future matches
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" name="status" value="approved_internal">
                          Approve
                        </Button>
                        <Button type="submit" name="status" value="rejected" outline>
                          Reject
                        </Button>
                        <Button type="submit" name="status" value="needs_customer_input" outline>
                          Request more data
                        </Button>
                      </div>
                    </form>
                    <form action={mergeFindingAction} className="grid gap-2 border-t border-zinc-950/10 pt-3 dark:border-white/10">
                      <input type="hidden" name="sourceFindingId" value={finding.id} />
                      <Input name="targetFindingId" aria-label={`Merge target for ${finding.title}`} placeholder="Target finding ID" required />
                      <Textarea name="note" aria-label={`Merge note for ${finding.title}`} placeholder="Merge note" />
                      <div>
                        <Button type="submit" outline>
                          Merge
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

      <Subheading className="mt-12">Audit log</Subheading>
      {auditEvents.length === 0 ? (
        <Text className="mt-4">No audit events have been recorded yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Time</TableHeader>
              <TableHeader>Action</TableHeader>
              <TableHeader>Actor</TableHeader>
              <TableHeader>Target</TableHeader>
              <TableHeader>Detail</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {auditEvents.slice(0, 20).map((event) => (
              <TableRow key={event.id}>
                <TableCell>{new Date(event.createdAt).toLocaleString('en-IE')}</TableCell>
                <TableCell>{event.action.replaceAll('_', ' ')}</TableCell>
                <TableCell>{event.actorId}</TableCell>
                <TableCell>
                  <div>{event.targetType.replaceAll('_', ' ')}</div>
                  <div className="text-zinc-500">{event.targetId}</div>
                </TableCell>
                <TableCell className="text-zinc-500">{summarizeAuditMetadata(event.metadata)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function formatMinorCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

function summarizeAuditMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata)

  if (entries.length === 0) {
    return 'No metadata'
  }

  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

function buildRunCards({
  auditEvents,
  contractTerms,
  findings,
  parsedRecords,
  workspace,
}: {
  auditEvents: AuditLogEvent[]
  contractTerms: ContractTerm[]
  findings: Array<{ status: string }>
  parsedRecords: ParsedRecord[]
  workspace: AuditWorkspace
}) {
  const hasReconciliationRun = auditEvents.some((event) => event.action === 'check_run')

  return [
    {
      id: `${workspace.id}-reconciliation`,
      name: `${workspace.auditPeriod} reconciliation`,
      status: findings.length > 0 ? 'reviewing' : hasReconciliationRun ? 'complete' : 'needs_review',
      records: parsedRecords.length.toLocaleString('en-IE'),
      findings: findings.length,
    },
    {
      id: `${workspace.id}-contract-terms`,
      name: `${workspace.auditPeriod} contract term extraction`,
      status: contractTerms.length > 0 && contractTerms.every((term) => term.status === 'approved') ? 'complete' : 'needs_review',
      records: `${contractTerms.length.toLocaleString('en-IE')} terms`,
      findings: contractTerms.filter((term) => term.status !== 'approved').length,
    },
  ]
}

function findingCustomerLabel(finding: { customerId?: string; metadata: Record<string, unknown> }) {
  const customerName = finding.metadata.customerName

  return typeof customerName === 'string' && customerName.trim().length > 0 ? customerName : finding.customerId ?? 'Account not identified'
}

function statusColor(status: string): BadgeColor {
  if (status === 'accepted' || status === 'approved' || status === 'approved_internal' || status === 'published' || status === 'complete') return 'green'
  if (
    status === 'needs_review' ||
    status === 'needs_customer_input' ||
    status === 'needs_clarification' ||
    status === 'reviewing' ||
    status === 'completed_with_errors' ||
    status === 'in_progress'
  )
    return 'amber'
  if (status === 'draft' || status === 'duplicate' || status === 'unsupported') return 'blue'
  if (status === 'missing' || status === 'rejected' || status === 'failed' || status === 'critical' || status === 'high') return 'red'
  return 'zinc'
}

function isDraftReviewFinding(finding: { status: string }) {
  return finding.status === 'draft' || finding.status === 'needs_review' || finding.status === 'needs_customer_input'
}

function matchesFindingFilters(
  finding: Finding,
  filters: {
    status: Finding['status'] | 'all'
    severity: Finding['severity'] | 'all'
    category: Finding['category'] | 'all'
  },
) {
  return (
    (filters.status === 'all' || finding.status === filters.status) &&
    (filters.severity === 'all' || finding.severity === filters.severity) &&
    (filters.category === 'all' || finding.category === filters.category)
  )
}

function readFilter<T extends string>(value: string | string[] | undefined, options: readonly T[]): T | 'all' {
  const candidate = Array.isArray(value) ? value[0] : value

  return candidate && (options as readonly string[]).includes(candidate) ? (candidate as T) : 'all'
}

function formatFilterLabel(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function isAttentionUploadItem(item: { status: string; required: boolean; files: number }) {
  return item.status !== 'accepted' && (item.required || item.files > 0)
}

function MappingCount({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 p-3 dark:border-white/10">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">{values.length}</div>
      {values.length > 0 ? <div className="mt-1 truncate text-sm/6 text-zinc-500 dark:text-zinc-400">{values.slice(0, 3).join(', ')}</div> : null}
    </div>
  )
}

function usageCsvMappingFields(upload: { metadata: Record<string, unknown> }) {
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

function usageMappingValue(upload: { metadata: Record<string, unknown> }, key: string, fallback: string) {
  return uploadMappingValue(upload, 'usageCsvMapping', key, fallback)
}

function providerCostCsvMappingFields(upload: { metadata: Record<string, unknown> }) {
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

function providerCostMappingValue(upload: { metadata: Record<string, unknown> }, key: string, fallback: string) {
  return uploadMappingValue(upload, 'providerCostCsvMapping', key, fallback)
}

function uploadMappingValue(upload: { metadata: Record<string, unknown> }, metadataKey: string, key: string, fallback: string) {
  const mapping = upload.metadata[metadataKey]

  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
    return fallback
  }

  const value = (mapping as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : fallback
}

function formatUsageMapping(mapping: AccountMapping) {
  return [mapping.usageAccountId, mapping.usageCustomerId, mapping.usageCustomerName].filter(Boolean).join(' · ') || 'n/a'
}

function formatStripeMapping(mapping: AccountMapping) {
  return [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(Boolean).join(' · ') || 'n/a'
}

function contractTermToParsedRecord(term: ContractTerm): ParsedRecord {
  return {
    id: term.id,
    organizationId: term.organizationId,
    workspaceId: term.workspaceId,
    jobId: 'contract_terms',
    uploadId: term.evidence?.sourceFileId ?? 'contract_terms',
    sourceFileId: term.evidence?.sourceFileId ?? 'contract_terms',
    recordType: 'contract_term' as ParsedRecord['recordType'],
    data: term,
  }
}

function formatParsedRecordLocation(record: ParsedRecord): string {
  const sourceRef = firstSourceRef(record)
  const parts = [
    typeof sourceRef?.page === 'number' ? `page ${sourceRef.page}` : undefined,
    typeof record.sourceRowNumber === 'number'
      ? `row ${record.sourceRowNumber}`
      : typeof sourceRef?.rowNumber === 'number'
        ? `row ${sourceRef.rowNumber}`
        : undefined,
    typeof sourceRef?.column === 'string' ? `column ${sourceRef.column}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.length > 0 ? parts.join(' · ') : 'location n/a'
}

function firstSourceRef(record: ParsedRecord): { rowNumber?: number; page?: number; column?: string } | undefined {
  const sourceRefs = record.data.sourceRefs

  if (Array.isArray(sourceRefs)) {
    const firstRef = sourceRefs[0]

    if (typeof firstRef === 'object' && firstRef !== null) {
      return firstRef as { rowNumber?: number; page?: number; column?: string }
    }
  }

  const evidence = record.data.evidence

  if (typeof evidence === 'object' && evidence !== null && !Array.isArray(evidence)) {
    return evidence as { rowNumber?: number; page?: number; column?: string }
  }

  return undefined
}

function isContractTermSource(category: string) {
  return category === 'contracts_order_forms' || category === 'pricing_docs'
}

function formatContractTermValue(term: ContractTerm) {
  if (term.type === 'overage_rate' || term.type === 'rate') {
    return [term.currency?.toUpperCase(), term.rate, term.unit ? `per ${term.unit.replaceAll('_', ' ')}` : undefined]
      .filter((part) => part !== undefined && part !== '')
      .join(' ')
  }

  if (term.type === 'allowance') {
    return `${term.allowance?.toLocaleString('en-IE') ?? 'n/a'} ${term.unit?.replaceAll('_', ' ') ?? 'units'}`
  }

  if (term.type === 'credit') {
    return `${term.currency?.toUpperCase() ?? ''} ${term.creditAmount?.toLocaleString('en-IE') ?? 'n/a'}`.trim()
  }

  if (term.type === 'minimum') {
    return `${term.currency?.toUpperCase() ?? ''} ${term.minimumAmount?.toLocaleString('en-IE') ?? 'n/a'} minimum`.trim()
  }

  if (term.type === 'discount') {
    return `${term.discountPercent ?? 'n/a'}% discount`
  }

  return typeof term.metadata.summary === 'string' ? term.metadata.summary : 'Special term'
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

function findingsCsvDownloadHref(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/findings/csv`
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
