import { parse } from 'csv-parse/sync'

import {
  normalizedAccountMappingSchema,
  normalizedCostSchema,
  normalizedCustomerSchema,
  normalizedInvoiceLineSchema,
  normalizedSubscriptionSchema,
  normalizedUsageSchema,
  contractTermSchema,
  type NormalizedAccountMapping,
  type NormalizedCost,
  type NormalizedCustomer,
  type NormalizedInvoiceLine,
  type NormalizedSubscription,
  type NormalizedUsage,
  type ContractTerm,
} from './schemas'

export type ParseContext = {
  organizationId: string
  workspaceId: string
  sourceFileId: string
}

export type ParseError = {
  rowNumber: number
  message: string
}

export type ParseResult<T> = {
  records: T[]
  errors: ParseError[]
}

export type UsageCsvMapping = {
  accountId?: string
  customerId?: string
  customerName?: string
  meter: string
  quantity: string
  unit: string
  periodStart: string
  periodEnd: string
}

export type ProviderCostCsvMapping = {
  accountId?: string
  customerId?: string
  customerName?: string
  provider: string
  product?: string
  model?: string
  costAmount: string
  currency: string
  periodStart: string
  periodEnd: string
}

type CsvRow = Record<string, string | undefined>

type ProviderCostColumnCandidates = {
  accountId?: string[]
  customerId?: string[]
  customerName?: string[]
  provider: string[]
  product?: string[]
  model?: string[]
  costAmount: string[]
  currency: string[]
  periodStart: string[]
  periodEnd: string[]
}

const defaultProviderCostColumnCandidates = {
  accountId: ['account_id', 'account id', 'customer_account_id'],
  customerId: ['customer_id', 'customer id'],
  customerName: ['customer_name', 'customer name'],
  provider: ['provider', 'vendor'],
  product: ['product', 'service'],
  model: ['model', 'sku'],
  costAmount: ['cost', 'cost_amount', 'amount'],
  currency: ['currency'],
  periodStart: ['period_start', 'period start', 'start'],
  periodEnd: ['period_end', 'period end', 'end'],
} satisfies ProviderCostColumnCandidates

export function parseStripeInvoiceCsv(csv: string, context: ParseContext): ParseResult<NormalizedInvoiceLine> {
  const rows = parseCsv(csv)

  return collectRows(rows, (row, rowNumber) => {
    const invoiceId = required(row, ['id', 'invoice_id', 'invoice id'], 'invoice id')
    const amount = parseMoneyToMinorUnits(required(row, ['amount_due', 'amount due', 'amount', 'total'], 'amount'))

    return normalizedInvoiceLineSchema.parse({
      id: `${context.sourceFileId}:${rowNumber}:${invoiceId}`,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      invoiceId,
      externalCustomerId: optional(row, ['customer', 'customer_id', 'customer id']),
      customerEmail: optional(row, ['customer_email', 'customer email', 'email']),
      description: optional(row, ['description', 'line_description', 'line description']) ?? 'Invoice line',
      amount,
      currency: required(row, ['currency'], 'currency'),
      status: normalizeInvoiceStatus(optional(row, ['status']) ?? 'open'),
      periodStart: normalizeDate(required(row, ['period_start', 'period start', 'start'], 'period start')),
      periodEnd: normalizeDate(required(row, ['period_end', 'period end', 'end'], 'period end')),
      sourceRefs: [{ sourceFileId: context.sourceFileId, rowNumber }],
      metadata: buildInvoiceLineMetadata(row),
    })
  })
}

export function parseStripeCustomerCsv(csv: string, context: ParseContext): ParseResult<NormalizedCustomer> {
  const rows = parseCsv(csv)

  return collectRows(rows, (row, rowNumber) => {
    const stripeCustomerId = required(row, ['id', 'customer_id', 'customer id'], 'customer id')
    const primaryEmail = optional(row, ['email', 'customer_email', 'customer email'])
    const displayName = optional(row, ['name', 'customer_name', 'customer name']) ?? primaryEmail ?? stripeCustomerId

    return normalizedCustomerSchema.parse({
      id: `${context.sourceFileId}:${rowNumber}:${stripeCustomerId}`,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      displayName,
      primaryEmail,
      externalIds: {
        stripeCustomerId,
      },
      sourceRefs: [{ sourceFileId: context.sourceFileId, rowNumber }],
      metadata: {
        created: optional(row, ['created', 'created_at', 'created at']),
        currency: optional(row, ['currency', 'default_currency', 'default currency']),
        delinquent: optional(row, ['delinquent']),
      },
    })
  })
}

