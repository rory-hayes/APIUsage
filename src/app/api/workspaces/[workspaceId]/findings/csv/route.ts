import { NextResponse } from 'next/server'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { renderFindingsCsv, selectFindingsForCsvExport, type FindingsCsvAudience } from '@/lib/audit/findings-export'
import { getAuditLogStore, getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { getSessionSecret, readSessionFromCookieHeader } from '@/lib/auth/access'

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params
  const session = readSessionFromCookieHeader(request.headers.get('cookie'), getSessionSecret())

  if (!session) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 })
  }

  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  if (session.role !== 'internal_admin' && !session.workspaceIds.includes(workspace.id)) {
    return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
  }

  const audience: FindingsCsvAudience = session.role === 'internal_admin' ? 'internal' : 'customer'
  const findings = await getFindingStore().listByWorkspace(workspace.id)
  const exportedFindings = selectFindingsForCsvExport(findings, audience)
  const bytes = new TextEncoder().encode(renderFindingsCsv(findings, { audience }))

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'findings_csv_downloaded',
      targetType: 'findings_export',
      targetId: workspace.id,
      metadata: {
        audience,
        byteSize: bytes.byteLength,
        findingCount: exportedFindings.length,
      },
    }),
  )

  return new Response(toArrayBuffer(bytes), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filenameFor(workspace.organizationName, workspace.auditPeriod)}"`,
      'Content-Length': bytes.byteLength.toString(),
      'Content-Type': 'text/csv; charset=utf-8',
    },
  })
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function filenameFor(organizationName: string, auditPeriod: string) {
  return `${slug(organizationName)}-${slug(auditPeriod)}-findings.csv`
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
