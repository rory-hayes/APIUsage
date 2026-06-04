import { dirname } from 'node:path'
import { z } from 'zod'

import { type AccountMapping } from './account-mapping'
import { type ParsedRecord } from './parse-jobs'
import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'
import { resolveRuleTemplateSelection, type RuleTemplateId } from './rule-templates'
import {
  findingSchema,
  normalizedCostSchema,
  normalizedInvoiceLineSchema,
  normalizedSubscriptionSchema,
  normalizedUsageSchema,
  type ContractTerm,
  type Finding,
  type NormalizedCost,
  type NormalizedInvoiceLine,
  type NormalizedSubscription,
  type NormalizedUsage,
} from './schemas'

const reviewStatusSchema = z.enum(['approved_internal', 'rejected', 'needs_review', 'needs_customer_input'])
const findingReviewUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  expectedAmount: z.number().int().optional(),
  actualAmount: z.number().int().optional(),
  recommendedAction: z.string().min(1).optional(),
})

export type FindingReviewUpdates = Partial<
  Pick<Finding, 'title' | 'severity' | 'expectedAmount' | 'actualAmount' | 'recommendedAction'>
>

export type ReconciliationFindingOptions = {
  lateUsageGracePeriodDays?: number
}

export type FindingReviewInput = {
  status: z.infer<typeof reviewStatusSchema>
  reviewerId: string
  internalNote?: string
  customerNote?: string
  updates?: FindingReviewUpdates
}

export function generateReconciliationFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[] = [],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
  ruleTemplateIds?: string[],
  options: ReconciliationFindingOptions = {},
): Finding[] {
  const selectedTemplateIds = new Set(resolveRuleTemplateSelection(ruleTemplateIds).map((template) => template.id))
  const findings: Finding[] = []
  let activeRecords = records
  let recordsReadyForReconciliation = records

  if (selectedTemplateIds.has('cancelled_account_usage')) {
    const cancelledUsageFindings = generateCancelledAccountUsageFindings(records, now, accountMappings)
    findings.push(...cancelledUsageFindings)
    activeRecords = recordsWithoutCancelledUsage(records, cancelledUsageFindings)
    recordsReadyForReconciliation = activeRecords
  }

  if (selectedTemplateIds.has('account_mapping_mismatch')) {
    const accountMappingMismatchFindings = generateAccountMappingMismatchFindings(activeRecords, now, accountMappings)
    findings.push(...accountMappingMismatchFindings)
    recordsReadyForReconciliation = recordsWithoutMappingMismatchEvidence(activeRecords, accountMappingMismatchFindings)
  }

  appendTemplateFindings(findings, selectedTemplateIds, 'usage_without_invoice', () =>
    generateUsageWithoutInvoiceFindings(recordsReadyForReconciliation, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'invoice_without_usage', () =>
    generateInvoiceWithoutUsageFindings(recordsReadyForReconciliation, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'missing_usage', () =>
    generateMissingUsageFindings(recordsReadyForReconciliation, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'late_usage_after_invoice_finalization', () =>
    generateLateUsageAfterInvoiceFinalizationFindings(recordsReadyForReconciliation, now, accountMappings, options),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'duplicate_usage', () => generateDuplicateUsageFindings(recordsReadyForReconciliation, now))
  appendTemplateFindings(findings, selectedTemplateIds, 'internal_usage_billed', () =>
    generateInternalUsageBilledFindings(recordsReadyForReconciliation, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'paid_usage_marked_free', () =>
    generatePaidUsageMarkedFreeFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'wrong_overage_rate', () =>
    generateWrongOverageRateFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'usage_above_allowance', () =>
    generateUsageAboveAllowanceFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'credit_burn_mismatch', () =>
    generateCreditBurnMismatchFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'minimum_not_enforced', () =>
    generateMinimumNotEnforcedFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'expired_discount_active', () =>
    generateExpiredDiscountActiveFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'contract_terms_not_in_billing', () =>
    generateContractTermsNotInBillingFindings(recordsReadyForReconciliation, contractTerms, now, accountMappings),
  )
  appendTemplateFindings(findings, selectedTemplateIds, 'cost_exceeds_revenue', () =>
    generateCostExceedsRevenueFindings(recordsReadyForReconciliation, now, accountMappings),
  )

  return findings
}

function appendTemplateFindings(findings: Finding[], selectedTemplateIds: Set<RuleTemplateId>, templateId: RuleTemplateId, generate: () => Finding[]) {
  if (selectedTemplateIds.has(templateId)) {
    findings.push(...generate())
  }
}

export function generateUsageWithoutInvoiceFindings(records: ParsedRecord[], now = new Date(), accountMappings: AccountMapping[] = []): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)

  return records
    .filter((record) => record.recordType === 'usage')
    .map((record) => ({ parsedRecord: record, parsedUsage: normalizedUsageSchema.safeParse(record.data) }))
    .filter((item): item is { parsedRecord: ParsedRecord; parsedUsage: z.ZodSafeParseSuccess<NormalizedUsage> } => item.parsedUsage.success)
    .map(({ parsedRecord, parsedUsage }) => ({ parsedRecord, usage: parsedUsage.data }))
    .filter(({ usage }) => !getNonBillableUsageReason(usage))
    .filter(({ usage }) => !hasMatchingInvoiceLine(usage, invoiceLines, accountMappings))
    .map(({ parsedRecord, usage }) => createUsageWithoutInvoiceFinding(parsedRecord, usage, now))
}

export function generateInvoiceWithoutUsageFindings(records: ParsedRecord[], now = new Date(), accountMappings: AccountMapping[] = []): Finding[] {
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  if (usages.length === 0) {
    return []
  }

  return records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
    .filter(
      (line) =>
        line.amount > 0 &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        describesBillableUsageInvoice(line) &&
        !hasMatchingUsageRecord(line, usages, accountMappings),
    )
    .map((line) => createInvoiceWithoutUsageFinding(line, now))
}

export function generateMissingUsageFindings(records: ParsedRecord[], now = new Date(), accountMappings: AccountMapping[] = []): Finding[] {
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  if (usages.length === 0) {
    return []
  }

  return records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
    .flatMap((line) => {
      const billedQuantity = getMetadataNumber(line.metadata, ['quantity', 'usageQuantity', 'usage_quantity'])

      if (
        typeof billedQuantity !== 'number' ||
        billedQuantity <= 0 ||
        line.amount <= 0 ||
        line.status === 'void' ||
        line.status === 'uncollectible' ||
        !describesBillableUsageInvoice(line)
      ) {
        return []
      }

      const matchingUsages = usages.filter(
        (usage) =>
          sharesAccountKey(usage, line, accountMappings) &&
          periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
          describesUsage(line, usage),
      )
      const recordedQuantity = matchingUsages.reduce((total, usage) => total + usage.quantity, 0)

      if (matchingUsages.length === 0 || recordedQuantity >= billedQuantity) {
        return []
      }

      const supportedAmount = Math.round(line.amount * (recordedQuantity / billedQuantity))

      return [
        createMissingUsageFinding({
          line,
          matchingUsages,
          billedQuantity,
          recordedQuantity,
          supportedAmount,
          now,
        }),
      ]
    })
}

export function generateLateUsageAfterInvoiceFinalizationFindings(
  records: ParsedRecord[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
  options: ReconciliationFindingOptions = {},
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)

  return records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)
    .flatMap((usage) => {
      const usageArrivedAt = getUsageArrivedAt(usage)
      const gracePeriodDays = normalizeGracePeriodDays(options.lateUsageGracePeriodDays)

      if (!usageArrivedAt) {
        return []
      }

      const matchingInvoiceLines = invoiceLines.filter((line) => {
        const invoiceFinalizedAt = getInvoiceFinalizedAt(line)

        return (
          Boolean(invoiceFinalizedAt) &&
          usageArrivedAfterGraceWindow(usageArrivedAt, invoiceFinalizedAt as string, gracePeriodDays) &&
          line.status !== 'void' &&
          line.status !== 'uncollectible' &&
          sharesAccountKey(usage, line, accountMappings) &&
          periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
          describesUsage(line, usage)
        )
      })

      if (matchingInvoiceLines.length === 0) {
        return []
      }

      return [createLateUsageAfterInvoiceFinalizationFinding({ usage, matchingInvoiceLines, usageArrivedAt, now })]
    })
}

export function generateDuplicateUsageFindings(records: ParsedRecord[], now = new Date()): Finding[] {
  const duplicateGroups = new Map<string, NormalizedUsage[]>()

  records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)
    .forEach((usage) => {
      const key = duplicateUsageKey(usage)
      const group = duplicateGroups.get(key) ?? []

      duplicateGroups.set(key, [...group, usage])
    })

  return [...duplicateGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => createDuplicateUsageFinding(group, now))
}

