import { NextResponse } from 'next/server'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import {
  buildEvidencePackForWorkspace,
  renderEvidencePackCsv,
  renderEvidencePackMarkdown,
  renderEvidencePackPdf,
  renderReadoutSummaryPdf,
} from '@/lib/audit/evidence-pack'
import { buildIntakeAnswerList } from '@/lib/audit/intake'
import { applyReportBuilderConfig } from '@/lib/audit/report-builder'
import { getAuditLogStore, getFindingStore, getIntakeStore, getReportBuilderConfigStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { getSessionSecret, readSessionFromCookieHeader } from '@/lib/auth/access'

const formats = {
  csv: {
    contentType: 'text/csv; charset=utf-8',
    extension: 'csv',
    filenameSuffix: 'evidence-pack',
    render: renderEvidencePackCsv,
  },
  markdown: {
    contentType: 'text/markdown; charset=utf-8',
    extension: 'md',
    filenameSuffix: 'evidence-pack',
    render: renderEvidencePackMarkdown,
  },
  pdf: {
    contentType: 'application/pdf',
    extension: 'pdf',
    filenameSuffix: 'evidence-pack',
    render: renderEvidencePackPdf,
  },
  readout: {
    contentType: 'application/pdf',
    extension: 'pdf',
    filenameSuffix: 'readout-summary',
    render: renderReadoutSummaryPdf,
  },
} as const

type EvidencePackFormat = keyof typeof formats

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

  const format = readFormat(request)

  if (!format) {
    return NextResponse.json({ error: 'Unsupported evidence pack format' }, { status: 400 })
  }

  const [findings, intakeResponse, reportConfig] = await Promise.all([
    getFindingStore().listByWorkspace(workspace.id),
    getIntakeStore().getByWorkspace(workspace.id),
    getReportBuilderConfigStore().getByWorkspace(workspace.id),
  ])
  const pack = buildEvidencePackForWorkspace({
    workspace,
    findings: applyReportBuilderConfig(findings, reportConfig),
    intakeAnswers: buildIntakeAnswerList(intakeResponse?.answers ?? {}),
  })
  const rendered = formats[format].render(pack)
  const bytes = typeof rendered === 'string' ? new TextEncoder().encode(rendered) : rendered

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: workspace.organizationId,
      workspaceId: workspace.id,
      actorId: session.userId,
      action: 'evidence_pack_downloaded',
      targetType: 'evidence_pack',
      targetId: workspace.id,
      metadata: {
        byteSize: bytes.byteLength,
        findingCount: pack.summary.findingCount,
        format,
      },
    }),
  )

  return new Response(toArrayBuffer(bytes), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${filenameFor(
        workspace.organizationName,
        workspace.auditPeriod,
        formats[format].filenameSuffix,
        formats[format].extension,
      )}"`,
      'Content-Length': bytes.byteLength.toString(),
      'Content-Type': formats[format].contentType,
    },
  })
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function readFormat(request: Request): EvidencePackFormat | null {
  const format = new URL(request.url).searchParams.get('format') ?? 'markdown'

  return format === 'markdown' || format === 'csv' || format === 'pdf' || format === 'readout' ? format : null
}

function filenameFor(organizationName: string, auditPeriod: string, suffix: string, extension: string) {
  return `${slug(organizationName)}-${slug(auditPeriod)}-${suffix}.${extension}`
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
