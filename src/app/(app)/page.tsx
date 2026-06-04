import type { ComponentProps, ComponentType, SVGProps } from 'react'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarSquareIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  FunnelIcon,
  UserGroupIcon,
} from '@heroicons/react/20/solid'

import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Link } from '@/components/link'
import { getUnmappedAccountReport, type AccountMapping } from '@/lib/audit/account-mapping'
import { dashboardLayout } from '@/lib/audit/dashboard-layout'
import { type ParsedRecord } from '@/lib/audit/parse-jobs'
import { getAccountMappingStore, getFindingStore, getParsedRecordStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { requireCurrentWorkspace } from '@/lib/audit/workspaces'
import { type Finding } from '@/lib/audit/schemas'
import { requireSession } from '@/lib/auth/server'

export const dynamic = 'force-dynamic'

type BadgeColor = ComponentProps<typeof Badge>['color']

type Kpi = {
  label: string
  value: string
  delta: string
  detail: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  iconClassName: string
}

type RiskAccount = {
  account: string
  issue: string
  impact: string
  status: string
  statusColor: BadgeColor
  detected: string
}

type LeakageType = {
  label: string
  amount: string
  share: number
  percent: string
  color: string
}

type CloseReadinessMetric = {
  label: string
  value: number
  color: string
}

type TrendPoint = {
  label: string
  value: number
}

type TrendTick = {
  key: string
  value: number
}

const leakageColors = ['bg-blue-600', 'bg-teal-500', 'bg-violet-500', 'bg-orange-500', 'bg-rose-500']

export default async function Home() {
  const session = await requireSession()
  const workspace = requireCurrentWorkspace(session, await getWorkspaceStore().list())
  const [findings, parsedRecords, accountMappings] = await Promise.all([
    getFindingStore().listByWorkspace(workspace.id),
    getParsedRecordStore().listByWorkspace(workspace.id),
    getAccountMappingStore().listByWorkspace(workspace.id),
  ])
  const openFindings = findings.filter(isOpenFinding)
  const riskAccounts = buildRiskAccounts(openFindings)
  const trendPoints = buildTrendPoints(openFindings)
  const leakageTypes = buildLeakageTypes(openFindings)
  const weeklySummary = buildWeeklySummary(findings, openFindings)
  const closeReadiness = buildCloseReadiness(parsedRecords, accountMappings)
  const kpis = buildKpis(findings, openFindings)

  return (
    <div className={dashboardLayout.page}>
      <div className={dashboardLayout.header}>
        <div>
          <h1 className="text-2xl/7 font-semibold text-[#07143a] 2xl:text-3xl/8">Revenue Integrity OS</h1>
          <p className="mt-1 max-w-3xl text-sm/5 text-slate-500">
            {workspace.organizationName} - {workspace.auditPeriod} control cockpit for usage, billing, contracts, and
            AI/API margin.
          </p>
        </div>
        <div className={dashboardLayout.headerActions}>
          <Button outline>
            <CalendarDaysIcon data-slot="icon" />
            {workspace.auditPeriod}
          </Button>
          <Button outline>
            <FunnelIcon data-slot="icon" />
            Filters
          </Button>
          <Button outline aria-label="Refresh dashboard">
            <ArrowPathIcon data-slot="icon" />
          </Button>
          <Button color="blue">
            <ArrowDownTrayIcon data-slot="icon" />
            Export
          </Button>
        </div>
      </div>

      <section className={dashboardLayout.kpiGrid}>
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <section className={dashboardLayout.primaryGrid}>
        <Panel className={dashboardLayout.trendPanel}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm/6 font-semibold text-slate-950">API Usage Revenue Trend</h2>
              <p className="text-xs/5 text-slate-500">Recovered revenue and chargeable usage exceptions over the selected period.</p>
            </div>
            <Badge color="blue">Daily</Badge>
          </div>
          {trendPoints.length === 0 ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-16 text-sm/6 font-medium text-slate-500">
              No API usage revenue trend has been generated for this workspace yet.
            </div>
          ) : (
            <TrendChart points={trendPoints} />
          )}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <h2 className="text-sm/6 font-semibold text-slate-950">Leakage by Type</h2>
            <Badge color="zinc">This month</Badge>
          </div>
          {leakageTypes.length === 0 ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-sm/6 font-medium text-slate-500">
              No leakage categories have been generated for this workspace yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {leakageTypes.map((item) => (
                <div key={item.label} className={dashboardLayout.leakageTypeRow}>
                  <div className="min-w-0 truncate font-medium text-slate-700">{item.label}</div>
                  <div className="text-right font-semibold whitespace-nowrap text-slate-700">
                    {item.amount} <span className="font-medium text-slate-400">({item.percent})</span>
                  </div>
                  <div className="col-span-2 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.share}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="bg-gradient-to-b from-blue-50 to-white">
          <h2 className="text-sm/6 font-semibold text-slate-950">Weekly Summary</h2>
          {weeklySummary.length === 0 ? (
            <div className="mt-4 rounded-lg border border-blue-100 bg-white/70 px-4 py-8 text-sm/6 font-medium text-slate-500">
              No weekly findings activity has been generated for this workspace yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {weeklySummary.map((item, index) => (
                <div key={item} className="flex gap-3 text-xs/5">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white text-[0.7rem] font-semibold text-blue-600 ring-1 ring-blue-100">
                    {index + 1}
                  </div>
                  <div className="font-medium text-slate-700">{item}</div>
                </div>
              ))}
            </div>
          )}
          <Link href="/evidence-pack" className="mt-4 inline-flex text-sm/6 font-semibold text-blue-600">
            View full report
          </Link>
        </Panel>
      </section>

      <section className={dashboardLayout.secondaryGrid}>
        <Panel>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm/6 font-semibold text-slate-950">Highest Risk Accounts</h2>
              <p className="text-xs/5 text-slate-500">
                {openFindings.length} open finding groups need internal review before customer publication.
              </p>
            </div>
            <Link href="/findings" className="text-sm/6 font-semibold text-blue-600">
              View all accounts
            </Link>
          </div>
          {riskAccounts.length === 0 ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-sm/6 font-medium text-slate-500">
              No open leakage findings have been generated for this workspace yet.
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-[48rem] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs/5 font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Account</th>
                    <th className="px-4 py-2.5 text-left">Issue Type</th>
                    <th className="px-4 py-2.5 text-right">Estimated Impact</th>
                    <th className="px-4 py-2.5 text-left">Status</th>
                    <th className="px-4 py-2.5 text-left">Last Detected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {riskAccounts.map((account) => (
                    <tr key={`${account.account}-${account.issue}`} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{account.account}</td>
                      <td className="px-4 py-2.5 text-slate-600">{account.issue}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{account.impact}</td>
                      <td className="px-4 py-2.5">
                        <Badge color={account.statusColor}>{account.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{account.detected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="text-sm/6 font-semibold text-slate-950">Close Readiness</h2>
          {closeReadiness.length === 0 ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-sm/6 font-medium text-slate-500">
              No account mapping data has been normalized for this workspace yet.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {closeReadiness.map((metric) => (
                <ReadinessBar key={metric.label} label={metric.label} value={metric.value} color={metric.color} />
              ))}
            </div>
          )}
          <a href="/status" className="mt-4 inline-flex text-sm/6 font-semibold text-blue-600">
            View mapping details
          </a>
        </Panel>
      </section>
    </div>
  )
}

function buildKpis(findings: Finding[], openFindings: Finding[]): Kpi[] {
  const moneyAtRisk = sumVariance(openFindings)
  const marginLeak = sumVariance(openFindings.filter((finding) => finding.category === 'cost_exceeds_revenue'))
  const mappingMismatches = openFindings.filter((finding) => finding.category === 'account_mapping_mismatch').length

  return [
    {
      label: 'Money at Risk',
      value: formatMinorCurrency(moneyAtRisk),
      delta: findings.length > 0 ? '+0.0%' : '0.0%',
      detail: 'from open findings',
      icon: BanknotesIcon,
      iconClassName: 'bg-blue-600 text-white',
    },
    {
      label: 'Recovered This Month',
      value: formatMinorCurrency(sumVariance(findings.filter((finding) => finding.status === 'fixed' || finding.status === 'closed'))),
      delta: '+0.0%',
      detail: 'from approved actions',
      icon: ChartBarSquareIcon,
      iconClassName: 'bg-emerald-500 text-white',
    },
    {
      label: 'Open Leakage Issues',
      value: openFindings.length.toLocaleString('en-IE'),
      delta: '+0.0%',
      detail: 'requiring review',
      icon: ExclamationTriangleIcon,
      iconClassName: 'bg-amber-400 text-amber-950',
    },
    {
      label: 'Accounts with Mismatch',
      value: mappingMismatches.toLocaleString('en-IE'),
      delta: '+0.0%',
      detail: 'contract to billing',
      icon: UserGroupIcon,
      iconClassName: 'bg-violet-500 text-white',
    },
    {
      label: 'AI/API Margin Leak',
      value: formatMinorCurrency(marginLeak),
      delta: '+0.0%',
      detail: 'cost above target',
      icon: CpuChipIcon,
      iconClassName: 'bg-cyan-400 text-cyan-950',
    },
  ]
}

function buildRiskAccounts(findings: Finding[]): RiskAccount[] {
  return findings
    .slice()
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Math.abs(b.varianceAmount ?? 0) - Math.abs(a.varianceAmount ?? 0))
    .slice(0, 5)
    .map((finding) => ({
      account: findingCustomerLabel(finding),
      issue: finding.title,
      impact: formatMinorCurrency(finding.varianceAmount ?? 0, finding.currency),
      status: statusLabel(finding),
      statusColor: severityColor(finding.severity),
      detected: detectedDate(finding),
    }))
}

function buildTrendPoints(findings: Finding[]): TrendPoint[] {
  const amountByDate = new Map<string, number>()

  for (const finding of findings) {
    const ranAt = finding.metadata.ranAt

    if (typeof ranAt !== 'string') {
      continue
    }

    const date = new Date(ranAt)

    if (Number.isNaN(date.getTime())) {
      continue
    }

    const key = date.toISOString().slice(0, 10)
    amountByDate.set(key, (amountByDate.get(key) ?? 0) + Math.max(finding.varianceAmount ?? 0, 0))
  }

  return [...amountByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({
      label: new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00.000Z`)),
      value: Math.round((amount / 100_000) * 10) / 10,
    }))
}

function buildLeakageTypes(findings: Finding[]): LeakageType[] {
  const groups = new Map<string, { amount: number; count: number; currency: string }>()

  for (const finding of findings) {
    const label = formatCategory(finding.category)
    const existing = groups.get(label) ?? { amount: 0, count: 0, currency: finding.currency }

    groups.set(label, {
      amount: existing.amount + Math.max(finding.varianceAmount ?? 0, 0),
      count: existing.count + 1,
      currency: existing.currency,
    })
  }

  const totalAmount = [...groups.values()].reduce((total, group) => total + group.amount, 0)
  const totalCount = findings.length

  return [...groups.entries()]
    .sort(([, a], [, b]) => b.amount - a.amount || b.count - a.count)
    .slice(0, 5)
    .map(([label, group], index) => {
      const ratio = totalAmount > 0 ? group.amount / totalAmount : group.count / totalCount
      const percent = Math.round(ratio * 100)

      return {
        label,
        amount: formatCompactMinorCurrency(group.amount, group.currency),
        share: Math.max(8, percent),
        percent: `${percent}%`,
        color: leakageColors[index % leakageColors.length],
      }
    })
}

function buildWeeklySummary(findings: Finding[], openFindings: Finding[]): string[] {
  if (findings.length === 0) {
    return []
  }

  const recoveredAmount = sumVariance(findings.filter((finding) => finding.status === 'fixed' || finding.status === 'closed'))
  const highSeverityCount = openFindings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high').length
  const mappingMismatchCount = openFindings.filter((finding) => finding.category === 'account_mapping_mismatch').length
  const totalMoneyAtRisk = sumVariance(openFindings)
  const summaries = [
    openFindings.length > 0 ? `${openFindings.length.toLocaleString('en-IE')} open leakage ${openFindings.length === 1 ? 'issue' : 'issues'} require review` : undefined,
    totalMoneyAtRisk > 0 ? `${formatCompactMinorCurrency(totalMoneyAtRisk)} currently at risk` : undefined,
    highSeverityCount > 0 ? `${highSeverityCount.toLocaleString('en-IE')} high-priority ${highSeverityCount === 1 ? 'finding' : 'findings'} detected` : undefined,
    mappingMismatchCount > 0 ? `${mappingMismatchCount.toLocaleString('en-IE')} account ${mappingMismatchCount === 1 ? 'mismatch' : 'mismatches'} need mapping review` : undefined,
    recoveredAmount > 0 ? `${formatCompactMinorCurrency(recoveredAmount)} recovered from closed actions` : undefined,
  ]

  return summaries.filter((summary): summary is string => Boolean(summary)).slice(0, 5)
}

function buildCloseReadiness(parsedRecords: ParsedRecord[], accountMappings: AccountMapping[]): CloseReadinessMetric[] {
  if (parsedRecords.length === 0 && accountMappings.length === 0) {
    return []
  }

  const unmappedReport = getUnmappedAccountReport(parsedRecords, accountMappings)
  const unmappedTotal =
    unmappedReport.usageAccountIds.length +
    unmappedReport.stripeCustomerIds.length +
    unmappedReport.contractCustomerIds.length +
    unmappedReport.costAccountIds.length
  const approvedMappings = accountMappings.filter((mapping) => mapping.status === 'approved' || mapping.status === 'manual_override').length
  const suggestedMappings = accountMappings.filter((mapping) => mapping.status === 'suggested').length
  const reviewedOrKnownTotal = approvedMappings + suggestedMappings + unmappedTotal
  const duplicateIdentifierPercent = duplicateMappingPercent(accountMappings)

  return [
    { label: 'Matched accounts', value: percent(approvedMappings, reviewedOrKnownTotal), color: 'bg-emerald-500' },
    { label: 'Missing account IDs', value: percent(unmappedTotal, reviewedOrKnownTotal), color: 'bg-amber-400' },
    { label: 'Suggested mappings', value: percent(suggestedMappings, reviewedOrKnownTotal), color: 'bg-blue-500' },
    { label: 'Duplicate mappings', value: duplicateIdentifierPercent, color: 'bg-rose-500' },
  ]
}

function isOpenFinding(finding: Finding) {
  return !['published', 'accepted', 'rejected', 'fixed', 'ignored', 'closed'].includes(finding.status)
}

function sumVariance(findings: Finding[]) {
  return findings.reduce((total, finding) => total + Math.max(finding.varianceAmount ?? 0, 0), 0)
}

function percent(value: number, total: number) {
  if (total === 0) {
    return 0
  }

  return Math.round((value / total) * 100)
}

function duplicateMappingPercent(accountMappings: AccountMapping[]) {
  const identifiers = accountMappings.flatMap((mapping) =>
    [mapping.usageAccountId, mapping.usageCustomerId, mapping.stripeCustomerId, mapping.contractCustomerId, mapping.costAccountId].filter(
      (value): value is string => Boolean(value),
    ),
  )

  if (identifiers.length === 0) {
    return 0
  }

  const counts = new Map<string, number>()

  for (const identifier of identifiers) {
    counts.set(identifier, (counts.get(identifier) ?? 0) + 1)
  }

  const duplicateCount = [...counts.values()].filter((count) => count > 1).length

  return percent(duplicateCount, identifiers.length)
}

function findingCustomerLabel(finding: Finding) {
  const customerName = finding.metadata.customerName

  return typeof customerName === 'string' && customerName.trim().length > 0 ? customerName : finding.customerId ?? 'Account not identified'
}

function statusLabel(finding: Finding) {
  if (finding.severity === 'critical') return 'Critical'
  if (finding.severity === 'high') return 'High Risk'
  if (finding.status === 'needs_review') return 'Review Needed'
  if (finding.status === 'needs_customer_input') return 'Needs Customer Input'
  return finding.status.replaceAll('_', ' ')
}

function formatCategory(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function severityRank(severity: Finding['severity']) {
  if (severity === 'critical') return 5
  if (severity === 'high') return 4
  if (severity === 'medium') return 3
  if (severity === 'low') return 2
  return 1
}

function severityColor(severity: Finding['severity']): BadgeColor {
  if (severity === 'critical' || severity === 'high') return 'red'
  if (severity === 'medium') return 'amber'
  if (severity === 'low') return 'blue'
  return 'zinc'
}

function detectedDate(finding: Finding) {
  const ranAt = finding.metadata.ranAt

  if (typeof ranAt !== 'string') {
    return 'n/a'
  }

  return new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ranAt))
}

function formatMinorCurrency(amount: number, currency = 'eur') {
  return new Intl.NumberFormat('en-IE', {
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(amount / 100)
}

function formatCompactMinorCurrency(amount: number, currency = 'eur') {
  const majorAmount = amount / 100
  const currencyLabel = currency.toUpperCase()

  if (Math.abs(majorAmount) >= 1_000_000) {
    return `${currencyLabel} ${(majorAmount / 1_000_000).toFixed(1)}M`
  }

  if (Math.abs(majorAmount) >= 1_000) {
    return `${currencyLabel} ${(majorAmount / 1_000).toFixed(1)}K`
  }

  return formatMinorCurrency(amount, currency)
}

function KpiCard({
  label,
  value,
  delta,
  detail,
  icon: Icon,
  iconClassName,
}: {
  label: string
  value: string
  delta: string
  detail: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  iconClassName: string
}) {
  return (
    <div className="h-full rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/60">
      <div className="flex items-start gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs/5 font-semibold text-slate-600">{label}</div>
          <div className="mt-0.5 text-xl/6 font-semibold tracking-normal text-[#07143a] 2xl:text-2xl/7">{value}</div>
          <div className="mt-1 text-xs/5 text-slate-500">
            <span className="font-semibold text-emerald-600">{delta}</span> {detail}
          </div>
        </div>
      </div>
    </div>
  )
}

function Panel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <div className={`${dashboardLayout.panel} ${className}`}>{children}</div>
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 640
  const height = 220
  const paddingX = 44
  const paddingY = 24
  const values = points.map((point) => point.value)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(max - min, 1)
  const tickValues = buildTrendTicks(max)
  const chartPoints = values.map((value, index) => {
    const x = values.length === 1 ? width - paddingY : paddingX + (index / (values.length - 1)) * (width - paddingX - paddingY)
    const y = height - paddingY - ((value - min) / range) * (height - paddingY * 2)

    return [x, y] as const
  })
  const linePath = chartPoints.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${width - paddingY} ${height - paddingY} L ${paddingX} ${height - paddingY} Z`
  const latest = points.at(-1)
  const footerPoints = chartFooterPoints(points)

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full 2xl:h-56" role="img" aria-label="API usage revenue trend">
        <defs>
          <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {tickValues.map((tick, index) => {
          const y = paddingY + index * ((height - paddingY * 2) / (tickValues.length - 1))

          return (
            <g key={tick.key}>
              <text x="8" y={y + 4} fill="#64748b" fontSize="11" fontWeight="500">
                EUR {tick.value}K
              </text>
              <line x1={paddingX} x2={width - paddingY} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
            </g>
          )
        })}
        <path d={areaPath} fill="url(#trendArea)" />
        <path d={linePath} fill="none" stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <circle cx={chartPoints.at(-1)?.[0]} cy={chartPoints.at(-1)?.[1]} r="4" fill="#2563eb" stroke="white" strokeWidth="3" />
      </svg>
      <div className="mt-1 ml-11 flex items-center justify-between text-xs/5 text-slate-500">
        {footerPoints.map((point) => (
          <span key={`${point.label}-${point.value}`}>{point.label}</span>
        ))}
        {latest ? <span className="font-semibold text-blue-600">{latest.label} EUR {latest.value.toFixed(1)}K</span> : null}
      </div>
    </div>
  )
}

export function buildTrendTicks(max: number): TrendTick[] {
  const maxTick = Math.max(1, Math.ceil(max / 10) * 10)

  return [maxTick, Math.round(maxTick * 0.67), Math.round(maxTick * 0.33), 0].map((value, index) => ({
    key: `${index}-${value}`,
    value,
  }))
}

function chartFooterPoints(points: TrendPoint[]) {
  if (points.length <= 4) {
    return points.slice(0, -1)
  }

  return [points[0], points[Math.floor(points.length / 3)], points[Math.floor((points.length * 2) / 3)], points.at(-2)].filter(
    (point): point is TrendPoint => Boolean(point),
  )
}

function ReadinessBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs/5">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-semibold text-slate-900">{value}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}