export function parseUsageCsv(csv: string, mapping: UsageCsvMapping, context: ParseContext): ParseResult<NormalizedUsage> {
  const rows = parseCsv(csv)

  return collectRows(rows, (row, rowNumber) => {
    const accountId = mapping.accountId ? optional(row, [mapping.accountId]) : undefined
    const customerId = mapping.customerId ? optional(row, [mapping.customerId]) : undefined
    const customerName = mapping.customerName ? optional(row, [mapping.customerName]) : undefined
    const meter = required(row, [mapping.meter], 'meter')
    const quantity = parsePositiveNumber(required(row, [mapping.quantity], 'quantity'))

    return normalizedUsageSchema.parse({
      id: `${context.sourceFileId}:${rowNumber}:${accountId ?? customerId ?? customerName ?? meter}`,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      customerId,
      customerName,
      accountId,
      meter,
      quantity,
      unit: required(row, [mapping.unit], 'unit'),
      periodStart: normalizeDate(required(row, [mapping.periodStart], 'period start')),
      periodEnd: normalizeDate(required(row, [mapping.periodEnd], 'period end')),
      sourceRefs: [{ sourceFileId: context.sourceFileId, rowNumber }],
      metadata: buildUsageMetadata(row),
    })
  })
}

export function parseProviderCostCsv(
  csv: string,
  context: ParseContext,
  mapping?: ProviderCostCsvMapping,
): ParseResult<NormalizedCost> {
  const rows = parseCsv(csv)
  const columns = providerCostColumnCandidates(mapping)

  return collectRows(rows, (row, rowNumber) => {
    const accountId = optional(row, columns.accountId ?? [])
    const customerId = optional(row, columns.customerId ?? [])
    const customerName = optional(row, columns.customerName ?? [])
    const provider = required(row, columns.provider, 'provider')
    const product = optional(row, columns.product ?? [])
    const model = optional(row, columns.model ?? [])
    const costAmount = parseMoneyToMinorUnits(required(row, columns.costAmount, 'cost'))

    return normalizedCostSchema.parse({
      id: `${context.sourceFileId}:${rowNumber}:${accountId ?? customerId ?? customerName ?? 'unknown'}:${provider}:${product ?? 'unknown_product'}:${model ?? 'unknown_model'}`,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      customerId,
      customerName,
      accountId,
      provider,
      product,
      model,
      costAmount,
      currency: required(row, columns.currency, 'currency'),
      periodStart: normalizeDate(required(row, columns.periodStart, 'period start')),
      periodEnd: normalizeDate(required(row, columns.periodEnd, 'period end')),
      sourceRefs: [{ sourceFileId: context.sourceFileId, rowNumber }],
    })
  })
}

export function parseAccountMappingCsv(csv: string, context: ParseContext): ParseResult<NormalizedAccountMapping> {
  const rows = parseCsv(csv)

  return collectRows(rows, (row, rowNumber) => {
    const displayName = required(row, ['display_name', 'display name', 'customer_name', 'customer name', 'name'], 'display name')
    const usageAccountId = optional(row, ['usage_account_id', 'usage account id', 'account_id', 'account id'])
    const usageCustomerId = optional(row, ['usage_customer_id', 'usage customer id', 'usage_customer', 'usage customer'])
    const usageCustomerName = optional(row, ['usage_customer_name', 'usage customer name', 'usage_name', 'usage name'])
    const stripeCustomerId = optional(row, ['stripe_customer_id', 'stripe customer id', 'stripe_id', 'stripe id'])
    const stripeCustomerEmail = optional(row, ['stripe_customer_email', 'stripe customer email', 'customer_email', 'customer email', 'email'])
    const contractCustomerId = optional(row, ['contract_customer_id', 'contract customer id', 'contract_id', 'contract id'])
    const costAccountId = optional(row, ['cost_account_id', 'cost account id', 'provider_account_id', 'provider account id'])
    const note = optional(row, ['note', 'notes', 'mapping_note', 'mapping note'])

    return normalizedAccountMappingSchema.parse({
      id: `${context.sourceFileId}:${rowNumber}:${usageAccountId ?? usageCustomerId ?? usageCustomerName ?? displayName}:${stripeCustomerId ?? stripeCustomerEmail ?? contractCustomerId ?? costAccountId ?? 'mapping'}`,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      displayName,
      usageAccountId,
      usageCustomerId,
      usageCustomerName,
      stripeCustomerId,
      stripeCustomerEmail,
      contractCustomerId,
      costAccountId,
      note,
      sourceRefs: [{ sourceFileId: context.sourceFileId, rowNumber }],
      metadata: {},
    })
  })
}