export function generateAccountMappingMismatchFindings(
  records: ParsedRecord[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  return accountMappings
    .filter((mapping) => mapping.status === 'suggested')
    .flatMap((mapping) =>
      usages
        .filter((usage) => mappingMatchesUsage(mapping, usage))
        .flatMap((usage) => {
          const matchingInvoiceLines = invoiceLines.filter(
            (line) =>
              line.amount > 0 &&
              line.status !== 'void' &&
              line.status !== 'uncollectible' &&
              mappingMatchesInvoiceLine(mapping, line) &&
              periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
              describesUsage(line, usage),
          )

          if (matchingInvoiceLines.length === 0) {
            return []
          }

          return [createAccountMappingMismatchFinding({ mapping, usage, matchingInvoiceLines, now })]
        }),
    )
}

export function generateInternalUsageBilledFindings(
  records: ParsedRecord[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)

  return records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)
    .flatMap((usage) => {
      const nonBillableReason = getNonBillableUsageReason(usage)

      if (!nonBillableReason) {
        return []
      }

      const matchingInvoiceLines = invoiceLines.filter(
        (line) =>
          line.amount > 0 &&
          line.status !== 'void' &&
          line.status !== 'uncollectible' &&
          sharesAccountKey(usage, line, accountMappings) &&
          periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
          describesUsage(line, usage),
      )
      const billedAmount = matchingInvoiceLines.reduce((total, line) => total + line.amount, 0)

      if (billedAmount <= 0) {
        return []
      }

      return [
        createInternalUsageBilledFinding({
          usage,
          matchingInvoiceLines,
          billedAmount,
          nonBillableReason,
          now,
        }),
      ]
    })
}

export function generatePaidUsageMarkedFreeFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  return usages.flatMap((usage) => {
    const nonBillableReason = getNonBillableUsageReason(usage)

    if (!nonBillableReason) {
      return []
    }

    const paidRateTerm = findPaidRateTerm(usage, contractTerms, accountMappings)

    if (!paidRateTerm || typeof paidRateTerm.rate !== 'number' || !paidRateTerm.currency) {
      return []
    }

    const matchingInvoiceLines = invoiceLines.filter(
      (line) =>
        line.amount > 0 &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        sharesAccountKey(usage, line, accountMappings) &&
        periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
        describesUsage(line, usage),
    )

    if (matchingInvoiceLines.length > 0) {
      return []
    }

    const expectedAmount = Math.round(usage.quantity * paidRateTerm.rate * 100)

    if (expectedAmount <= 0) {
      return []
    }

    return [
      createPaidUsageMarkedFreeFinding({
        usage,
        paidRateTerm,
        expectedAmount,
        nonBillableReason,
        now,
      }),
    ]
  })
}

export function generateUsageAboveAllowanceFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  return usages.flatMap((usage) => {
    const allowanceTerm = findAllowanceTerm(usage, contractTerms, accountMappings)

    if (!allowanceTerm?.allowance || usage.quantity <= allowanceTerm.allowance + allowanceThreshold(allowanceTerm)) {
      return []
    }

    const overageRateTerm = findOverageRateTerm(usage, contractTerms, accountMappings)

    if (typeof overageRateTerm?.rate !== 'number' || !overageRateTerm.currency) {
      return []
    }

    const expectedRate = overageRateTerm.rate
    const currency = overageRateTerm.currency
    const overageQuantity = usage.quantity - allowanceTerm.allowance
    const expectedAmount = Math.round(overageQuantity * expectedRate * 100)
    const matchingInvoiceLines = invoiceLines.filter(
      (line) =>
        line.currency === currency &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        sharesAccountKey(usage, line, accountMappings) &&
        periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
        describesOverageBilling(line, usage),
    )
    const actualAmount = matchingInvoiceLines.reduce((total, line) => total + line.amount, 0)

    if (hasWrongOverageRateEvidence(matchingInvoiceLines, expectedRate)) {
      return []
    }

    if (actualAmount >= expectedAmount) {
      return []
    }

    return [
      createUsageAboveAllowanceFinding({
        usage,
        allowanceTerm,
        overageRateTerm,
        matchingInvoiceLines,
        expectedAmount,
        actualAmount,
        overageQuantity,
        now,
      }),
    ]
  })
}

export function generateWrongOverageRateFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  return usages.flatMap((usage) => {
    const allowanceTerm = findAllowanceTerm(usage, contractTerms, accountMappings)

    if (!allowanceTerm?.allowance || usage.quantity <= allowanceTerm.allowance + allowanceThreshold(allowanceTerm)) {
      return []
    }

    const overageRateTerm = findOverageRateTerm(usage, contractTerms, accountMappings)

    if (typeof overageRateTerm?.rate !== 'number' || !overageRateTerm.currency) {
      return []
    }

    const expectedRate = overageRateTerm.rate
    const currency = overageRateTerm.currency
    const matchingInvoiceLines = invoiceLines.filter(
      (line) =>
        line.currency === currency &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        sharesAccountKey(usage, line, accountMappings) &&
        periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
        describesOverageBilling(line, usage),
    )
    const wrongRateLine = matchingInvoiceLines.find((line) => {
      const actualRate = getInvoiceUnitRate(line)

      return typeof actualRate === 'number' && !ratesEqual(actualRate, expectedRate)
    })

    if (!wrongRateLine) {
      return []
    }

    const overageQuantity = usage.quantity - allowanceTerm.allowance
    const expectedAmount = Math.round(overageQuantity * expectedRate * 100)
    const actualAmount = matchingInvoiceLines.reduce((total, line) => total + line.amount, 0)

    return [
      createWrongOverageRateFinding({
        usage,
        allowanceTerm,
        overageRateTerm,
        matchingInvoiceLines: [wrongRateLine],
        expectedAmount,
        actualAmount,
        overageQuantity,
        actualRate: getInvoiceUnitRate(wrongRateLine) as number,
        now,
      }),
    ]
  })
}

export function generateCreditBurnMismatchFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const creditTerms = contractTerms.filter(
    (term) => term.status === 'approved' && term.type === 'credit' && typeof term.creditAmount === 'number' && Boolean(term.currency),
  )

  return creditTerms.flatMap((creditTerm) => {
    const matchingInvoiceLines = invoiceLines.filter(
      (line) =>
        line.currency === creditTerm.currency &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        describesCreditTreatment(line) &&
        matchesCreditTerm(line, creditTerm, accountMappings) &&
        termCoversInvoiceLinePeriod(creditTerm, line),
    )
    const actualCreditAmount = matchingInvoiceLines.reduce((total, line) => total + getInvoiceCreditAmount(line), 0)
    const expectedCreditAmount = creditTerm.creditAmount ?? 0

    if (actualCreditAmount === expectedCreditAmount) {
      return []
    }

    return [
      createCreditBurnMismatchFinding({
        creditTerm,
        matchingInvoiceLines,
        expectedCreditAmount,
        actualCreditAmount,
        now,
      }),
    ]
  })
}

export function generateMinimumNotEnforcedFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)

  if (invoiceLines.length === 0) {
    return []
  }

  const minimumTerms = contractTerms.filter(
    (term) => term.status === 'approved' && term.type === 'minimum' && typeof term.minimumAmount === 'number' && Boolean(term.currency),
  )

  return minimumTerms.flatMap((minimumTerm) => {
    const matchingInvoiceLines = invoiceLines.filter(
      (line) =>
        line.currency === minimumTerm.currency &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        matchesInvoiceContractTerm(line, minimumTerm, accountMappings) &&
        termCoversInvoiceLinePeriod(minimumTerm, line),
    )
    const revenueAmount = matchingInvoiceLines.reduce((total, line) => total + line.amount, 0)
    const expectedMinimumAmount = minimumTerm.minimumAmount ?? 0

    if (revenueAmount >= expectedMinimumAmount) {
      return []
    }

    return [
      createMinimumNotEnforcedFinding({
        minimumTerm,
        matchingInvoiceLines,
        expectedMinimumAmount,
        revenueAmount,
        now,
      }),
    ]
  })
}

export function generateExpiredDiscountActiveFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const discountTerms = contractTerms.filter(
    (term) =>
      term.status === 'approved' &&
      term.type === 'discount' &&
      typeof term.discountPercent === 'number' &&
      typeof term.effectiveTo === 'string',
  )

  return discountTerms.flatMap((discountTerm) => {
    const expiredDiscountLines = invoiceLines.filter(
      (line) =>
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        matchesInvoiceContractTerm(line, discountTerm, accountMappings) &&
        discountExpiredForInvoiceLine(discountTerm, line) &&
        describesDiscountTreatment(line) &&
        getInvoiceDiscountAmount(line) > 0,
    )

    return expiredDiscountLines.map((line) =>
      createExpiredDiscountActiveFinding({
        discountTerm,
        invoiceLine: line,
        discountAmount: getInvoiceDiscountAmount(line),
        now,
      }),
    )
  })
}

export function generateContractTermsNotInBillingFindings(
  records: ParsedRecord[],
  contractTerms: ContractTerm[],
  now = new Date(),
  accountMappings: AccountMapping[] = [],
): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)

  if (invoiceLines.length === 0) {
    return []
  }

  return contractTerms
    .filter((term) => term.status === 'approved' && Boolean(term.customerId) && contractTermRequiresBilling(term))
    .filter((term) => !hasBillingEvidenceForContractTerm(term, invoiceLines, accountMappings))
    .map((term) => createContractTermsNotInBillingFinding(term, now))
}

export function generateCostExceedsRevenueFindings(records: ParsedRecord[], now = new Date(), accountMappings: AccountMapping[] = []): Finding[] {
  const invoiceLines = records
    .filter((record) => record.recordType === 'invoice_line')
    .map((record) => normalizedInvoiceLineSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedInvoiceLine> => result.success)
    .map((result) => result.data)
  const costs = records
    .filter((record) => record.recordType === 'cost')
    .map((record) => normalizedCostSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedCost> => result.success)
    .map((result) => result.data)

  return costs.flatMap((cost) => {
    const matchingInvoiceLines = invoiceLines.filter(
      (line) =>
        line.currency === cost.currency &&
        line.status !== 'void' &&
        line.status !== 'uncollectible' &&
        sharesCostInvoiceKey(cost, line, accountMappings) &&
        periodsOverlap(cost.periodStart, cost.periodEnd, line.periodStart, line.periodEnd),
    )
    const revenueAmount = matchingInvoiceLines.reduce((total, line) => total + line.amount, 0)

    if (revenueAmount >= cost.costAmount) {
      return []
    }

    return [
      createCostExceedsRevenueFinding({
        cost,
        matchingInvoiceLines,
        revenueAmount,
        now,
      }),
    ]
  })
}

export function generateCancelledAccountUsageFindings(records: ParsedRecord[], now = new Date(), accountMappings: AccountMapping[] = []): Finding[] {
  const subscriptions = records
    .filter((record) => record.recordType === 'subscription')
    .map((record) => normalizedSubscriptionSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedSubscription> => result.success)
    .map((result) => result.data)
  const usages = records
    .filter((record) => record.recordType === 'usage')
    .map((record) => normalizedUsageSchema.safeParse(record.data))
    .filter((result): result is z.ZodSafeParseSuccess<NormalizedUsage> => result.success)
    .map((result) => result.data)

  return usages.flatMap((usage) => {
    const cancelledSubscription = subscriptions.find(
      (subscription) =>
        isCancelledSubscription(subscription) &&
        usageContinuedAfterCancellation(usage, subscription) &&
        sharesUsageSubscriptionKey(usage, subscription, accountMappings),
    )

    if (!cancelledSubscription) {
      return []
    }

    return [
      createCancelledAccountUsageFinding({
        usage,
        subscription: cancelledSubscription,
        cancellationEffectiveAt: cancellationEffectiveAt(cancelledSubscription),
        now,
      }),
    ]
  })
}

export function reviewFinding(finding: Finding, review: FindingReviewInput, now = new Date()): Finding {
  const status = reviewStatusSchema.parse(review.status)
  const parsedUpdates = findingReviewUpdateSchema.parse(review.updates ?? {})
  const updates = stripUndefined(parsedUpdates)
  const shouldRecalculateVariance = updates.expectedAmount !== undefined || updates.actualAmount !== undefined

  return findingSchema.parse({
    ...finding,
    ...updates,
    varianceAmount: shouldRecalculateVariance ? undefined : finding.varianceAmount,
    status,
    reviewerId: review.reviewerId,
    internalNote: appendNote(finding.internalNote, review.internalNote),
    customerNote: status === 'rejected' ? undefined : trimToUndefined(review.customerNote) ?? finding.customerNote,
    metadata: {
      ...finding.metadata,
      reviewedAt: now.toISOString(),
    },
  })
}

function stripUndefined(input: FindingReviewUpdates): FindingReviewUpdates {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as FindingReviewUpdates
}

