import { NextResponse } from 'next/server'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import { isCustomerVisibleFinding } from '@/lib/audit/evidence-pack'
import { renderFindingTicketCsv, type FindingsCsvAudience } from '@/lib/audit/findings-export'
import { getAuditLogStore, getFindingStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { getSessionSecret, readSessionFromCookieHeader } from '@/lib/auth/access'

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string; findingId: string }> }) {
  const { workspaceId, findingId } = await context.params
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
  const finding = findings.find((candidate) => candidate.id === findingId)

  if (!finding || (audience === 'customer' && !isCustomerVisibleFinding(finding))) {
    return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
  }

  const sourceUrl = new URL(`/workspaces/${encodeURIComponent(workspace.id)}/findings/${encodeURIComponent(finding.id)}`, request.url).toString()
  const bytes = new TextEncoder().encode(
    renderFindingTicketCsv(finding, {
      audience,
      sourceUrl,
      workspaceName: workspace.name,
    }),
  )

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'findings_csv_downloaded',
      targetType: 'finding',
      targetId: finding.id,
      metadata: {
        audience,
        byteSize: bytes.byteLength,
        exportType: 'ticket_csv',
        findingId: finding.id,
      },
    }),
  )

  return new Response(toArrayBuffer(bytes), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filenameFor(finding.title)}"`,
      'Content-Length': bytes.byteLength.toString(),
      'Content-Type': 'text/csv; charset=utf-8',
    },
  })
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function filenameFor(title: string) {
  return `${slug(title)}-ticket.csv`
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