export function parseCreditsAllowancesCsv(csv: string, context: ParseContext): ParseResult<ContractTerm> {
  const rows = parseCsv(csv)

  return collectRows(rows, (row, rowNumber) => {
    const type = normalizeCreditAllowanceType(required(row, ['type', 'term_type', 'term type'], 'credit/allowance type'))
    const customerId = required(row, ['customer_id', 'customer id', 'account_id', 'account id'], 'customer id')
    const evidenceSnippet = optional(row, ['evidence_snippet', 'evidence snippet', 'snippet', 'note', 'notes'])

    if (type === 'allowance') {
      return contractTermSchema.parse({
        id: contractTermCsvId(context.workspaceId, context.sourceFileId, type, rowNumber),
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        customerId,
        type,
        meter: optional(row, ['meter', 'metric', 'usage_meter', 'usage meter']),
        unit: optional(row, ['unit', 'uom']),
        allowance: parseNonNegativeNumber(required(row, ['allowance', 'allowance_quantity', 'allowance quantity', 'included_quantity'], 'allowance')),
        effectiveFrom: optionalDateOnly(row, ['effective_from', 'effective from', 'start', 'period_start']),
        effectiveTo: optionalDateOnly(row, ['effective_to', 'effective to', 'end', 'period_end']),
        status: 'candidate',
        evidence: {
          sourceFileId: context.sourceFileId,
          snippet: evidenceSnippet,
        },
        metadata: {
          source: 'credits_allowances_csv',
          sourceRowNumber: rowNumber,
        },
      })
    }

    return contractTermSchema.parse({
      id: contractTermCsvId(context.workspaceId, context.sourceFileId, type, rowNumber),
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      customerId,
      type,
      creditAmount: parseNonNegativeNumber(required(row, ['credit_amount', 'credit amount', 'credit', 'amount'], 'credit amount')),
      currency: required(row, ['currency'], 'currency'),
      effectiveFrom: optionalDateOnly(row, ['effective_from', 'effective from', 'start', 'period_start']),
      effectiveTo: optionalDateOnly(row, ['effective_to', 'effective to', 'end', 'period_end']),
      status: 'candidate',
      evidence: {
        sourceFileId: context.sourceFileId,
        snippet: evidenceSnippet,
      },
      metadata: {
        source: 'credits_allowances_csv',
        sourceRowNumber: rowNumber,
      },
    })
  })
}

export function parseStripeSubscriptionCsv(csv: string, context: ParseContext): ParseResult<NormalizedSubscription> {
  const rows = parseCsv(csv)

  return collectRows(rows, (row, rowNumber) => {
    const subscriptionId = required(row, ['id', 'subscription_id', 'subscription id'], 'subscription id')

    return normalizedSubscriptionSchema.parse({
      id: `${context.sourceFileId}:${rowNumber}:${subscriptionId}`,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      subscriptionId,
      externalCustomerId: optional(row, ['customer', 'customer_id', 'customer id']),
      customerEmail: optional(row, ['customer_email', 'customer email', 'email']),
      status: normalizeSubscriptionStatus(required(row, ['status'], 'status')),
      product: optional(row, ['product', 'product_name', 'product name']),
      plan: optional(row, ['plan', 'plan_name', 'price', 'price_id']),
      currentPeriodStart: normalizeDate(required(row, ['current_period_start', 'current period start', 'period_start', 'start'], 'current period start')),
      currentPeriodEnd: normalizeDate(required(row, ['current_period_end', 'current period end', 'period_end', 'end'], 'current period end')),
      canceledAt: optionalDate(row, ['canceled_at', 'cancelled_at', 'canceled at', 'cancelled at']),
      endedAt: optionalDate(row, ['ended_at', 'ended at']),
      sourceRefs: [{ sourceFileId: context.sourceFileId, rowNumber }],
    })
  })
}

function parseCsv(csv: string): CsvRow[] {
  return parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[]
}

function collectRows<T>(rows: CsvRow[], normalize: (row: CsvRow, rowNumber: number) => T): ParseResult<T> {
  const records: T[] = []
  const errors: ParseError[] = []

  rows.forEach((row, index) => {
    const rowNumber = index + 2

    try {
      records.push(normalize(row, rowNumber))
    } catch (error) {
      errors.push({
        rowNumber,
        message: error instanceof Error ? error.message : 'Unknown parse error',
      })
    }
  })

  return { records, errors }
}

function required(row: CsvRow, candidates: string[], label: string): string {
  const value = optional(row, candidates)

  if (!value) {
    throw new Error(`Missing ${label}`)
  }

  return value
}