export class JsonFindingStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<Finding[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(findingSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async listByWorkspace(workspaceId: string): Promise<Finding[]> {
    const findings = await this.list()

    return findings.filter((finding) => finding.workspaceId === workspaceId)
  }

  async saveMany(findings: Finding[]): Promise<void> {
    const existing = await this.list()
    const nextById = new Map(existing.map((finding) => [finding.id, finding]))

    for (const finding of findings) {
      nextById.set(finding.id, finding)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async replaceDraftsForWorkspace(workspaceId: string, findings: Finding[]): Promise<void> {
    const existing = await this.list()
    const reviewedOrOtherWorkspace = existing.filter((finding) => finding.workspaceId !== workspaceId || finding.status !== 'draft')
    const nextById = new Map(reviewedOrOtherWorkspace.map((finding) => [finding.id, finding]))

    for (const finding of findings) {
      nextById.set(finding.id, finding)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify([...nextById.values()], null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const findings = await this.list()
    const next = findings.filter((finding) => finding.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return findings.length - next.length
  }
}

function hasMatchingInvoiceLine(usage: NormalizedUsage, invoiceLines: NormalizedInvoiceLine[], accountMappings: AccountMapping[]): boolean {
  return invoiceLines.some((line) => {
    if (line.status === 'void' || line.status === 'uncollectible') {
      return false
    }

    return (
      sharesAccountKey(usage, line, accountMappings) &&
      periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) &&
      describesUsage(line, usage)
    )
  })
}

function hasMatchingUsageRecord(line: NormalizedInvoiceLine, usages: NormalizedUsage[], accountMappings: AccountMapping[]): boolean {
  return usages.some(
    (usage) => sharesAccountKey(usage, line, accountMappings) && periodsOverlap(usage.periodStart, usage.periodEnd, line.periodStart, line.periodEnd) && describesUsage(line, usage),
  )
}

function duplicateUsageKey(usage: NormalizedUsage): string {
  return [
    usage.workspaceId,
    normalizeKey(usage.accountId ?? ''),
    normalizeKey(usage.customerId ?? ''),
    normalizeKey(usage.customerName ?? ''),
    normalizeKey(usage.meter),
    normalizeKey(usage.unit),
    usage.quantity.toString(),
    usage.periodStart,
    usage.periodEnd,
  ].join('|')
}

function sharesAccountKey(usage: NormalizedUsage, line: NormalizedInvoiceLine, accountMappings: AccountMapping[]): boolean {
  const usageKeys = [usage.customerId, usage.accountId, usage.customerName].filter(isPresent).map(normalizeKey)
  const invoiceKeys = [line.customerId, line.externalCustomerId, line.customerEmail].filter(isPresent).map(normalizeKey)

  if (usageKeys.some((usageKey) => invoiceKeys.includes(usageKey))) {
    return true
  }

  return accountMappings.filter(isApprovedMapping).some((mapping) => {
    const mappedUsageKeys = [mapping.usageAccountId, mapping.usageCustomerId, mapping.usageCustomerName].filter(isPresent).map(normalizeKey)
    const mappedInvoiceKeys = [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(isPresent).map(normalizeKey)

    return usageKeys.some((usageKey) => mappedUsageKeys.includes(usageKey)) && invoiceKeys.some((invoiceKey) => mappedInvoiceKeys.includes(invoiceKey))
  })
}

function mappingMatchesUsage(mapping: AccountMapping, usage: NormalizedUsage): boolean {
  const usageKeys = [usage.customerId, usage.accountId, usage.customerName].filter(isPresent).map(normalizeKey)
  const mappingKeys = [mapping.usageCustomerId, mapping.usageAccountId, mapping.usageCustomerName].filter(isPresent).map(normalizeKey)

  return usageKeys.some((usageKey) => mappingKeys.includes(usageKey))
}

function mappingMatchesInvoiceLine(mapping: AccountMapping, line: NormalizedInvoiceLine): boolean {
  const invoiceKeys = [line.customerId, line.externalCustomerId, line.customerEmail].filter(isPresent).map(normalizeKey)
  const mappingKeys = [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(isPresent).map(normalizeKey)

  return invoiceKeys.some((invoiceKey) => mappingKeys.includes(invoiceKey))
}

function sharesCostInvoiceKey(cost: NormalizedCost, line: NormalizedInvoiceLine, accountMappings: AccountMapping[]): boolean {
  const costKeys = [cost.customerId, cost.accountId, cost.customerName].filter(isPresent).map(normalizeKey)
  const invoiceKeys = [line.customerId, line.externalCustomerId, line.customerEmail].filter(isPresent).map(normalizeKey)

  if (costKeys.some((costKey) => invoiceKeys.includes(costKey))) {
    return true
  }

  return accountMappings.filter(isApprovedMapping).some((mapping) => {
    const mappedCostKeys = [mapping.costAccountId].filter(isPresent).map(normalizeKey)
    const mappedInvoiceKeys = [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(isPresent).map(normalizeKey)

    return costKeys.some((costKey) => mappedCostKeys.includes(costKey)) && invoiceKeys.some((invoiceKey) => mappedInvoiceKeys.includes(invoiceKey))
  })
}

function sharesUsageSubscriptionKey(usage: NormalizedUsage, subscription: NormalizedSubscription, accountMappings: AccountMapping[]): boolean {
  const usageKeys = [usage.customerId, usage.accountId, usage.customerName].filter(isPresent).map(normalizeKey)
  const subscriptionKeys = [subscription.customerId, subscription.externalCustomerId, subscription.customerEmail].filter(isPresent).map(normalizeKey)

  if (usageKeys.some((usageKey) => subscriptionKeys.includes(usageKey))) {
    return true
  }

  return accountMappings.filter(isApprovedMapping).some((mapping) => {
    const mappedUsageKeys = [mapping.usageAccountId, mapping.usageCustomerId, mapping.usageCustomerName].filter(isPresent).map(normalizeKey)
    const mappedStripeKeys = [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(isPresent).map(normalizeKey)

    return usageKeys.some((usageKey) => mappedUsageKeys.includes(usageKey)) && subscriptionKeys.some((subscriptionKey) => mappedStripeKeys.includes(subscriptionKey))
  })
}

function matchesCreditTerm(line: NormalizedInvoiceLine, term: ContractTerm, accountMappings: AccountMapping[]): boolean {
  return matchesInvoiceContractTerm(line, term, accountMappings)
}

function matchesInvoiceContractTerm(line: NormalizedInvoiceLine, term: ContractTerm, accountMappings: AccountMapping[]): boolean {
  if (!term.customerId) {
    return false
  }

  const invoiceKeys = [line.customerId, line.externalCustomerId, line.customerEmail].filter(isPresent).map(normalizeKey)
  const termKeys = [term.customerId].filter(isPresent).map(normalizeKey)

  if (invoiceKeys.some((invoiceKey) => termKeys.includes(invoiceKey))) {
    return true
  }

  return accountMappings.filter(isApprovedMapping).some((mapping) => {
    const mappedInvoiceKeys = [mapping.stripeCustomerId, mapping.stripeCustomerEmail].filter(isPresent).map(normalizeKey)
    const mappedContractKeys = [mapping.contractCustomerId].filter(isPresent).map(normalizeKey)

    return invoiceKeys.some((invoiceKey) => mappedInvoiceKeys.includes(invoiceKey)) && termKeys.some((termKey) => mappedContractKeys.includes(termKey))
  })
}

function findAllowanceTerm(usage: NormalizedUsage, contractTerms: ContractTerm[], accountMappings: AccountMapping[]): ContractTerm | undefined {
  return contractTerms.find(
    (term) =>
      term.status === 'approved' &&
      term.type === 'allowance' &&
      typeof term.allowance === 'number' &&
      matchesUsageTerm(usage, term, accountMappings) &&
      matchesMeterAndUnit(usage, term) &&
      termCoversUsagePeriod(term, usage),
  )
}

function findOverageRateTerm(usage: NormalizedUsage, contractTerms: ContractTerm[], accountMappings: AccountMapping[]): ContractTerm | undefined {
  return contractTerms.find(
    (term) =>
      term.status === 'approved' &&
      term.type === 'overage_rate' &&
      typeof term.rate === 'number' &&
      matchesUsageTerm(usage, term, accountMappings) &&
      matchesMeterAndUnit(usage, term) &&
      termCoversUsagePeriod(term, usage),
  )
}

function findPaidRateTerm(usage: NormalizedUsage, contractTerms: ContractTerm[], accountMappings: AccountMapping[]): ContractTerm | undefined {
  return contractTerms.find(
    (term) =>
      term.status === 'approved' &&
      term.type === 'rate' &&
      typeof term.rate === 'number' &&
      Boolean(term.currency) &&
      matchesUsageTerm(usage, term, accountMappings) &&
      matchesMeterAndUnit(usage, term) &&
      termCoversUsagePeriod(term, usage),
  )
}

function matchesUsageTerm(usage: NormalizedUsage, term: ContractTerm, accountMappings: AccountMapping[]): boolean {
  if (!term.customerId) {
    return false
  }

  const usageKeys = [usage.customerId, usage.accountId, usage.customerName].filter(isPresent).map(normalizeKey)
  const termKeys = [term.customerId].filter(isPresent).map(normalizeKey)

  if (usageKeys.some((usageKey) => termKeys.includes(usageKey))) {
    return true
  }

  return accountMappings.filter(isApprovedMapping).some((mapping) => {
    const mappedUsageKeys = [mapping.usageAccountId, mapping.usageCustomerId, mapping.usageCustomerName].filter(isPresent).map(normalizeKey)
    const mappedContractKeys = [mapping.contractCustomerId].filter(isPresent).map(normalizeKey)

    return usageKeys.some((usageKey) => mappedUsageKeys.includes(usageKey)) && termKeys.some((termKey) => mappedContractKeys.includes(termKey))
  })
}

function matchesMeterAndUnit(usage: NormalizedUsage, term: ContractTerm): boolean {
  const meterMatches = !term.meter || normalizeKey(term.meter) === normalizeKey(usage.meter)
  const unitMatches = !term.unit || normalizeKey(term.unit) === normalizeKey(usage.unit)

  return meterMatches && unitMatches
}

function allowanceThreshold(term: ContractTerm): number {
  return term.threshold ?? 0
}

function termCoversUsagePeriod(term: ContractTerm, usage: NormalizedUsage): boolean {
  const usageStart = usage.periodStart.slice(0, 10)
  const usageEnd = usage.periodEnd.slice(0, 10)

  return (!term.effectiveFrom || term.effectiveFrom <= usageEnd) && (!term.effectiveTo || term.effectiveTo >= usageStart)
}

function termCoversInvoiceLinePeriod(term: ContractTerm, line: NormalizedInvoiceLine): boolean {
  const lineStart = line.periodStart.slice(0, 10)
  const lineEnd = line.periodEnd.slice(0, 10)

  return (!term.effectiveFrom || term.effectiveFrom <= lineEnd) && (!term.effectiveTo || term.effectiveTo >= lineStart)
}

function createUsageWithoutInvoiceFinding(parsedRecord: ParsedRecord, usage: NormalizedUsage, now: Date): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_usage_exists_no_invoice_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'usage_exists_no_invoice',
    severity: 'medium',
    title: 'Billable usage has no matching invoice line',
    expectedAmount: 0,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.72,
    evidenceRefs: [{ type: 'usage_record', sourceId: usage.id }],
    recommendedAction: 'Review billing configuration and confirm whether this usage should appear on the May invoice.',
    internalNote: `Generated from parsed record ${parsedRecord.id}. Amount impact needs pricing or contract terms before publishing.`,
    metadata: {
      checkId: 'usage_without_invoice',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      quantity: usage.quantity,
      unit: usage.unit,
      ranAt: now.toISOString(),
    },
  })
}

function createInvoiceWithoutUsageFinding(line: NormalizedInvoiceLine, now: Date): Finding {
  const accountKey = line.externalCustomerId ?? line.customerId ?? line.customerEmail ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${line.workspaceId}_invoice_without_usage_${slug(accountKey)}_${periodSlug(line.periodStart)}`,
    organizationId: line.organizationId,
    workspaceId: line.workspaceId,
    customerId: line.customerId ?? line.externalCustomerId,
    category: 'invoice_without_usage',
    severity: 'medium',
    title: 'Usage invoice line has no matching usage record',
    expectedAmount: 0,
    actualAmount: line.amount,
    currency: line.currency,
    confidence: 0.74,
    evidenceRefs: [{ type: 'invoice_line', sourceId: line.id }],
    recommendedAction: 'Confirm whether this usage charge has source usage evidence or should be adjusted before close.',
    internalNote: `Invoice line ${line.id} appears to bill usage, but no matching usage record was found.`,
    metadata: {
      checkId: 'invoice_without_usage',
      accountKey,
      invoiceId: line.invoiceId,
      description: line.description,
      ...periodMetadata(line.periodStart, line.periodEnd),
      billedAmount: line.amount,
      ranAt: now.toISOString(),
    },
  })
}

function createMissingUsageFinding({
  line,
  matchingUsages,
  billedQuantity,
  recordedQuantity,
  supportedAmount,
  now,
}: {
  line: NormalizedInvoiceLine
  matchingUsages: NormalizedUsage[]
  billedQuantity: number
  recordedQuantity: number
  supportedAmount: number
  now: Date
}): Finding {
  const accountKey = line.externalCustomerId ?? line.customerId ?? line.customerEmail ?? 'unknown_account'
  const firstUsage = matchingUsages[0]
  const unsupportedQuantity = billedQuantity - recordedQuantity

  return findingSchema.parse({
    id: `finding_${line.workspaceId}_missing_usage_${slug(accountKey)}_${periodSlug(line.periodStart)}`,
    organizationId: line.organizationId,
    workspaceId: line.workspaceId,
    customerId: line.customerId ?? line.externalCustomerId,
    category: 'missing_usage',
    severity: 'medium',
    title: 'Invoice quantity exceeds recorded usage',
    expectedAmount: supportedAmount,
    actualAmount: line.amount,
    currency: line.currency,
    confidence: 0.75,
    evidenceRefs: [
      { type: 'invoice_line', sourceId: line.id },
      ...matchingUsages.map((usage) => ({ type: 'usage_record' as const, sourceId: usage.id })),
    ],
    recommendedAction: 'Confirm whether usage events are missing from the export or whether the invoice quantity should be corrected.',
    internalNote: `Invoice line ${line.id} billed quantity ${billedQuantity}, but matched usage records only support ${recordedQuantity}.`,
    metadata: {
      checkId: 'missing_usage',
      accountKey,
      invoiceId: line.invoiceId,
      meter: firstUsage?.meter,
      ...periodMetadata(line.periodStart, line.periodEnd),
      billedQuantity,
      recordedQuantity,
      unsupportedQuantity,
      billedAmount: line.amount,
      supportedAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createLateUsageAfterInvoiceFinalizationFinding({
  usage,
  matchingInvoiceLines,
  usageArrivedAt,
  now,
}: {
  usage: NormalizedUsage
  matchingInvoiceLines: NormalizedInvoiceLine[]
  usageArrivedAt: string
  now: Date
}): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'
  const firstInvoiceLine = matchingInvoiceLines[0]
  const invoiceFinalizedAt = firstInvoiceLine ? getInvoiceFinalizedAt(firstInvoiceLine) : undefined

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_late_usage_after_invoice_finalization_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'late_usage_after_invoice_finalization',
    severity: 'medium',
    title: 'Usage arrived after invoice finalization',
    expectedAmount: 0,
    actualAmount: 0,
    currency: firstInvoiceLine?.currency ?? 'eur',
    confidence: 0.76,
    evidenceRefs: [
      { type: 'usage_record', sourceId: usage.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Review invoice finalization timing and confirm whether late-arriving usage should be adjusted or included in the next billing cycle.',
    internalNote: `Usage ${usage.id} arrived at ${usageArrivedAt} after invoice ${firstInvoiceLine?.invoiceId ?? 'unknown'} was finalized at ${invoiceFinalizedAt}.`,
    metadata: {
      checkId: 'late_usage_after_invoice_finalization',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      quantity: usage.quantity,
      unit: usage.unit,
      invoiceId: firstInvoiceLine?.invoiceId,
      invoiceFinalizedAt,
      usageArrivedAt,
      ranAt: now.toISOString(),
    },
  })
}

function createDuplicateUsageFinding(duplicates: NormalizedUsage[], now: Date): Finding {
  const first = duplicates[0]
  const accountKey = first.accountId ?? first.customerId ?? first.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${first.workspaceId}_duplicate_usage_${slug(accountKey)}_${slug(first.meter)}_${periodSlug(first.periodStart)}`,
    organizationId: first.organizationId,
    workspaceId: first.workspaceId,
    customerId: first.customerId,
    category: 'duplicate_usage',
    severity: 'medium',
    title: 'Duplicate usage records detected',
    expectedAmount: 0,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.76,
    evidenceRefs: duplicates.map((usage) => ({ type: 'usage_record' as const, sourceId: usage.id })),
    recommendedAction: 'Review the usage export for repeated rows before relying on this data for billing or reconciliation.',
    internalNote: `Found ${duplicates.length} exact duplicate usage records for ${accountKey} / ${first.meter}.`,
    metadata: {
      checkId: 'duplicate_usage',
      accountKey,
      customerName: first.customerName,
      meter: first.meter,
      ...periodMetadata(first.periodStart, first.periodEnd),
      quantity: first.quantity,
      unit: first.unit,
      duplicateCount: duplicates.length,
      ranAt: now.toISOString(),
    },
  })
}

function createAccountMappingMismatchFinding({
  mapping,
  usage,
  matchingInvoiceLines,
  now,
}: {
  mapping: AccountMapping
  usage: NormalizedUsage
  matchingInvoiceLines: NormalizedInvoiceLine[]
  now: Date
}): Finding {
  const usageAccountKey = mapping.usageAccountId ?? mapping.usageCustomerId ?? usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_usage'
  const stripeCustomerKey = mapping.stripeCustomerId ?? mapping.stripeCustomerEmail ?? matchingInvoiceLines[0]?.externalCustomerId ?? 'unknown_stripe'
  const billedAmount = matchingInvoiceLines.reduce((total, line) => total + line.amount, 0)

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_account_mapping_mismatch_${slug(usageAccountKey)}_${slug(stripeCustomerKey)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'account_mapping_mismatch',
    severity: 'medium',
    title: 'Usage and billing account mapping needs review',
    expectedAmount: 0,
    actualAmount: 0,
    currency: matchingInvoiceLines[0]?.currency ?? 'eur',
    confidence: mapping.confidence,
    evidenceRefs: [
      { type: 'mapping', sourceId: mapping.id },
      { type: 'usage_record', sourceId: usage.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Approve or reject the suggested account mapping before publishing revenue leakage findings for this account.',
    internalNote: `Suggested mapping ${mapping.id} would connect usage ${usage.id} to billing customer ${stripeCustomerKey}.`,
    metadata: {
      checkId: 'account_mapping_mismatch',
      mappingId: mapping.id,
      usageAccountId: mapping.usageAccountId,
      usageCustomerId: mapping.usageCustomerId,
      stripeCustomerId: mapping.stripeCustomerId,
      stripeCustomerEmail: mapping.stripeCustomerEmail,
      customerName: mapping.usageCustomerName ?? usage.customerName,
      matchReasons: mapping.matchReasons,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      billedAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createInternalUsageBilledFinding({
  usage,
  matchingInvoiceLines,
  billedAmount,
  nonBillableReason,
  now,
}: {
  usage: NormalizedUsage
  matchingInvoiceLines: NormalizedInvoiceLine[]
  billedAmount: number
  nonBillableReason: string
  now: Date
}): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_internal_usage_billed_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'internal_usage_billed',
    severity: 'high',
    title: 'Internal or free usage was billed',
    expectedAmount: 0,
    actualAmount: billedAmount,
    currency: matchingInvoiceLines[0]?.currency ?? 'eur',
    confidence: 0.78,
    evidenceRefs: [
      { type: 'usage_record', sourceId: usage.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Review billing rules and credit or suppress charges for usage marked internal, test, demo, or free.',
    internalNote: `Usage ${usage.id} is marked ${nonBillableReason}, but matching invoice lines billed ${billedAmount}.`,
    metadata: {
      checkId: 'internal_usage_billed',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      quantity: usage.quantity,
      unit: usage.unit,
      nonBillableReason,
      billedAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createPaidUsageMarkedFreeFinding({
  usage,
  paidRateTerm,
  expectedAmount,
  nonBillableReason,
  now,
}: {
  usage: NormalizedUsage
  paidRateTerm: ContractTerm
  expectedAmount: number
  nonBillableReason: string
  now: Date
}): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_paid_usage_marked_free_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'paid_usage_marked_free',
    severity: 'high',
    title: 'Paid usage was classified as free or internal',
    expectedAmount,
    actualAmount: 0,
    currency: paidRateTerm.currency,
    confidence: 0.77,
    evidenceRefs: [
      { type: 'usage_record', sourceId: usage.id },
      { type: 'pricing_rule', sourceId: paidRateTerm.id },
    ],
    recommendedAction: 'Review usage classification and billing rules, then invoice or reclassify the paid usage before close.',
    internalNote: `Approved rate ${paidRateTerm.id} applies to usage ${usage.id}, but the usage is marked ${nonBillableReason} and no matching invoice line was found.`,
    metadata: {
      checkId: 'paid_usage_marked_free',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      quantity: usage.quantity,
      unit: usage.unit,
      nonBillableReason,
      rate: paidRateTerm.rate,
      expectedAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createUsageAboveAllowanceFinding({
  usage,
  allowanceTerm,
  overageRateTerm,
  matchingInvoiceLines,
  expectedAmount,
  actualAmount,
  overageQuantity,
  now,
}: {
  usage: NormalizedUsage
  allowanceTerm: ContractTerm
  overageRateTerm: ContractTerm
  matchingInvoiceLines: NormalizedInvoiceLine[]
  expectedAmount: number
  actualAmount: number
  overageQuantity: number
  now: Date
}): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_usage_above_allowance_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'usage_above_allowance_no_overage',
    severity: 'high',
    title: 'Usage exceeded contract allowance without sufficient overage billing',
    expectedAmount,
    actualAmount,
    currency: overageRateTerm.currency,
    confidence: 0.8,
    evidenceRefs: [
      { type: 'usage_record', sourceId: usage.id },
      { type: 'contract_clause', sourceId: allowanceTerm.id },
      { type: 'pricing_rule', sourceId: overageRateTerm.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Review the customer invoice and bill or credit-adjust the missing overage amount before close.',
    internalNote: `Usage exceeded approved allowance ${allowanceTerm.id}; expected overage amount ${expectedAmount} but found ${actualAmount}.`,
    metadata: {
      checkId: 'usage_above_allowance',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      allowance: allowanceTerm.allowance,
      quantity: usage.quantity,
      overageQuantity,
      rate: overageRateTerm.rate,
      unit: usage.unit,
      ranAt: now.toISOString(),
    },
  })
}

function createWrongOverageRateFinding({
  usage,
  allowanceTerm,
  overageRateTerm,
  matchingInvoiceLines,
  expectedAmount,
  actualAmount,
  overageQuantity,
  actualRate,
  now,
}: {
  usage: NormalizedUsage
  allowanceTerm: ContractTerm
  overageRateTerm: ContractTerm
  matchingInvoiceLines: NormalizedInvoiceLine[]
  expectedAmount: number
  actualAmount: number
  overageQuantity: number
  actualRate: number
  now: Date
}): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_wrong_overage_rate_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'wrong_overage_rate',
    severity: 'high',
    title: 'Invoice overage rate does not match approved contract rate',
    expectedAmount,
    actualAmount,
    currency: overageRateTerm.currency,
    confidence: 0.86,
    evidenceRefs: [
      { type: 'usage_record', sourceId: usage.id },
      { type: 'contract_clause', sourceId: allowanceTerm.id },
      { type: 'pricing_rule', sourceId: overageRateTerm.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Update the billing configuration or invoice adjustment so the customer is charged at the approved contract overage rate.',
    internalNote: `Invoice unit rate ${actualRate} does not match approved overage rate ${overageRateTerm.rate}.`,
    metadata: {
      checkId: 'wrong_overage_rate',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      allowance: allowanceTerm.allowance,
      quantity: usage.quantity,
      overageQuantity,
      expectedRate: overageRateTerm.rate,
      actualRate,
      unit: usage.unit,
      ranAt: now.toISOString(),
    },
  })
}

function createCreditBurnMismatchFinding({
  creditTerm,
  matchingInvoiceLines,
  expectedCreditAmount,
  actualCreditAmount,
  now,
}: {
  creditTerm: ContractTerm
  matchingInvoiceLines: NormalizedInvoiceLine[]
  expectedCreditAmount: number
  actualCreditAmount: number
  now: Date
}): Finding {
  const accountKey = creditTerm.customerId ?? 'unknown_account'
  const periodStart = matchingInvoiceLines[0]?.periodStart ?? creditTerm.effectiveFrom ?? now.toISOString()

  return findingSchema.parse({
    id: `finding_${creditTerm.workspaceId}_credit_burn_mismatch_${slug(accountKey)}_${periodSlug(periodStart)}`,
    organizationId: creditTerm.organizationId,
    workspaceId: creditTerm.workspaceId,
    customerId: creditTerm.customerId,
    category: 'credit_burn_mismatch',
    severity: 'high',
    title: 'Contracted credits were not fully applied to invoice',
    expectedAmount: expectedCreditAmount,
    actualAmount: actualCreditAmount,
    currency: creditTerm.currency,
    confidence: 0.79,
    evidenceRefs: [
      { type: 'contract_clause', sourceId: creditTerm.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'credit_balance' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Review prepaid credit balance treatment and adjust the invoice or credit ledger before close.',
    internalNote: `Approved credit amount ${expectedCreditAmount} did not match invoice credit treatment ${actualCreditAmount}.`,
    metadata: {
      checkId: 'credit_burn_mismatch',
      accountKey,
      ...periodMetadata(matchingInvoiceLines[0]?.periodStart ?? creditTerm.effectiveFrom, matchingInvoiceLines[0]?.periodEnd ?? creditTerm.effectiveTo),
      expectedCreditAmount,
      actualCreditAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createMinimumNotEnforcedFinding({
  minimumTerm,
  matchingInvoiceLines,
  expectedMinimumAmount,
  revenueAmount,
  now,
}: {
  minimumTerm: ContractTerm
  matchingInvoiceLines: NormalizedInvoiceLine[]
  expectedMinimumAmount: number
  revenueAmount: number
  now: Date
}): Finding {
  const accountKey = minimumTerm.customerId ?? 'unknown_account'
  const periodStart = matchingInvoiceLines[0]?.periodStart ?? minimumTerm.effectiveFrom ?? now.toISOString()

  return findingSchema.parse({
    id: `finding_${minimumTerm.workspaceId}_minimum_not_enforced_${slug(accountKey)}_${periodSlug(periodStart)}`,
    organizationId: minimumTerm.organizationId,
    workspaceId: minimumTerm.workspaceId,
    customerId: minimumTerm.customerId,
    category: 'minimum_not_enforced',
    severity: 'high',
    title: 'Contract minimum was not fully invoiced',
    expectedAmount: expectedMinimumAmount,
    actualAmount: revenueAmount,
    currency: minimumTerm.currency,
    confidence: 0.81,
    evidenceRefs: [
      { type: 'contract_clause', sourceId: minimumTerm.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Review the customer invoice against the approved minimum commitment and add an adjustment before close.',
    internalNote: `Approved minimum amount ${expectedMinimumAmount} exceeded matched invoice revenue ${revenueAmount}.`,
    metadata: {
      checkId: 'minimum_not_enforced',
      accountKey,
      ...periodMetadata(matchingInvoiceLines[0]?.periodStart ?? minimumTerm.effectiveFrom, matchingInvoiceLines[0]?.periodEnd ?? minimumTerm.effectiveTo),
      minimumAmount: expectedMinimumAmount,
      revenueAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createExpiredDiscountActiveFinding({
  discountTerm,
  invoiceLine,
  discountAmount,
  now,
}: {
  discountTerm: ContractTerm
  invoiceLine: NormalizedInvoiceLine
  discountAmount: number
  now: Date
}): Finding {
  const accountKey = discountTerm.customerId ?? invoiceLine.externalCustomerId ?? invoiceLine.customerId ?? invoiceLine.customerEmail ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${discountTerm.workspaceId}_expired_discount_active_${slug(accountKey)}_${periodSlug(invoiceLine.periodStart)}`,
    organizationId: discountTerm.organizationId,
    workspaceId: discountTerm.workspaceId,
    customerId: discountTerm.customerId,
    category: 'expired_discount_active',
    severity: 'high',
    title: 'Expired discount was still applied to invoice',
    expectedAmount: discountAmount,
    actualAmount: 0,
    currency: invoiceLine.currency,
    confidence: 0.8,
    evidenceRefs: [
      { type: 'contract_clause', sourceId: discountTerm.id },
      { type: 'invoice_line', sourceId: invoiceLine.id },
    ],
    recommendedAction: 'Review the invoice discount against the approved contract end date and remove or reverse the expired discount before close.',
    internalNote: `Discount term expired on ${discountTerm.effectiveTo} but invoice line ${invoiceLine.id} still applied ${discountAmount}.`,
    metadata: {
      checkId: 'expired_discount_active',
      accountKey,
      discountPercent: discountTerm.discountPercent,
      ...periodMetadata(invoiceLine.periodStart, invoiceLine.periodEnd),
      discountAmount,
      expiredAt: discountTerm.effectiveTo,
      ranAt: now.toISOString(),
    },
  })
}

function createContractTermsNotInBillingFinding(term: ContractTerm, now: Date): Finding {
  const accountKey = term.customerId ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${term.workspaceId}_contract_terms_not_in_billing_${slug(accountKey)}_${slug(term.id)}`,
    organizationId: term.organizationId,
    workspaceId: term.workspaceId,
    customerId: term.customerId,
    category: 'contract_terms_not_in_billing',
    severity: 'high',
    title: 'Approved contract term is not reflected in billing evidence',
    expectedAmount: 0,
    actualAmount: 0,
    varianceAmount: 0,
    currency: term.currency ?? 'eur',
    confidence: 0.73,
    evidenceRefs: [{ type: 'contract_clause', sourceId: term.id }],
    recommendedAction: 'Map the approved contract term to a billing rule or confirm it does not need billing-system enforcement before close.',
    internalNote: `Approved contract term ${term.id} is marked billing-required, but no matching billing evidence references it.`,
    metadata: {
      checkId: 'contract_terms_not_in_billing',
      accountKey,
      termId: term.id,
      termType: term.type,
      meter: term.meter,
      billingRequired: true,
      ...periodMetadata(term.effectiveFrom, term.effectiveTo),
      ranAt: now.toISOString(),
    },
  })
}

function createCostExceedsRevenueFinding({
  cost,
  matchingInvoiceLines,
  revenueAmount,
  now,
}: {
  cost: NormalizedCost
  matchingInvoiceLines: NormalizedInvoiceLine[]
  revenueAmount: number
  now: Date
}): Finding {
  const accountKey = cost.accountId ?? cost.customerId ?? cost.customerName ?? 'unknown_account'
  const providerKey = cost.provider
  const modelKey = cost.model ?? cost.product ?? 'provider_cost'

  return findingSchema.parse({
    id: `finding_${cost.workspaceId}_cost_exceeds_revenue_${slug(accountKey)}_${slug(providerKey)}_${slug(modelKey)}_${periodSlug(cost.periodStart)}`,
    organizationId: cost.organizationId,
    workspaceId: cost.workspaceId,
    customerId: cost.customerId,
    category: 'cost_exceeds_revenue',
    severity: 'critical',
    title: 'Provider cost exceeds invoiced revenue for account',
    expectedAmount: cost.costAmount,
    actualAmount: revenueAmount,
    currency: cost.currency,
    confidence: 0.82,
    evidenceRefs: [
      { type: 'cost_record', sourceId: cost.id },
      ...matchingInvoiceLines.map((line) => ({ type: 'invoice_line' as const, sourceId: line.id })),
    ],
    recommendedAction: 'Review pricing, usage limits, and billing configuration for this account before the month closes.',
    internalNote: `Provider cost ${cost.costAmount} exceeded matched invoice revenue ${revenueAmount}.`,
    metadata: {
      checkId: 'cost_exceeds_revenue',
      accountKey,
      customerName: cost.customerName,
      provider: cost.provider,
      product: cost.product,
      model: cost.model,
      ...periodMetadata(cost.periodStart, cost.periodEnd),
      costAmount: cost.costAmount,
      revenueAmount,
      ranAt: now.toISOString(),
    },
  })
}

function createCancelledAccountUsageFinding({
  usage,
  subscription,
  cancellationEffectiveAt,
  now,
}: {
  usage: NormalizedUsage
  subscription: NormalizedSubscription
  cancellationEffectiveAt: string
  now: Date
}): Finding {
  const accountKey = usage.accountId ?? usage.customerId ?? usage.customerName ?? 'unknown_account'

  return findingSchema.parse({
    id: `finding_${usage.workspaceId}_cancelled_account_usage_${slug(accountKey)}_${slug(usage.meter)}_${periodSlug(usage.periodStart)}`,
    organizationId: usage.organizationId,
    workspaceId: usage.workspaceId,
    customerId: usage.customerId,
    category: 'cancelled_account_usage',
    severity: 'high',
    title: 'Usage continued after subscription cancellation',
    expectedAmount: 0,
    actualAmount: 0,
    currency: 'eur',
    confidence: 0.78,
    evidenceRefs: [
      { type: 'usage_record', sourceId: usage.id },
      { type: 'subscription', sourceId: subscription.id },
    ],
    recommendedAction: 'Confirm whether post-cancellation usage should be blocked, reactivated, or excluded from billable production usage.',
    internalNote: `Usage period ended after subscription cancellation ${cancellationEffectiveAt}.`,
    metadata: {
      checkId: 'cancelled_account_usage',
      accountKey,
      customerName: usage.customerName,
      meter: usage.meter,
      ...periodMetadata(usage.periodStart, usage.periodEnd),
      quantity: usage.quantity,
      subscriptionStatus: subscription.status,
      cancellationEffectiveAt,
      ranAt: now.toISOString(),
    },
  })
}

function periodsOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  return new Date(leftStart).getTime() <= new Date(rightEnd).getTime() && new Date(rightStart).getTime() <= new Date(leftEnd).getTime()
}

function usageArrivedAfterGraceWindow(usageArrivedAt: string, invoiceFinalizedAt: string, gracePeriodDays: number): boolean {
  const finalizedAt = new Date(invoiceFinalizedAt).getTime()
  const closeWindowEndsAt = finalizedAt + gracePeriodDays * 24 * 60 * 60 * 1000

  return new Date(usageArrivedAt).getTime() > closeWindowEndsAt
}

function normalizeGracePeriodDays(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function describesUsage(line: NormalizedInvoiceLine, usage: NormalizedUsage): boolean {
  const description = normalizeDescription(line.description)
  const meter = normalizeDescription(usage.meter)

  return description.includes(meter) || description.includes('usage') || description.includes('overage')
}

function describesOverageBilling(line: NormalizedInvoiceLine, usage: NormalizedUsage): boolean {
  const description = normalizeDescription(line.description)
  const meter = normalizeDescription(usage.meter)

  return description.includes(meter) || description.includes('overage')
}

function describesBillableUsageInvoice(line: NormalizedInvoiceLine): boolean {
  const description = normalizeDescription(line.description)

  return (
    description.includes('usage') ||
    description.includes('overage') ||
    typeof getMetadataNumber(line.metadata, ['quantity', 'usageQuantity', 'usage_quantity']) === 'number'
  )
}

function getUsageArrivedAt(usage: NormalizedUsage): string | undefined {
  return getMetadataDate(usage.metadata, [
    'ingestedAt',
    'ingested_at',
    'receivedAt',
    'received_at',
    'arrivedAt',
    'arrived_at',
    'processedAt',
    'processed_at',
    'reportedAt',
    'reported_at',
  ])
}

function getInvoiceFinalizedAt(line: NormalizedInvoiceLine): string | undefined {
  return getMetadataDate(line.metadata, ['finalizedAt', 'finalized_at', 'invoiceFinalizedAt', 'invoice_finalized_at', 'finalized'])
}

function contractTermRequiresBilling(term: ContractTerm): boolean {
  return getMetadataBoolean(term.metadata, [
    'billingRequired',
    'billing_required',
    'requiresBilling',
    'requires_billing',
    'billingSystemRequired',
    'billing_system_required',
    'mustBeConfiguredInBilling',
    'must_be_configured_in_billing',
  ])
}

function hasBillingEvidenceForContractTerm(
  term: ContractTerm,
  invoiceLines: NormalizedInvoiceLine[],
  accountMappings: AccountMapping[],
): boolean {
  return invoiceLines.some(
    (line) =>
      line.status !== 'void' &&
      line.status !== 'uncollectible' &&
      matchesInvoiceContractTerm(line, term, accountMappings) &&
      termCoversInvoiceLinePeriod(term, line) &&
      invoiceLineReferencesContractTerm(line, term),
  )
}

function invoiceLineReferencesContractTerm(line: NormalizedInvoiceLine, term: ContractTerm): boolean {
  const billingReference = getMetadataString(line.metadata, [
    'contractTermId',
    'contract_term_id',
    'termId',
    'term_id',
    'pricingRuleId',
    'pricing_rule_id',
    'billingRuleId',
    'billing_rule_id',
  ])

  if (!billingReference) {
    return false
  }

  const expectedReferences = contractTermBillingReferenceIds(term)

  return expectedReferences.some((reference) => normalizeKey(reference) === normalizeKey(billingReference))
}

function contractTermBillingReferenceIds(term: ContractTerm): string[] {
  return [
    term.id,
    getMetadataString(term.metadata, ['contractTermId', 'contract_term_id']),
    getMetadataString(term.metadata, ['termId', 'term_id']),
    getMetadataString(term.metadata, ['pricingRuleId', 'pricing_rule_id']),
    getMetadataString(term.metadata, ['billingRuleId', 'billing_rule_id']),
  ].filter(isPresent)
}

function getNonBillableUsageReason(usage: NormalizedUsage): string | undefined {
  const labels = [
    getMetadataString(usage.metadata, ['billingClass', 'billing_class']),
    getMetadataString(usage.metadata, ['usageClass', 'usage_class']),
    getMetadataString(usage.metadata, ['classification']),
    getMetadataString(usage.metadata, ['environment', 'env']),
    getMetadataString(usage.metadata, ['usageType', 'usage_type']),
  ].filter(isPresent)

  return labels.map(normalizeMetadataLabel).find((label) => nonBillableUsageLabels.has(label))
}

function describesCreditTreatment(line: NormalizedInvoiceLine): boolean {
  const description = normalizeDescription(line.description)

  return (
    description.includes('credit') ||
    description.includes('prepaid') ||
    description.includes('drawdown') ||
    description.includes('balance') ||
    typeof getMetadataNumber(line.metadata, ['creditAmount', 'credit_amount', 'creditApplied', 'credit_applied', 'creditBurn', 'credit_burn']) === 'number'
  )
}

function describesDiscountTreatment(line: NormalizedInvoiceLine): boolean {
  const description = normalizeDescription(line.description)

  return (
    description.includes('discount') ||
    description.includes('promo') ||
    description.includes('promotion') ||
    typeof getMetadataNumber(line.metadata, ['discountAmount', 'discount_amount', 'discountApplied', 'discount_applied']) === 'number'
  )
}

function hasWrongOverageRateEvidence(invoiceLines: NormalizedInvoiceLine[], expectedRate: number): boolean {
  return invoiceLines.some((line) => {
    const actualRate = getInvoiceUnitRate(line)

    return typeof actualRate === 'number' && !ratesEqual(actualRate, expectedRate)
  })
}

function getInvoiceUnitRate(line: NormalizedInvoiceLine): number | undefined {
  return getMetadataNumber(line.metadata, ['unitRate', 'unit_rate', 'rate', 'unitAmount', 'unit_amount'])
}

function getMetadataString(metadata: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const value = metadata[candidate]

    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}

function getMetadataBoolean(metadata: Record<string, unknown>, candidates: string[]): boolean {
  for (const candidate of candidates) {
    const value = metadata[candidate]

    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'string') {
      const normalized = normalizeMetadataLabel(value)

      if (normalized === 'true' || normalized === 'yes' || normalized === 'required') {
        return true
      }

      if (normalized === 'false' || normalized === 'no' || normalized === 'optional') {
        return false
      }
    }
  }

  return false
}

function getMetadataDate(metadata: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const value = metadata[candidate]

    if (typeof value !== 'string' || value.trim().length === 0) {
      continue
    }

    const date = new Date(value)

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString()
    }
  }

  return undefined
}

function getInvoiceCreditAmount(line: NormalizedInvoiceLine): number {
  const metadataAmount = getMetadataNumber(line.metadata, ['creditAmount', 'credit_amount', 'creditApplied', 'credit_applied', 'creditBurn', 'credit_burn'])

  if (typeof metadataAmount === 'number') {
    return Math.abs(Math.round(metadataAmount))
  }

  if (line.amount < 0) {
    return Math.abs(line.amount)
  }

  return 0
}

function getInvoiceDiscountAmount(line: NormalizedInvoiceLine): number {
  const metadataAmount = getMetadataNumber(line.metadata, ['discountAmount', 'discount_amount', 'discountApplied', 'discount_applied'])

  if (typeof metadataAmount === 'number') {
    return Math.abs(Math.round(metadataAmount))
  }

  if (line.amount < 0) {
    return Math.abs(line.amount)
  }

  return 0
}

function getMetadataNumber(metadata: Record<string, unknown>, candidates: string[]): number | undefined {
  for (const candidate of candidates) {
    const value = metadata[candidate]

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)

      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return undefined
}

const nonBillableUsageLabels = new Set(['internal', 'free', 'test', 'sandbox', 'demo', 'non_billable', 'nonbillable'])

function normalizeMetadataLabel(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function ratesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0000001
}

function recordsWithoutCancelledUsage(records: ParsedRecord[], cancelledFindings: Finding[]): ParsedRecord[] {
  const cancelledUsageIds = new Set(
    cancelledFindings.flatMap((finding) => finding.evidenceRefs.filter((ref) => ref.type === 'usage_record').map((ref) => ref.sourceId)),
  )

  if (cancelledUsageIds.size === 0) {
    return records
  }

  return records.filter((record) => {
    if (record.recordType !== 'usage') {
      return true
    }

    const usage = normalizedUsageSchema.safeParse(record.data)

    return !usage.success || !cancelledUsageIds.has(usage.data.id)
  })
}

function recordsWithoutMappingMismatchEvidence(records: ParsedRecord[], mappingMismatchFindings: Finding[]): ParsedRecord[] {
  const blockedEvidenceIds = new Set(
    mappingMismatchFindings.flatMap((finding) =>
      finding.evidenceRefs.filter((ref) => ref.type === 'usage_record' || ref.type === 'invoice_line').map((ref) => ref.sourceId),
    ),
  )

  if (blockedEvidenceIds.size === 0) {
    return records
  }

  return records.filter((record) => {
    if (record.recordType !== 'usage' && record.recordType !== 'invoice_line') {
      return true
    }

    const dataId = typeof record.data.id === 'string' ? record.data.id : undefined

    return !blockedEvidenceIds.has(record.id) && (!dataId || !blockedEvidenceIds.has(dataId))
  })
}

function isCancelledSubscription(subscription: NormalizedSubscription): boolean {
  return subscription.status === 'canceled'
}

function usageContinuedAfterCancellation(usage: NormalizedUsage, subscription: NormalizedSubscription): boolean {
  return new Date(usage.periodEnd).getTime() > new Date(cancellationEffectiveAt(subscription)).getTime()
}

function discountExpiredForInvoiceLine(term: ContractTerm, line: NormalizedInvoiceLine): boolean {
  if (!term.effectiveTo) {
    return false
  }

  return line.periodStart.slice(0, 10) > term.effectiveTo
}

function cancellationEffectiveAt(subscription: NormalizedSubscription): string {
  return subscription.canceledAt ?? subscription.endedAt ?? subscription.currentPeriodEnd
}

function normalizeDescription(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function appendNote(existing: string | undefined, next: string | undefined): string | undefined {
  const cleanedExisting = trimToUndefined(existing)
  const cleanedNext = trimToUndefined(next)

  if (!cleanedExisting) {
    return cleanedNext
  }

  if (!cleanedNext) {
    return cleanedExisting
  }

  return `${cleanedExisting}\n\n${cleanedNext}`
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

function periodSlug(value: string): string {
  return value.slice(0, 10).replaceAll('-', '_')
}

function periodMetadata(periodStart?: string, periodEnd?: string): { periodStart?: string; periodEnd?: string } {
  const normalizedStart = dateOnly(periodStart)
  const normalizedEnd = dateOnly(periodEnd)

  return {
    ...(normalizedStart ? { periodStart: normalizedStart } : {}),
    ...(normalizedEnd ? { periodEnd: normalizedEnd } : {}),
  }
}

function dateOnly(value?: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function isApprovedMapping(mapping: AccountMapping): boolean {
  return mapping.status === 'approved' || mapping.status === 'manual_override'
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
