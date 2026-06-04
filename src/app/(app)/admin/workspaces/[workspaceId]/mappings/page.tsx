import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { getUnmappedAccountReport, type AccountMapping } from '@/lib/audit/account-mapping'
import { statusColor } from '@/lib/audit/demo-workspace'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { type ContractTerm } from '@/lib/audit/schemas'
import { getAccountMappingStore, getContractTermStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'

import { approveAccountMappingAction, saveManualAccountMappingAction, suggestAccountMappingsAction } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function AdminWorkspaceMappingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const [parsedRecords, contractTerms, accountMappings] = await Promise.all([
    getParsedRecordStore().listByWorkspace(workspace.id),
    getContractTermStore().listByWorkspace(workspace.id),
    getAccountMappingStore().listByWorkspace(workspace.id),
  ])
  const unmappedReport = getUnmappedAccountReport([...parsedRecords, ...contractTerms.map(contractTermToParsedRecord)], accountMappings)
  const unmappedTotal =
    unmappedReport.usageAccountIds.length +
    unmappedReport.stripeCustomerIds.length +
    unmappedReport.contractCustomerIds.length +
    unmappedReport.costAccountIds.length
  const unmappedRows = [
    { source: 'Usage account', values: unmappedReport.usageAccountIds },
    { source: 'Stripe customer', values: unmappedReport.stripeCustomerIds },
    { source: 'Contract customer', values: unmappedReport.contractCustomerIds },
    { source: 'Cost account', values: unmappedReport.costAccountIds },
  ]

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to workspace
          </Button>
          <Heading className="mt-6">Account mappings</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Resolve usage, Stripe, contract, and cost account
            identifiers before reconciliation.
          </Text>
        </div>
        <form action={suggestAccountMappingsAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <Button type="submit">Suggest mappings</Button>
        </form>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Summary label="Saved mappings">{plural(accountMappings.length, 'saved mapping')}</Summary>
        <Summary label="Unmapped identifiers">{plural(unmappedTotal, 'unmapped identifier')}</Summary>
        <Summary label="Manual overrides">
          {accountMappings.filter((mapping) => mapping.status === 'manual_override').length.toLocaleString('en-IE')}
        </Summary>
      </div>

      <section className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <Subheading>Unmapped report</Subheading>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MappingCount label="Usage accounts" values={unmappedReport.usageAccountIds} />
            <MappingCount label="Stripe customers" values={unmappedReport.stripeCustomerIds} />
            <MappingCount label="Contract customers" values={unmappedReport.contractCustomerIds} />
            <MappingCount label="Cost accounts" values={unmappedReport.costAccountIds} />
          </div>
        </div>

        <form action={saveManualAccountMappingAction} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          <input type="hidden" name="workspaceId" value={workspace.id} />
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
      </section>

      <Subheading className="mt-12">Unmapped identifiers</Subheading>
      {unmappedTotal === 0 ? (
        <Text className="mt-4">All known account identifiers are mapped for this workspace.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Source</TableHeader>
              <TableHeader>Identifiers</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {unmappedRows
              .filter((row) => row.values.length > 0)
              .map((row) => (
                <TableRow key={row.source}>
                  <TableCell className="font-medium">{row.source}</TableCell>
                  <TableCell>{row.values.join(', ')}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}

      <Subheading className="mt-12">Saved mappings</Subheading>
      {accountMappings.length === 0 ? (
        <Text className="mt-4">No account mappings have been saved for this workspace yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Account</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Usage</TableHeader>
              <TableHeader>Stripe</TableHeader>
              <TableHeader>Contract/cost</TableHeader>
              <TableHeader>Confidence</TableHeader>
              <TableHeader>Review</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {accountMappings.map((mapping) => (
              <TableRow key={mapping.id}>
                <TableCell>
                  <div className="font-medium">{mapping.displayName}</div>
                  <div className="text-zinc-500">{mapping.note ?? (mapping.matchReasons.join(', ') || mapping.source)}</div>
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(mapping.status)}>{mapping.status.replaceAll('_', ' ')}</Badge>
                </TableCell>
                <TableCell>{formatUsageMapping(mapping)}</TableCell>
                <TableCell>{formatStripeMapping(mapping)}</TableCell>
                <TableCell>{formatContractCostMapping(mapping)}</TableCell>
                <TableCell>{Math.round(mapping.confidence * 100)}%</TableCell>
                <TableCell>
                  {mapping.status === 'suggested' ? (
                    <form action={approveAccountMappingAction} className="grid gap-3">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
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
    </>
  )
}

function Summary({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{children}</div>
    </div>
  )
}

function MappingCount({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 p-3 dark:border-white/10">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg/7 font-semibold text-zinc-950 dark:text-white">{values.length}</div>
      {values.length > 0 ? <div className="mt-1 text-sm/6 text-zinc-500 dark:text-zinc-400">{values.slice(0, 4).join(', ')}</div> : null}
    </div>
  )
}

function formatUsageMapping(mapping: AccountMapping) {
  return [mapping.usageAccountId, mapping.usageCustomerId, mapping.usageCustomerName].filter(Boolean).join(' · ') || 'Unmapped'
}

function formatStripeMapping(mapping: AccountMapping) {
  return [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(Boolean).join(' · ') || 'Unmapped'
}

function formatContractCostMapping(mapping: AccountMapping) {
  return [mapping.contractCustomerId, mapping.costAccountId].filter(Boolean).join(' · ') || 'Unmapped'
}

function contractTermToParsedRecord(term: ContractTerm): ParsedRecord {
  return {
    id: `contract_term_${term.id}`,
    organizationId: term.organizationId,
    workspaceId: term.workspaceId,
    jobId: `contract_term_${term.id}`,
    uploadId: term.evidence?.sourceFileId ?? `contract_term_${term.id}`,
    sourceFileId: term.evidence?.sourceFileId ?? `contract_term_${term.id}`,
    recordType: 'contract_term',
    data: term,
  }
}

function plural(count: number, singular: string) {
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-IE')} ${singular}s`
}
