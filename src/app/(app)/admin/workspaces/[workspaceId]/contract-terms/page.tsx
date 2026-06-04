import { notFound } from 'next/navigation'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { statusColor } from '@/lib/audit/demo-workspace'
import {
  compareContractTermsToPricingRules,
  summarizePricingRuleComparisons,
  type PricingRuleComparison,
} from '@/lib/audit/pricing-rule-comparison'
import { type ContractTerm } from '@/lib/audit/schemas'
import { getContractTermStore, getPricingRuleStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireInternalAdmin } from '@/lib/auth/server'

import { createManualContractTermAction, reviewContractTermAction } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function AdminWorkspaceContractTermsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const store = getContractTermStore()
  const contractTerms = await store.listByWorkspace(workspace.id)
  const pricingRules = await getPricingRuleStore().listByWorkspace(workspace.id)
  const pricingComparisons = compareContractTermsToPricingRules(contractTerms, pricingRules)
  const pricingComparisonSummary = summarizePricingRuleComparisons(pricingComparisons)
  const pricingComparisonsByTermId = new Map(pricingComparisons.map((comparison) => [comparison.term.id, comparison]))
  const versionCounts = new Map(
    await Promise.all(contractTerms.map(async (term) => [term.id, (await store.listVersions(term.id)).length] as const)),
  )
  const candidateCount = contractTerms.filter((term) => term.status === 'candidate').length
  const approvedCount = contractTerms.filter((term) => term.status === 'approved').length
  const rejectedCount = contractTerms.filter((term) => term.status === 'rejected').length

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to workspace
          </Button>
          <Heading className="mt-6">Contract terms</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Review extracted allowances, rates, credits,
            discounts, and evidence before reconciliation.
          </Text>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        <Summary label="Terms">{plural(contractTerms.length, 'term')}</Summary>
        <Summary label="Candidates">{plural(candidateCount, 'candidate')}</Summary>
        <Summary label="Approved">{approvedCount === 1 ? '1 approved' : `${approvedCount.toLocaleString('en-IE')} approved`}</Summary>
        <Summary label="Rejected">{rejectedCount === 1 ? '1 rejected' : `${rejectedCount.toLocaleString('en-IE')} rejected`}</Summary>
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-center gap-3">
          <Subheading>Pricing rule comparison</Subheading>
          <Badge color={pricingComparisonSummary.mismatch > 0 || pricingComparisonSummary.missingRule > 0 ? 'amber' : 'green'}>
            {pricingComparisonSummary.matched.toLocaleString('en-IE')} matched · {pricingComparisonSummary.mismatch.toLocaleString('en-IE')}{' '}
            mismatch · {pricingComparisonSummary.missingRule.toLocaleString('en-IE')} missing rule
          </Badge>
        </div>
        <Text className="mt-2">Compare extracted contract terms against the configured workspace pricing rules before approving terms.</Text>
      </section>

      <form action={createManualContractTermAction} className="mt-10 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <input type="hidden" name="workspaceId" value={workspace.id} />
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
          <Select name="billingPeriod" aria-label="Contract billing period" defaultValue="">
            <option value="">Billing period</option>
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
            <option value="annual">annual</option>
            <option value="one_time">one time</option>
            <option value="custom">custom</option>
          </Select>
          <Input name="rate" aria-label="Manual rate" type="number" step="any" placeholder="Rate" />
          <Input name="allowance" aria-label="Manual allowance" type="number" step="any" placeholder="Allowance" />
          <Input name="threshold" aria-label="Manual threshold" type="number" step="any" placeholder="Threshold" />
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

      <Subheading className="mt-12">Review queue</Subheading>
      {contractTerms.length === 0 ? (
        <Text className="mt-4">No candidate contract terms have been extracted for this workspace yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Term</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Confidence</TableHeader>
              <TableHeader>Pricing rule</TableHeader>
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
                  {term.customerId ? <div className="mt-1 text-zinc-400">{term.customerId}</div> : null}
                </TableCell>
                <TableCell>
                  <Badge color={statusColor(term.status)}>{term.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-normal align-top">{formatTermConfidence(term)}</TableCell>
                <TableCell>{formatPricingComparison(pricingComparisonsByTermId.get(term.id))}</TableCell>
                <TableCell>
                  <div className="max-w-sm text-zinc-500">{term.evidence?.snippet ?? 'No snippet captured'}</div>
                  <div className="mt-1 text-zinc-400">
                    {term.evidence?.page ? `Page ${term.evidence.page}` : 'Page n/a'} · {term.evidence?.sourceFileId ?? 'source n/a'}
                  </div>
                </TableCell>
                <TableCell>{plural(versionCounts.get(term.id) ?? 0, 'version')}</TableCell>
                <TableCell>
                  <form action={reviewContractTermAction} className="grid gap-3">
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <input type="hidden" name="termId" value={term.id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input name="rate" aria-label={`Rate for ${term.id}`} type="number" step="any" defaultValue={term.rate?.toString() ?? ''} />
                      <Input
                        name="allowance"
                        aria-label={`Allowance for ${term.id}`}
                        type="number"
                        step="any"
                        defaultValue={term.allowance?.toString() ?? ''}
                      />
                      <Select name="billingPeriod" aria-label={`Billing period for ${term.id}`} defaultValue={term.billingPeriod ?? ''}>
                        <option value="">billing period</option>
                        <option value="monthly">monthly</option>
                        <option value="quarterly">quarterly</option>
                        <option value="annual">annual</option>
                        <option value="one_time">one time</option>
                        <option value="custom">custom</option>
                      </Select>
                      <Input
                        name="threshold"
                        aria-label={`Threshold for ${term.id}`}
                        type="number"
                        step="any"
                        defaultValue={term.threshold?.toString() ?? ''}
                      />
                      <Input
                        name="creditAmount"
                        aria-label={`Credit amount for ${term.id}`}
                        type="number"
                        step="any"
                        defaultValue={term.creditAmount?.toString() ?? ''}
                      />
                      <Input
                        name="minimumAmount"
                        aria-label={`Minimum amount for ${term.id}`}
                        type="number"
                        step="any"
                        defaultValue={term.minimumAmount?.toString() ?? ''}
                      />
                      <Input
                        name="discountPercent"
                        aria-label={`Discount percent for ${term.id}`}
                        type="number"
                        step="any"
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
    </>
  )
}

type EvidenceQualityMetadata = {
  level: 'strong' | 'medium' | 'weak'
  signals: string[]
  missingSignals: string[]
}

function Summary({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{children}</div>
    </div>
  )
}

function formatTermConfidence(term: ContractTerm) {
  const evidenceQuality = getEvidenceQuality(term)

  if (term.confidence === undefined && !evidenceQuality) {
    return <span className="text-zinc-400">Not scored</span>
  }

  return (
    <div className="grid max-w-xs gap-1 break-words">
      {term.confidence !== undefined ? (
        <div className="font-medium text-zinc-950 dark:text-white">{Math.round(term.confidence * 100)}% confidence</div>
      ) : null}
      {evidenceQuality ? (
        <>
          <div>
            <Badge color={evidenceQualityColor(evidenceQuality.level)}>{evidenceQuality.level} evidence</Badge>
          </div>
          <div className="text-zinc-500" title={evidenceQuality.signals.join(', ')}>
            Signals: {evidenceQuality.signals.length.toLocaleString('en-IE')} captured
          </div>
          <div className="text-zinc-500" title={evidenceQuality.missingSignals.join(', ')}>
            Missing: {evidenceQuality.missingSignals.length === 0 ? 'none' : `${evidenceQuality.missingSignals.length.toLocaleString('en-IE')} needs review`}
          </div>
        </>
      ) : null}
    </div>
  )
}

function getEvidenceQuality(term: ContractTerm): EvidenceQualityMetadata | undefined {
  const value = term.metadata.evidenceQuality

  if (!isRecord(value)) {
    return undefined
  }

  const level = value.level

  if (level !== 'strong' && level !== 'medium' && level !== 'weak') {
    return undefined
  }

  return {
    level,
    signals: stringArray(value.signals),
    missingSignals: stringArray(value.missingSignals),
  }
}

function evidenceQualityColor(level: EvidenceQualityMetadata['level']) {
  if (level === 'strong') {
    return 'green'
  }

  if (level === 'medium') {
    return 'amber'
  }

  return 'red'
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatPricingComparison(comparison: PricingRuleComparison | undefined) {
  if (!comparison) {
    return <span className="text-zinc-400">Not compared</span>
  }

  if (comparison.status === 'missing_rule') {
    return (
      <div className="grid gap-1">
        <Badge color="red">No pricing rule</Badge>
        <div className="text-zinc-500">Configure a pricing rule for this extracted term.</div>
      </div>
    )
  }

  return (
    <div className="grid gap-1">
      <Badge color={comparison.status === 'matched' ? 'green' : 'amber'}>
        {comparison.status === 'matched' ? 'Pricing matched' : 'Pricing mismatch'}
      </Badge>
      <div className="text-zinc-500">{comparison.pricingRule?.name}</div>
      {comparison.differences.length > 0 ? (
        <div className="grid gap-1 text-zinc-500">
          {comparison.differences.map((difference) => (
            <div key={difference.field}>
              {formatDifferenceField(difference.field)}: contract {formatDifferenceValue(difference.contractTermValue)} vs rule{' '}
              {formatDifferenceValue(difference.pricingRuleValue)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function formatDifferenceField(field: string) {
  return field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
}

function formatDifferenceValue(value: string | number | undefined) {
  if (typeof value === 'number') {
    return value.toLocaleString('en-IE')
  }

  return value ?? 'blank'
}

function formatContractTermValue(term: ContractTerm) {
  const qualifiers = [term.billingPeriod, term.threshold !== undefined ? `threshold ${term.threshold.toLocaleString('en-IE')}` : undefined].filter(Boolean)
  const suffix = qualifiers.length > 0 ? ` (${qualifiers.join(', ')})` : ''

  if (term.type === 'overage_rate' || term.type === 'rate') {
    return `${[term.rate, term.currency, term.unit ? `per ${term.unit}` : undefined].filter(Boolean).join(' ')}${suffix}`
  }

  if (term.type === 'allowance') {
    return `${term.allowance?.toLocaleString('en-IE') ?? 0} ${term.unit ?? 'units'}${suffix}`
  }

  if (term.type === 'credit') {
    return `${`${term.creditAmount?.toLocaleString('en-IE') ?? 0} ${term.currency ?? ''}`.trim()}${suffix}`
  }

  if (term.type === 'minimum') {
    return `${`${term.minimumAmount?.toLocaleString('en-IE') ?? 0} ${term.currency ?? ''}`.trim()}${suffix}`
  }

  if (term.type === 'discount') {
    return `${term.discountPercent?.toLocaleString('en-IE') ?? 0}%${term.effectiveTo ? ` until ${term.effectiveTo}` : ''}${suffix}`
  }

  return `${typeof term.metadata.summary === 'string' ? term.metadata.summary : 'Special term'}${suffix}`
}

function plural(count: number, singular: string) {
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-IE')} ${singular}s`
}
