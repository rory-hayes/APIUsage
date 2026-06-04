import { type ParsedRecord } from './parse-jobs'
import { type ContractTerm } from './schemas'
import { type StripeConnection } from './stripe-connector'
import { type UploadRecord } from './uploads'
import { type WarehouseCsvConnection } from './warehouse-connector'
import { type AuditWorkspace } from './workspaces'

export type ConnectedPackagingSystem = 'Stripe' | 'Warehouse CSV'

export type WorkspacePackagingMetrics = {
  workspaceId: string
  invoiceCount: number
  usageRowCount: number
  contractCount: number
  connectedSystemCount: number
  connectedSystems: ConnectedPackagingSystem[]
}

export function buildWorkspacePackagingMetrics({
  workspace,
  parsedRecords,
  uploads,
  contractTerms,
  stripeConnections,
  warehouseConnections,
}: {
  workspace: AuditWorkspace
  parsedRecords: ParsedRecord[]
  uploads: UploadRecord[]
  contractTerms: ContractTerm[]
  stripeConnections: StripeConnection[]
  warehouseConnections: WarehouseCsvConnection[]
}): WorkspacePackagingMetrics {
  const workspaceRecords = parsedRecords.filter((record) => record.workspaceId === workspace.id)
  const invoiceIds = new Set(workspaceRecords.filter((record) => record.recordType === 'invoice_line').map(invoiceIdentity))
  const contractSourceFileIds = new Set<string>()

  for (const upload of uploads) {
    if (upload.workspaceId === workspace.id && upload.category === 'contracts_order_forms') {
      contractSourceFileIds.add(upload.sourceFileId)
    }
  }

  for (const term of contractTerms) {
    if (term.workspaceId === workspace.id && term.evidence?.sourceFileId) {
      contractSourceFileIds.add(term.evidence.sourceFileId)
    }
  }

  const connectedSystems: ConnectedPackagingSystem[] = []

  if (stripeConnections.some((connection) => connection.workspaceId === workspace.id && connection.status === 'connected')) {
    connectedSystems.push('Stripe')
  }

  if (warehouseConnections.some((connection) => connection.workspaceId === workspace.id && connection.status === 'connected')) {
    connectedSystems.push('Warehouse CSV')
  }

  return {
    workspaceId: workspace.id,
    invoiceCount: invoiceIds.size,
    usageRowCount: workspaceRecords.filter((record) => record.recordType === 'usage').length,
    contractCount: contractSourceFileIds.size,
    connectedSystemCount: connectedSystems.length,
    connectedSystems,
  }
}

function invoiceIdentity(record: ParsedRecord): string {
  const invoiceId = readString(record.data, 'invoiceId') ?? readString(record.data, 'invoice_id') ?? readString(record.data, 'id')

  return invoiceId ?? record.id
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
