import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Heading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { type AppBillingRecord } from '@/lib/audit/app-billing'
import { BILLING_PLANS, getBillingPlan } from '@/lib/audit/billing-plans'
import { statusColor } from '@/lib/audit/demo-workspace'
import { buildWorkspacePackagingMetrics, type WorkspacePackagingMetrics } from '@/lib/audit/packaging-metrics'
import { type PilotConversionRecord } from '@/lib/audit/pilot-conversions'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { type RuleRun } from '@/lib/audit/rule-runs'
import { type ContractTerm, type Finding } from '@/lib/audit/schemas'
import { buildCustomerAuditStatusRows, type CustomerAuditStatusRow } from '@/lib/audit/status'
import { type StripeConnection } from '@/lib/audit/stripe-connector'
import { type UploadRecord } from '@/lib/audit/uploads'
import { buildWorkspaceUsageMetrics, type WorkspaceUsageMetrics } from '@/lib/audit/usage-metrics'
import { type WarehouseCsvConnection } from '@/lib/audit/warehouse-connector'
import {
  getAccountMappingStore,
  getAppBillingStore,
  getContractTermStore,
  getFindingStore,
  getIntakeStore,
  getInviteStore,
  getParsedRecordStore,
  getPilotConversionStore,
  getParseJobStore,
  getRuleRunStore,
  getStripeConnectionStore,
  getUploadStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'
import { type InviteRecord } from '@/lib/auth/invites'
import { saveAppBillingAction, savePilotConversionAction } from '../actions'

export const dynamic = 'force-dynamic'

type CustomerSummary = {
  organizationId: string
  organizationName: string
  workspaces: AuditWorkspace[]
  auditStatus: CustomerAuditStatusRow | null
  usageMetrics: WorkspaceUsageMetrics | null
  packagingMetrics: WorkspacePackagingMetrics | null
  pilotConversion: PilotConversionRecord | null
  appBilling: AppBillingRecord | null
  activeInviteCount: number
  revokedInviteCount: number
}

export default async function AdminCustomersPage() {
  const [
    workspaces,
    invites,
    uploads,
    findings,
    intakeResponses,
    parseJobs,
    parsedRecords,
    accountMappings,
    pilotConversions,
    appBillingRecords,
    ruleRuns,
    contractTerms,
    stripeConnections,
    warehouseConnections,
  ] = await Promise.all([
    getWorkspaceStore().list(),
    getInviteStore().list(),
    getUploadStore().list(),
    getFindingStore().list(),
    getIntakeStore().list(),
    getParseJobStore().list(),
    getParsedRecordStore().list(),
    getAccountMappingStore().list(),
    getPilotConversionStore().list(),
    getAppBillingStore().list(),
    getRuleRunStore().list(),
    getContractTermStore().list(),
    getStripeConnectionStore().list(),
    getWarehouseCsvConnectionStore().list(),
  ])
  const auditStatusRows = buildCustomerAuditStatusRows({
    workspaces,
    uploads,
    findings,
    intakeResponses,
    parseJobs,
    parsedRecords,
    accountMappings,
  })
  const customers = buildCustomerSummaries(
    auditStatusRows,
    invites,
    pilotConversions,
    appBillingRecords,
    uploads,
    ruleRuns,
    findings,
    parsedRecords,
    contractTerms,
    stripeConnections,
    warehouseConnections,
  )

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Customers</Heading>
          <Text className="mt-2">Customer organizations with active audit workspaces and invite coverage.</Text>
        </div>
        <Badge color="blue">{customers.length} customers</Badge>
      </div>

      <Table className="mt-8 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
        <TableHead>
          <TableRow>
            <TableHeader>Customer</TableHeader>
            <TableHeader>Health</TableHeader>
            <TableHeader>Workspaces</TableHeader>
            <TableHeader>Invites</TableHeader>
            <TableHeader>Latest audit</TableHeader>
            <TableHeader>Usage metrics</TableHeader>
            <TableHeader>Pilot conversion</TableHeader>
            <TableHeader>Workspace links</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {customers.map((customer) => (
            <TableRow key={customer.organizationId}>
              <TableCell>
                <div className="font-medium">{customer.organizationName}</div>
                <div className="text-zinc-500">{customer.organizationId}</div>
              </TableCell>
              <TableCell>
                {customer.auditStatus ? (
                  <>
                    <Badge color={customerHealthColor(customer.auditStatus.health)}>{customer.auditStatus.healthLabel}</Badge>
                    <div className="mt-2 text-zinc-500">{customer.auditStatus.statusReason}</div>
                    <div className="text-zinc-500">{plural(customer.auditStatus.findingSummary.highRiskOpenCount, 'high risk finding')}</div>
                  </>
                ) : (
                  <span className="text-zinc-500">No audit workspace yet</span>
                )}
              </TableCell>
              <TableCell>{plural(customer.workspaces.length, 'workspace')}</TableCell>
              <TableCell>
                <div>{plural(customer.activeInviteCount, 'active invite')}</div>
                {customer.revokedInviteCount > 0 ? <div className="text-zinc-500">{plural(customer.revokedInviteCount, 'revoked invite')}</div> : null}
              </TableCell>
              <TableCell>
                {customer.auditStatus ? (
                  <>
                    <div>{customer.auditStatus.latestWorkspace.auditPeriod}</div>
                    <Badge color={statusColor(customer.auditStatus.latestWorkspace.status)}>{customer.auditStatus.latestWorkspace.statusLabel}</Badge>
                  </>
                ) : (
                  <span className="text-zinc-500">No workspace yet</span>
                )}
              </TableCell>
              <TableCell>
                <div className="font-medium">Usage metrics</div>
                {customer.usageMetrics ? (
                  <div className="mt-1 text-zinc-500">
                    <div>{formatDuration(customer.usageMetrics.timeToFirstUploadMinutes)} to upload</div>
                    <div>{formatDuration(customer.usageMetrics.timeToFirstFindingMinutes)} to first finding</div>
                    <div>{plural(customer.usageMetrics.acceptedFindingCount, 'accepted finding')}</div>
                    <div>{formatMoney(customer.usageMetrics.moneyAtRiskAmount, customer.usageMetrics.currency)} at risk</div>
                  </div>
                ) : (
                  <div className="mt-1 text-zinc-500">No audit metrics yet</div>
                )}
                <div className="mt-4 font-medium">Packaging metrics</div>
                {customer.packagingMetrics ? (
                  <div className="mt-1 text-zinc-500">
                    <div>{plural(customer.packagingMetrics.invoiceCount, 'invoice')}</div>
                    <div>{plural(customer.packagingMetrics.usageRowCount, 'usage row')}</div>
                    <div>{plural(customer.packagingMetrics.contractCount, 'contract')}</div>
                    <div>{plural(customer.packagingMetrics.connectedSystemCount, 'connected system')}</div>
                    <div>{formatConnectedSystems(customer.packagingMetrics.connectedSystems)}</div>
                  </div>
                ) : (
                  <div className="mt-1 text-zinc-500">No packaging metrics yet</div>
                )}
              </TableCell>
              <TableCell>
                <div>
                  <div className="font-medium">Pilot conversion</div>
                  {customer.pilotConversion ? (
                    <div className="mt-1 text-zinc-500">
                      <div>{formatMoney(customer.pilotConversion.auditFeeAmount, customer.pilotConversion.currency)} audit fee</div>
                      <div>
                        {formatMoney(customer.pilotConversion.monitoringOfferAmount, customer.pilotConversion.currency)} monitoring offer
                      </div>
                      <div>{conversionStatusLabel(customer.pilotConversion.conversionStatus)}</div>
                      <div>{customer.pilotConversion.renewalDate ? `Renewal ${formatDate(customer.pilotConversion.renewalDate)}` : 'No renewal date'}</div>
                    </div>
                  ) : (
                    <div className="mt-1 text-zinc-500">No pilot terms tracked</div>
                  )}
                </div>
                <form action={savePilotConversionAction} className="mt-3 grid gap-2">
                  <input type="hidden" name="organizationId" value={customer.organizationId} />
                  <input type="hidden" name="organizationName" value={customer.organizationName} />
                  <input type="hidden" name="currency" value={customer.pilotConversion?.currency ?? 'eur'} />
                  <Input
                    aria-label={`${customer.organizationName} audit fee`}
                    name="auditFeeAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Audit fee"
                    defaultValue={formatMajorAmount(customer.pilotConversion?.auditFeeAmount)}
                  />
                  <Input
                    aria-label={`${customer.organizationName} monitoring offer`}
                    name="monitoringOfferAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Monitoring offer"
                    defaultValue={formatMajorAmount(customer.pilotConversion?.monitoringOfferAmount)}
                  />
                  <Select name="conversionStatus" aria-label={`${customer.organizationName} conversion status`} defaultValue={customer.pilotConversion?.conversionStatus ?? 'not_offered'}>
                    <option value="not_offered">Not offered</option>
                    <option value="offered">Offered</option>
                    <option value="converted">Converted</option>
                    <option value="declined">Declined</option>
                  </Select>
                  <Input
                    aria-label={`${customer.organizationName} renewal date`}
                    name="renewalDate"
                    type="date"
                    defaultValue={customer.pilotConversion?.renewalDate ?? ''}
                  />
                  <Button type="submit" outline>
                    Save
                  </Button>
                </form>
                <div className="mt-6">
                  <div className="font-medium">Stripe billing</div>
                  {customer.appBilling ? (
                    <div className="mt-1 text-zinc-500">
                      <div>
                        {formatBillingPlan(customer.appBilling.planId)} · {billingStatusLabel(customer.appBilling.billingStatus)}
                      </div>
                      <div>{customer.appBilling.stripeCustomerId ?? 'No Stripe customer'}</div>
                      <div>{formatInvoice(customer.appBilling)}</div>
                      <div>{formatSubscription(customer.appBilling)}</div>
                    </div>
                  ) : (
                    <div className="mt-1 text-zinc-500">No Stripe billing tracked</div>
                  )}
                </div>
                <form action={saveAppBillingAction} className="mt-3 grid gap-2">
                  <input type="hidden" name="organizationId" value={customer.organizationId} />
                  <input type="hidden" name="organizationName" value={customer.organizationName} />
                  <Select name="planId" aria-label={`${customer.organizationName} billing plan`} defaultValue={customer.appBilling?.planId ?? 'audit'}>
                    {BILLING_PLANS.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`${customer.organizationName} Stripe customer ID`}
                    name="stripeCustomerId"
                    placeholder="Stripe customer ID"
                    defaultValue={customer.appBilling?.stripeCustomerId ?? ''}
                  />
                  <Input
                    aria-label={`${customer.organizationName} Stripe invoice ID`}
                    name="stripeInvoiceId"
                    placeholder="Stripe invoice ID"
                    defaultValue={customer.appBilling?.stripeInvoiceId ?? ''}
                  />
                  <Select
                    name="stripeInvoiceStatus"
                    aria-label={`${customer.organizationName} Stripe invoice status`}
                    defaultValue={customer.appBilling?.stripeInvoiceStatus ?? ''}
                  >
                    <option value="">Invoice status</option>
                    <option value="draft">draft</option>
                    <option value="open">open</option>
                    <option value="paid">paid</option>
                    <option value="void">void</option>
                    <option value="uncollectible">uncollectible</option>
                  </Select>
                  <Input
                    aria-label={`${customer.organizationName} Stripe hosted invoice URL`}
                    name="stripeHostedInvoiceUrl"
                    placeholder="Hosted invoice URL"
                    defaultValue={customer.appBilling?.stripeHostedInvoiceUrl ?? ''}
                  />
                  <Input
                    aria-label={`${customer.organizationName} Stripe subscription ID`}
                    name="stripeSubscriptionId"
                    placeholder="Stripe subscription ID"
                    defaultValue={customer.appBilling?.stripeSubscriptionId ?? ''}
                  />
                  <Select
                    name="stripeSubscriptionStatus"
                    aria-label={`${customer.organizationName} Stripe subscription status`}
                    defaultValue={customer.appBilling?.stripeSubscriptionStatus ?? ''}
                  >
                    <option value="">Subscription status</option>
                    <option value="active">active</option>
                    <option value="trialing">trialing</option>
                    <option value="past_due">past due</option>
                    <option value="unpaid">unpaid</option>
                    <option value="paused">paused</option>
                    <option value="canceled">canceled</option>
                    <option value="incomplete">incomplete</option>
                    <option value="incomplete_expired">incomplete expired</option>
                  </Select>
                  <Input
                    aria-label={`${customer.organizationName} Stripe billing note`}
                    name="note"
                    placeholder="Billing note"
                    defaultValue={customer.appBilling?.note ?? ''}
                  />
                  <Button type="submit" outline>
                    Save Stripe
                  </Button>
                </form>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {customer.workspaces.map((workspace) => (
                    <Button key={workspace.id} href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} outline>
                      {workspace.auditPeriod}
                    </Button>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}

function buildCustomerSummaries(
  auditStatusRows: CustomerAuditStatusRow[],
  invites: InviteRecord[],
  pilotConversions: PilotConversionRecord[],
  appBillingRecords: AppBillingRecord[],
  uploads: UploadRecord[],
  ruleRuns: RuleRun[],
  findings: Finding[],
  parsedRecords: ParsedRecord[],
  contractTerms: ContractTerm[],
  stripeConnections: StripeConnection[],
  warehouseConnections: WarehouseCsvConnection[],
): CustomerSummary[] {
  const customersByOrganizationId = new Map<string, CustomerSummary>()

  for (const auditStatus of auditStatusRows) {
    const customer = getOrCreateCustomer(customersByOrganizationId, auditStatus.organizationId, auditStatus.organizationName)

    customer.auditStatus = auditStatus
    customer.workspaces = auditStatus.workspaces
    customer.usageMetrics = buildWorkspaceUsageMetrics({
      workspace: auditStatus.workspaces[0],
      uploads,
      ruleRuns,
      findings,
    })
    customer.packagingMetrics = buildWorkspacePackagingMetrics({
      workspace: auditStatus.workspaces[0],
      parsedRecords,
      uploads,
      contractTerms,
      stripeConnections,
      warehouseConnections,
    })
  }

  for (const pilotConversion of pilotConversions) {
    const customer = getOrCreateCustomer(customersByOrganizationId, pilotConversion.organizationId, pilotConversion.organizationName)

    customer.pilotConversion = pilotConversion
  }

  for (const appBilling of appBillingRecords) {
    const customer = getOrCreateCustomer(customersByOrganizationId, appBilling.organizationId, appBilling.organizationName)

    customer.appBilling = appBilling
  }

  for (const invite of invites) {
    const customer = getOrCreateCustomer(customersByOrganizationId, invite.organizationId, invite.organizationName)

    if (invite.status === 'active') {
      customer.activeInviteCount += 1
    } else {
      customer.revokedInviteCount += 1
    }
  }

  return [...customersByOrganizationId.values()].sort((a, b) => a.organizationName.localeCompare(b.organizationName))
}

function getOrCreateCustomer(customers: Map<string, CustomerSummary>, organizationId: string, organizationName: string) {
  const existing = customers.get(organizationId)

  if (existing) {
    return existing
  }

  const customer = {
    organizationId,
    organizationName,
    workspaces: [],
    auditStatus: null,
    usageMetrics: null,
    packagingMetrics: null,
    pilotConversion: null,
    appBilling: null,
    activeInviteCount: 0,
    revokedInviteCount: 0,
  }

  customers.set(organizationId, customer)

  return customer
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function customerHealthColor(health: CustomerAuditStatusRow['health']) {
  if (health === 'blocked') {
    return 'red'
  }

  if (health === 'needs_attention') {
    return 'amber'
  }

  if (health === 'complete') {
    return 'green'
  }

  return 'blue'
}

function conversionStatusLabel(status: PilotConversionRecord['conversionStatus']) {
  return status.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())
}

function billingStatusLabel(status: AppBillingRecord['billingStatus']) {
  return status.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())
}

function formatBillingPlan(planId: AppBillingRecord['planId']) {
  return getBillingPlan(planId)?.name ?? planId
}

function formatInvoice(record: AppBillingRecord) {
  if (!record.stripeInvoiceId) {
    return 'No Stripe invoice'
  }

  return `Invoice ${record.stripeInvoiceId} · ${record.stripeInvoiceStatus ?? 'status unknown'}`
}

function formatSubscription(record: AppBillingRecord) {
  if (!record.stripeSubscriptionId) {
    return 'No Stripe subscription'
  }

  return `Subscription ${record.stripeSubscriptionId} · ${record.stripeSubscriptionStatus ?? 'status unknown'}`
}

function formatMoney(amount: number | undefined, currency: string) {
  if (amount === undefined) {
    return 'No'
  }

  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount / 100)
}

function formatDuration(minutes: number | null) {
  if (minutes === null) {
    return 'Not tracked'
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours === 0) {
    return `${remainingMinutes}m`
  }

  if (remainingMinutes === 0) {
    return `${hours}h`
  }

  return `${hours}h ${remainingMinutes}m`
}

function formatMajorAmount(amount: number | undefined) {
  return amount === undefined ? '' : String(amount / 100)
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function formatConnectedSystems(systems: WorkspacePackagingMetrics['connectedSystems']) {
  return systems.length > 0 ? systems.join(', ') : 'No connected systems'
}
