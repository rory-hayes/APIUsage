import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Divider } from '@/components/divider'
import { Field, Label } from '@/components/fieldset'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { type PricingRule } from '@/lib/audit/pricing-rules'
import { getStripeConnectorHealth } from '@/lib/audit/stripe-connector'
import {
  getPricingRuleStore,
  getReconciliationScheduleStore,
  getStripeConnectionStore,
  getStripeSyncRunStore,
  getWarehouseCsvConnectionStore,
  getWorkspaceStore,
} from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { requireSession } from '@/lib/auth/server'
import type { Metadata } from 'next'
import {
  reviewPricingRuleApprovalAction,
  runStripeSyncAction,
  runWarehouseCsvSyncAction,
  savePricingRuleAction,
  saveReconciliationScheduleAction,
  saveStripeConnectionAction,
  saveWarehouseCsvConnectionAction,
} from './actions'

export const metadata: Metadata = {
  title: 'Workspace settings',
}

export default async function Settings() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const [stripeConnection, stripeSyncRuns, warehouseConnection, reconciliationSchedules, pricingRules] = await Promise.all([
    getStripeConnectionStore().getByWorkspace(workspace.id),
    getStripeSyncRunStore().listByWorkspace(workspace.id),
    getWarehouseCsvConnectionStore().getByWorkspace(workspace.id),
    getReconciliationScheduleStore().listByWorkspace(workspace.id),
    getPricingRuleStore().listByWorkspace(workspace.id),
  ])
  const lastStripeSync = stripeSyncRuns[0] ?? null
  const reconciliationSchedule = reconciliationSchedules[0] ?? null
  const stripeHealth = getStripeConnectorHealth({
    connection: stripeConnection,
    syncRuns: stripeSyncRuns,
  })

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Workspace settings</Heading>
          <Text className="mt-2">Audit workspace defaults for {workspace.organizationName}.</Text>
        </div>
        <Badge color="blue">Invite-only</Badge>
      </div>

      <Divider className="my-10" />

      <section className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="space-y-1">
          <Subheading>Workspace</Subheading>
          <Text>The customer and audit period shown across the portal.</Text>
        </div>
        <div className="grid gap-4">
          <Field>
            <Label>Customer name</Label>
            <Input name="customer_name" defaultValue={workspace.organizationName} />
          </Field>
          <Field>
            <Label>Audit period</Label>
            <Input name="audit_period" defaultValue={workspace.auditPeriod} />
          </Field>
        </div>
      </section>

      <Divider className="my-10" soft />

      <section className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Subheading>Pricing rules</Subheading>
            <Badge color={pricingRules.length > 0 ? 'green' : 'zinc'}>{plural(pricingRules.length, 'rule')}</Badge>
          </div>
          <Text>Configure customer-approved rates, allowances, overages, discounts, and effective dates.</Text>
          {pricingRules.length > 0 ? <Text>{pricingRules.map((rule) => rule.name).join(', ')}</Text> : null}
        </div>
        <div className="grid gap-6">
          <form action={savePricingRuleAction} className="grid gap-4">
            <Field>
              <Label>Rule name</Label>
              <Input name="pricingRuleName" placeholder="Enterprise API overage" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label>Rule type</Label>
                <Select name="pricingRuleType" defaultValue="overage_rate" required>
                  <option value="rate">rate</option>
                  <option value="allowance">allowance</option>
                  <option value="overage_rate">overage rate</option>
                  <option value="discount">discount</option>
                </Select>
              </Field>
              <Field>
                <Label>Billing period</Label>
                <Select name="pricingRuleBillingPeriod" defaultValue="">
                  <option value="">billing period</option>
                  <option value="monthly">monthly</option>
                  <option value="quarterly">quarterly</option>
                  <option value="annual">annual</option>
                  <option value="one_time">one time</option>
                  <option value="custom">custom</option>
                </Select>
              </Field>
              <Field>
                <Label>Meter</Label>
                <Input name="pricingRuleMeter" placeholder="llm_tokens" />
              </Field>
              <Field>
                <Label>Unit</Label>
                <Input name="pricingRuleUnit" placeholder="1k_tokens" />
              </Field>
              <Field>
                <Label>Rate</Label>
                <Input name="pricingRuleRate" type="number" step="any" placeholder="1.25" />
              </Field>
              <Field>
                <Label>Allowance</Label>
                <Input name="pricingRuleAllowance" type="number" step="any" placeholder="100000" />
              </Field>
              <Field>
                <Label>Overage threshold</Label>
                <Input name="pricingRuleThreshold" type="number" step="any" placeholder="100000" />
              </Field>
              <Field>
                <Label>Discount percent</Label>
                <Input name="pricingRuleDiscountPercent" type="number" step="any" placeholder="15" />
              </Field>
              <Field>
                <Label>Currency</Label>
                <Input name="pricingRuleCurrency" placeholder="EUR" maxLength={3} />
              </Field>
              <Field>
                <Label>Effective from</Label>
                <Input name="pricingRuleEffectiveFrom" type="date" />
              </Field>
              <Field>
                <Label>Effective to</Label>
                <Input name="pricingRuleEffectiveTo" type="date" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit">Add pricing rule</Button>
            </div>
          </form>

          {pricingRules.length > 0 ? (
            <div className="grid gap-4">
              {pricingRules.map((rule) => (
                <div
                  className="rounded-lg border border-zinc-950/10 bg-white p-4 shadow-xs dark:border-white/10 dark:bg-zinc-900"
                  key={rule.id}
                >
                  <form action={savePricingRuleAction}>
                    <input type="hidden" name="pricingRuleId" value={rule.id} />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-zinc-950 dark:text-white">{rule.name}</div>
                        <Text>{formatPricingRuleValue(rule)}</Text>
                        {rule.status === 'pending_customer_approval' ? (
                          <Text>Customer approval requested by {pricingRuleMetadataString(rule, 'customerApprovalRequestedBy') ?? 'internal admin'}</Text>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Badge color="blue">{rule.type.replaceAll('_', ' ')}</Badge>
                        <Badge color={pricingRuleStatusColor(rule.status)}>{pricingRuleStatusLabel(rule.status)}</Badge>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Input name="pricingRuleName" aria-label={`Name for ${rule.id}`} defaultValue={rule.name} required />
                      <Select name="pricingRuleType" aria-label={`Type for ${rule.id}`} defaultValue={rule.type} required>
                        <option value="rate">rate</option>
                        <option value="allowance">allowance</option>
                        <option value="overage_rate">overage rate</option>
                        <option value="discount">discount</option>
                      </Select>
                      <Input name="pricingRuleMeter" aria-label={`Meter for ${rule.id}`} defaultValue={rule.meter ?? ''} />
                      <Input name="pricingRuleUnit" aria-label={`Unit for ${rule.id}`} defaultValue={rule.unit ?? ''} />
                      <Select name="pricingRuleBillingPeriod" aria-label={`Billing period for ${rule.id}`} defaultValue={rule.billingPeriod ?? ''}>
                        <option value="">billing period</option>
                        <option value="monthly">monthly</option>
                        <option value="quarterly">quarterly</option>
                        <option value="annual">annual</option>
                        <option value="one_time">one time</option>
                        <option value="custom">custom</option>
                      </Select>
                      <Input name="pricingRuleRate" aria-label={`Rate for ${rule.id}`} type="number" step="any" defaultValue={rule.rate?.toString() ?? ''} />
                      <Input
                        name="pricingRuleAllowance"
                        aria-label={`Allowance for ${rule.id}`}
                        type="number"
                        step="any"
                        defaultValue={rule.allowance?.toString() ?? ''}
                      />
                      <Input
                        name="pricingRuleThreshold"
                        aria-label={`Threshold for ${rule.id}`}
                        type="number"
                        step="any"
                        defaultValue={rule.threshold?.toString() ?? ''}
                      />
                      <Input
                        name="pricingRuleDiscountPercent"
                        aria-label={`Discount percent for ${rule.id}`}
                        type="number"
                        step="any"
                        defaultValue={rule.discountPercent?.toString() ?? ''}
                      />
                      <Input name="pricingRuleCurrency" aria-label={`Currency for ${rule.id}`} defaultValue={rule.currency ?? ''} maxLength={3} />
                      <Input
                        name="pricingRuleEffectiveFrom"
                        aria-label={`Effective from for ${rule.id}`}
                        type="date"
                        defaultValue={rule.effectiveFrom ?? ''}
                      />
                      <Input
                        name="pricingRuleEffectiveTo"
                        aria-label={`Effective to for ${rule.id}`}
                        type="date"
                        defaultValue={rule.effectiveTo ?? ''}
                      />
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button type="submit">Update pricing rule</Button>
                    </div>
                  </form>
                  {rule.status === 'pending_customer_approval' && session.role === 'customer_admin' ? (
                    <form action={reviewPricingRuleApprovalAction} className="mt-4 grid gap-3 border-t border-zinc-950/10 pt-4 dark:border-white/10">
                      <input type="hidden" name="pricingRuleId" value={rule.id} />
                      <Field>
                        <Label>Customer approval note</Label>
                        <Textarea name="approvalNote" aria-label={`Approval note for ${rule.id}`} placeholder="Decision note" rows={3} />
                      </Field>
                      <div className="flex flex-wrap justify-end gap-3">
                        <Button type="submit" name="approvalDecision" value="rejected" outline>
                          Reject pricing rule
                        </Button>
                        <Button type="submit" name="approvalDecision" value="approved" color="green">
                          Approve pricing rule
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <Divider className="my-10" soft />

      <section className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Subheading>Pre-close reconciliation</Subheading>
            <Badge color={reconciliationSchedule ? 'green' : 'zinc'}>
              {reconciliationSchedule ? reconciliationSchedule.cadence : 'Not scheduled'}
            </Badge>
          </div>
          {reconciliationSchedule ? <Text>{reconciliationSchedule.name}</Text> : null}
          {reconciliationSchedule ? (
            <Text>
              Next run: {formatDateTime(reconciliationSchedule.runAt)} for {reconciliationSchedule.periodStart} to{' '}
              {reconciliationSchedule.periodEnd}
            </Text>
          ) : null}
          {reconciliationSchedule ? <Text>Late-usage close window: {reconciliationSchedule.lateUsageGracePeriodDays} days</Text> : null}
          {reconciliationSchedule?.lastRunAt ? <Text>Last run: {formatDateTime(reconciliationSchedule.lastRunAt)}</Text> : null}
        </div>
        <form action={saveReconciliationScheduleAction} className="grid gap-4">
          <Field>
            <Label>Schedule name</Label>
            <Input
              name="scheduleName"
              defaultValue={reconciliationSchedule?.name ?? `${workspace.auditPeriod} pre-close check`}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Period start</Label>
              <Input name="periodStart" type="date" defaultValue={reconciliationSchedule?.periodStart} required />
            </Field>
            <Field>
              <Label>Period end</Label>
              <Input name="periodEnd" type="date" defaultValue={reconciliationSchedule?.periodEnd} required />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Run at</Label>
              <Input name="runAt" type="datetime-local" defaultValue={dateTimeLocalValue(reconciliationSchedule?.runAt)} required />
            </Field>
            <Field>
              <Label>Timezone</Label>
              <Input name="timezone" defaultValue={reconciliationSchedule?.timezone ?? 'Europe/Dublin'} required />
            </Field>
          </div>
          <Field>
            <Label>Late-usage close window (days)</Label>
            <Input
              name="lateUsageGracePeriodDays"
              type="number"
              min="0"
              step="1"
              defaultValue={String(reconciliationSchedule?.lateUsageGracePeriodDays ?? 0)}
              required
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit">{reconciliationSchedule ? 'Update schedule' : 'Create schedule'}</Button>
          </div>
        </form>
      </section>

      <Divider className="my-10" soft />

      <section className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Subheading>Warehouse export connector</Subheading>
            <Badge color={warehouseConnection ? 'green' : 'zinc'}>{warehouseConnection ? 'Connected' : 'Not connected'}</Badge>
          </div>
          <Text>Read-only scheduled CSV import for warehouse usage tables.</Text>
          {warehouseConnection ? <Text>Current export: {warehouseConnection.sourceLabel}</Text> : null}
          {warehouseConnection ? <Text>Schedule: {warehouseConnection.schedule}</Text> : null}
        </div>
        <div className="grid gap-6">
          <form action={saveWarehouseCsvConnectionAction} className="grid gap-4">
            <Field>
              <Label>Export label</Label>
              <Input name="sourceLabel" defaultValue={warehouseConnection?.sourceLabel} placeholder="Production warehouse usage" required />
            </Field>
            <Field>
              <Label>Signed export URL</Label>
              <Input name="exportUrl" type="url" placeholder="https://warehouse.example.com/exports/usage.csv" required />
            </Field>
            <Field>
              <Label>Schedule</Label>
              <Select name="schedule" defaultValue={warehouseConnection?.schedule ?? 'manual'}>
                <option value="manual">manual</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label>Account ID column</Label>
                <Input name="usageAccountIdColumn" defaultValue={warehouseConnection?.usageCsvMapping.accountId} placeholder="account_id" />
              </Field>
              <Field>
                <Label>Customer name column</Label>
                <Input name="usageCustomerNameColumn" defaultValue={warehouseConnection?.usageCsvMapping.customerName} placeholder="customer_name" />
              </Field>
              <Field>
                <Label>Meter column</Label>
                <Input name="usageMeterColumn" defaultValue={warehouseConnection?.usageCsvMapping.meter ?? 'meter_name'} required />
              </Field>
              <Field>
                <Label>Quantity column</Label>
                <Input name="usageQuantityColumn" defaultValue={warehouseConnection?.usageCsvMapping.quantity ?? 'total'} required />
              </Field>
              <Field>
                <Label>Unit column</Label>
                <Input name="usageUnitColumn" defaultValue={warehouseConnection?.usageCsvMapping.unit ?? 'unit'} required />
              </Field>
              <Field>
                <Label>Period start column</Label>
                <Input name="usagePeriodStartColumn" defaultValue={warehouseConnection?.usageCsvMapping.periodStart ?? 'start'} required />
              </Field>
              <Field>
                <Label>Period end column</Label>
                <Input name="usagePeriodEndColumn" defaultValue={warehouseConnection?.usageCsvMapping.periodEnd ?? 'end'} required />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit">{warehouseConnection ? 'Update warehouse connector' : 'Connect warehouse export'}</Button>
            </div>
          </form>
          {warehouseConnection ? (
            <form action={runWarehouseCsvSyncAction} className="grid gap-4">
              <Field>
                <Label>One-time export URL</Label>
                <Input name="warehouseExportUrl" type="url" placeholder="https://warehouse.example.com/exports/usage.csv" required />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">Run warehouse sync</Button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      <Divider className="my-10" soft />

      <section className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="space-y-1">
          <Subheading>Systems</Subheading>
          <Text>The first V0 workspace is upload-first with Stripe exports.</Text>
        </div>
        <div className="grid gap-4">
          <Field>
            <Label>Billing system</Label>
            <Select name="billing_system" defaultValue={billingSystemValue(workspace.billingSystem)}>
              <option value="stripe">Stripe</option>
              <option value="chargebee">Chargebee</option>
            </Select>
          </Field>
          <Field>
            <Label>Usage source</Label>
            <Select name="usage_source" defaultValue={usageSourceValue(workspace.usageSource)}>
              <option value="csv">CSV upload</option>
              <option value="warehouse">Warehouse export</option>
            </Select>
          </Field>
        </div>
      </section>

      <Divider className="my-10" soft />

      <section className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Subheading>Stripe connector</Subheading>
            <Badge color={stripeConnection ? 'green' : 'zinc'}>{stripeConnection ? 'Connected' : 'Not connected'}</Badge>
          </div>
          <Text>Read-only API connection for invoices, customers, subscriptions, prices, products, coupons, and credits.</Text>
          {stripeConnection ? <Text>Current account: {stripeConnection.accountLabel}</Text> : null}
          {lastStripeSync ? (
            <Text>
              Last sync: {lastStripeSync.status} · {stripeSyncObjectCount(lastStripeSync)} Stripe objects
            </Text>
          ) : null}
          <div className="space-y-1 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Text>Connector health</Text>
              <Badge color={stripeHealth.badgeColor}>{stripeHealth.label}</Badge>
            </div>
            <Text>{stripeHealth.summary}</Text>
            {stripeHealth.lastSyncAt ? <Text>Last checked: {formatDateTime(stripeHealth.lastSyncAt)}</Text> : null}
            {stripeHealth.failedResources.length > 0 ? (
              <div className="grid gap-1">
                {stripeHealth.failedResources.map((resource) => (
                  <Text key={resource.resource}>
                    {resource.resource}: {resource.error}
                  </Text>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid gap-6">
          <form action={saveStripeConnectionAction} className="grid gap-4">
            <Field>
              <Label>Account label</Label>
              <Input name="accountLabel" defaultValue={stripeConnection?.accountLabel} placeholder="Production Stripe" required />
            </Field>
            <Field>
              <Label>Secret key</Label>
              <Input name="secretKey" type="password" placeholder="sk_live_..." required />
            </Field>
            <div className="flex justify-end">
              <Button type="submit">{stripeConnection ? 'Update connector' : 'Connect Stripe'}</Button>
            </div>
          </form>
          {stripeConnection ? (
            <form action={runStripeSyncAction} className="grid gap-4">
              <Field>
                <Label>One-time sync key</Label>
                <Input name="syncSecretKey" type="password" placeholder="sk_live_..." required />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">Run read-only sync</Button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      <Divider className="my-10" soft />

      <div className="flex justify-end gap-4">
        <Button type="reset" plain>
          Reset
        </Button>
        <Button type="submit">Save settings</Button>
      </div>
    </div>
  )
}

function billingSystemValue(value: string) {
  return value.trim().toLowerCase() === 'chargebee' ? 'chargebee' : 'stripe'
}

function usageSourceValue(value: string) {
  return value.trim().toLowerCase().includes('warehouse') ? 'warehouse' : 'csv'
}

function stripeSyncObjectCount(syncRun: { resources: Array<{ objectCount: number }> }) {
  return syncRun.resources.reduce((total, resource) => total + resource.objectCount, 0)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-IE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function dateTimeLocalValue(value?: string) {
  return value ? value.slice(0, 16) : undefined
}

function formatPricingRuleValue(rule: PricingRule) {
  const qualifiers = [
    rule.billingPeriod,
    rule.threshold !== undefined ? `threshold ${rule.threshold.toLocaleString('en-IE')}` : undefined,
    rule.effectiveFrom ? `from ${rule.effectiveFrom}` : undefined,
  ].filter(Boolean)
  const suffix = qualifiers.length > 0 ? ` (${qualifiers.join(', ')})` : ''

  if (rule.type === 'rate' || rule.type === 'overage_rate') {
    return `${[rule.rate, rule.currency, rule.unit ? `per ${rule.unit}` : undefined].filter(Boolean).join(' ')}${suffix}`
  }

  if (rule.type === 'allowance') {
    return `${rule.allowance?.toLocaleString('en-IE') ?? 0} ${rule.unit ?? 'units'}${suffix}`
  }

  return `${rule.discountPercent?.toLocaleString('en-IE') ?? 0}%${rule.effectiveTo ? ` until ${rule.effectiveTo}` : ''}${suffix}`
}

function pricingRuleStatusLabel(status: PricingRule['status']) {
  switch (status) {
    case 'active':
      return 'Active'
    case 'inactive':
      return 'Inactive'
    case 'pending_customer_approval':
      return 'Pending customer approval'
    case 'rejected':
      return 'Rejected'
  }
}

function pricingRuleStatusColor(status: PricingRule['status']) {
  switch (status) {
    case 'active':
      return 'green' as const
    case 'inactive':
      return 'zinc' as const
    case 'pending_customer_approval':
      return 'amber' as const
    case 'rejected':
      return 'red' as const
  }
}

function pricingRuleMetadataString(rule: PricingRule, key: string) {
  const value = rule.metadata[key]

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function plural(count: number, singular: string) {
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-IE')} ${singular}s`
}
