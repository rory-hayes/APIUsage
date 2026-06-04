import { type ParsedRecord } from './parse-jobs'

export function summarizeParsedRecord(record: ParsedRecord): string {
  if (record.recordType === 'customer') {
    const displayName = readString(record.data, 'displayName') ?? 'Unknown customer'
    const email = readString(record.data, 'primaryEmail') ?? 'unknown email'
    const stripeCustomerId = readString(readRecord(record.data, 'externalIds'), 'stripeCustomerId') ?? 'unknown Stripe ID'

    return `${displayName} · ${email} · ${stripeCustomerId}`
  }

  if (record.recordType === 'usage') {
    const customer = readString(record.data, 'customerName') ?? readString(record.data, 'customerId') ?? readString(record.data, 'accountId') ?? 'Unknown customer'
    const meter = readString(record.data, 'meter') ?? 'unknown_meter'
    const quantity = readNumber(record.data, 'quantity')
    const unit = readString(record.data, 'unit') ?? 'units'

    return `${customer} · ${meter} · ${formatQuantity(quantity)} ${unit}`
  }

  if (record.recordType === 'cost') {
    const customer = readString(record.data, 'customerName') ?? readString(record.data, 'customerId') ?? readString(record.data, 'accountId') ?? 'Unknown customer'
    const provider = readString(record.data, 'provider') ?? 'Unknown provider'
    const model = readString(record.data, 'model') ?? readString(record.data, 'product') ?? 'cost'
    const amount = readNumber(record.data, 'costAmount')
    const currency = readString(record.data, 'currency') ?? 'eur'

    return `${customer} · ${provider} · ${model} · ${formatMinorUnitAmount(amount, currency)}`
  }

  if (record.recordType === 'subscription') {
    const subscription = readString(record.data, 'subscriptionId') ?? 'Unknown subscription'
    const customer = readString(record.data, 'externalCustomerId') ?? readString(record.data, 'customerId') ?? readString(record.data, 'customerEmail') ?? 'Unknown customer'
    const status = readString(record.data, 'status') ?? 'unknown'
    const product = readString(record.data, 'product') ?? 'Unknown product'
    const plan = readString(record.data, 'plan') ?? 'unknown plan'

    return `${subscription} · ${customer} · ${status} · ${product} / ${plan}`
  }

  if (record.recordType === 'mapping') {
    const displayName = readString(record.data, 'displayName') ?? 'Unknown mapping'
    const usage = readString(record.data, 'usageAccountId') ?? readString(record.data, 'usageCustomerId') ?? readString(record.data, 'usageCustomerName') ?? 'unknown usage'
    const billing =
      readString(record.data, 'stripeCustomerId') ??
      readString(record.data, 'stripeCustomerEmail') ??
      readString(record.data, 'contractCustomerId') ??
      readString(record.data, 'costAccountId') ??
      'unknown billing'

    return `${displayName} · ${usage} -> ${billing}`
  }

  if (record.recordType === 'contract_term') {
    const type = readString(record.data, 'type') ?? 'contract term'
    const customer = readString(record.data, 'customerId') ?? 'Unknown customer'

    return `${type} · ${customer} · ${formatContractTermValue(record.data)}`
  }

  const invoice = readString(record.data, 'invoiceId') ?? 'Unknown invoice'
  const customer = readString(record.data, 'externalCustomerId') ?? readString(record.data, 'customerEmail') ?? 'Unknown customer'
  const amount = readNumber(record.data, 'amount')
  const currency = readString(record.data, 'currency') ?? 'eur'
  const status = readString(record.data, 'status') ?? 'unknown'

  return `${invoice} · ${customer} · ${formatMinorUnitAmount(amount, currency)} · ${status}`
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readNumber(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readRecord(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key]

  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function formatQuantity(value: number | undefined): string {
  if (value === undefined) {
    return 'unknown'
  }

  return new Intl.NumberFormat('en-IE').format(value)
}

function formatMinorUnitAmount(value: number | undefined, currency: string): string {
  if (value === undefined) {
    return 'unknown amount'
  }

  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(value / 100)
}

function formatContractTermValue(data: Record<string, unknown>): string {
  const allowance = readNumber(data, 'allowance')

  if (allowance !== undefined) {
    return `${formatQuantity(allowance)} ${readString(data, 'unit') ?? 'units'}`
  }

  const creditAmount = readNumber(data, 'creditAmount')

  if (creditAmount !== undefined) {
    return `${readString(data, 'currency')?.toUpperCase() ?? ''} ${formatQuantity(creditAmount)}`.trim()
  }

  return 'value pending'
}
