import { NextResponse } from 'next/server'

import { createAuditLogEvent } from '@/lib/audit/audit-log'
import {
  getAuditLogStore,
  getDownloadTokenSecret,
  getUploadStorage,
  getUploadStore,
} from '@/lib/audit/upload-runtime'
import { verifyUploadDownloadToken } from '@/lib/audit/uploads'
import { getSessionSecret, isInternalAdmin, readSessionFromCookieHeader } from '@/lib/auth/access'

export async function GET(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await context.params
  const token = new URL(request.url).searchParams.get('token')
  const session = readSessionFromCookieHeader(request.headers.get('cookie'), getSessionSecret())

  if (!session) {
    return NextResponse.json({ error: 'Login required' }, { status: 401 })
  }

  if (!isInternalAdmin(session)) {
    return NextResponse.json({ error: 'Internal admin required' }, { status: 403 })
  }

  if (!token) {
    return NextResponse.json({ error: 'Missing download token' }, { status: 403 })
  }

  let payload: ReturnType<typeof verifyUploadDownloadToken>

  try {
    payload = verifyUploadDownloadToken(token, getDownloadTokenSecret())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid download token' }, { status: 403 })
  }

  if (payload.uploadId !== uploadId) {
    return NextResponse.json({ error: 'Download token does not match requested upload' }, { status: 403 })
  }

  const upload = (await getUploadStore().listByWorkspace(payload.workspaceId)).find((candidate) => candidate.id === uploadId)

  if (!upload) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  let bytes: Buffer

  try {
    bytes = await getUploadStorage().readBytes(upload.storageKey)
  } catch (error) {
    if (isMissingFileError(error)) {
      return NextResponse.json({ error: 'Uploaded file bytes not found' }, { status: 404 })
    }

    throw error
  }

  await getAuditLogStore().append(
    createAuditLogEvent({
      organizationId: upload.organizationId,
      workspaceId: upload.workspaceId,
      actorId: session.userId,
      action: 'file_downloaded',
      targetType: 'upload',
      targetId: upload.id,
      metadata: {
        filename: upload.filename,
        category: upload.category,
        byteSize: upload.byteSize,
      },
    }),
  )

  return new Response(new Blob([new Uint8Array(bytes)]), {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${escapeHeaderValue(upload.filename)}"`,
      'Content-Length': bytes.byteLength.toString(),
      'Content-Type': upload.contentType,
    },
  })
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, '_')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