function optional(row: CsvRow, candidates: string[]): string | undefined {
  const normalizedRow = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value?.trim()]))

  for (const candidate of candidates) {
    const value = normalizedRow.get(normalizeHeader(candidate))

    if (value) {
      return value
    }
  }

  return undefined
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function providerCostColumnCandidates(mapping?: ProviderCostCsvMapping): ProviderCostColumnCandidates {
  if (!mapping) {
    return defaultProviderCostColumnCandidates
  }

  return {
    accountId: mapping.accountId ? [mapping.accountId] : undefined,
    customerId: mapping.customerId ? [mapping.customerId] : undefined,
    customerName: mapping.customerName ? [mapping.customerName] : undefined,
    provider: [mapping.provider],
    product: mapping.product ? [mapping.product] : undefined,
    model: mapping.model ? [mapping.model] : undefined,
    costAmount: [mapping.costAmount],
    currency: [mapping.currency],
    periodStart: [mapping.periodStart],
    periodEnd: [mapping.periodEnd],
  }
}

function parseMoneyToMinorUnits(value: string): number {
  const normalized = value.replace(/[,€$£]/g, '').trim()
  const amount = Number(normalized)

  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount: ${value}`)
  }

  return Math.round(amount * 100)
}

function parsePositiveNumber(value: string): number {
  const quantity = Number(value.replace(/,/g, '').trim())

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity: ${value}`)
  }

  return quantity
}

function parseNonNegativeNumber(value: string): number {
  const quantity = Number(value.replace(/[,€$£]/g, '').trim())

  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`Invalid number: ${value}`)
  }

  return quantity
}

function optionalPositiveNumber(row: CsvRow, candidates: string[]): number | undefined {
  const value = optional(row, candidates)

  return value ? parsePositiveNumber(value) : undefined
}

function optionalDateOnly(row: CsvRow, candidates: string[]): string | undefined {
  const value = optional(row, candidates)

  return value ? normalizeDate(value).slice(0, 10) : undefined
}

function normalizeDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`)
  }

  return date.toISOString()
}

function normalizeCreditAllowanceType(value: string): 'allowance' | 'credit' {
  const type = value.trim().toLowerCase().replace(/[\s-]+/g, '_')

  if (type === 'allowance' || type === 'credit') {
    return type
  }

  throw new Error(`Unsupported credit/allowance type: ${value}`)
}

function contractTermCsvId(workspaceId: string, sourceFileId: string, type: 'allowance' | 'credit', rowNumber: number): string {
  return `term_${slug(workspaceId)}_${slug(sourceFileId)}_${type}_${rowNumber}`
}

function normalizeInvoiceStatus(value: string): NormalizedInvoiceLine['status'] {
  const status = value.trim().toLowerCase().replace(/\s+/g, '_')

  if (status === 'draft' || status === 'open' || status === 'paid' || status === 'void' || status === 'uncollectible') {
    return status
  }

  throw new Error(`Unsupported invoice status: ${value}`)
}

function normalizeSubscriptionStatus(value: string): NormalizedSubscription['status'] {
  const status = value.trim().toLowerCase().replace(/\s+/g, '_').replace('cancelled', 'canceled')

  if (
    status === 'active' ||
    status === 'trialing' ||
    status === 'past_due' ||
    status === 'unpaid' ||
    status === 'paused' ||
    status === 'canceled' ||
    status === 'incomplete' ||
    status === 'incomplete_expired'
  ) {
    return status
  }

  throw new Error(`Unsupported subscription status: ${value}`)
}

function optionalDate(row: CsvRow, candidates: string[]): string | undefined {
  const value = optional(row, candidates)

  return value ? normalizeDate(value) : undefined
}

function buildInvoiceLineMetadata(row: CsvRow): Record<string, unknown> {
  return compactMetadata({
    finalizedAt: optionalDate(row, ['finalized_at', 'finalized at', 'invoice_finalized_at', 'invoice finalized at', 'finalized']),
    quantity: optionalPositiveNumber(row, ['quantity', 'usage_quantity', 'usage quantity', 'qty']),
    contractTermId: optional(row, ['contract_term_id', 'contract term id', 'contractTermId', 'term_id', 'term id']),
    billingRuleId: optional(row, ['billing_rule_id', 'billing rule id', 'billingRuleId']),
    pricingRuleId: optional(row, ['pricing_rule_id', 'pricing rule id', 'pricingRuleId']),
  })
}

function buildUsageMetadata(row: CsvRow): Record<string, unknown> {
  return compactMetadata({
    ingestedAt: optionalDate(row, ['ingested_at', 'ingested at', 'received_at', 'received at', 'arrived_at', 'arrived at', 'processed_at', 'processed at']),
  })
}

function compactMetadata(metadata: Record<string, unknown | undefined>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined))
}
