import { Buffer } from 'node:buffer'
import { mkdir as fsMkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

type SupabaseJsonDocumentRow = {
  data: unknown
}

type SupabaseUploadObjectRow = {
  bytes_base64: string
}

export function isSupabasePersistenceEnabled(): boolean {
  return process.env.AUDIT_PERSISTENCE_DRIVER === 'supabase'
}

export async function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined> {
  if (isSupabasePersistenceEnabled()) {
    return undefined
  }

  return fsMkdir(path, options)
}

export async function readJsonFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  if (!isSupabasePersistenceEnabled()) {
    return readFile(filePath, encoding)
  }

  const response = await supabaseFetch(
    `audit_json_documents?document_key=eq.${encodeURIComponent(documentKey(filePath))}&select=data`,
    {
      method: 'GET',
    },
  )
  const rows = (await response.json()) as SupabaseJsonDocumentRow[]
  const row = rows[0]

  if (!row) {
    throw missingDocumentError(filePath)
  }

  return JSON.stringify(row.data)
}

export async function writeJsonFile(filePath: string, contents: string, _encoding: BufferEncoding = 'utf8'): Promise<void> {
  if (!isSupabasePersistenceEnabled()) {
    await writeFile(filePath, contents, _encoding)
    return
  }

  await supabaseFetch('audit_json_documents?on_conflict=document_key', {
    body: JSON.stringify({
      document_key: documentKey(filePath),
      data: JSON.parse(contents),
    }),
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    method: 'POST',
  })
}

export async function writeSupabaseUploadBytes(input: {
  storageKey: string
  bytes: Buffer
  contentType: string
}): Promise<void> {
  await supabaseFetch('audit_upload_objects?on_conflict=storage_key', {
    body: JSON.stringify({
      storage_key: input.storageKey,
      content_type: input.contentType,
      bytes_base64: input.bytes.toString('base64'),
    }),
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    method: 'POST',
  })
}

export async function readSupabaseUploadBytes(storageKey: string): Promise<Buffer> {
  const response = await supabaseFetch(`audit_upload_objects?storage_key=eq.${encodeURIComponent(storageKey)}&select=bytes_base64`, {
    method: 'GET',
  })
  const rows = (await response.json()) as SupabaseUploadObjectRow[]
  const row = rows[0]

  if (!row) {
    throw missingDocumentError(storageKey)
  }

  return Buffer.from(row.bytes_base64, 'base64')
}

export async function deleteSupabaseUploadWorkspace(workspaceId: string): Promise<void> {
  await supabaseFetch(`audit_upload_objects?storage_key=like.${encodeURIComponent(`workspaces/${slug(workspaceId)}/%`)}`, {
    method: 'DELETE',
  })
}

async function supabaseFetch(
  path: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: 'DELETE' | 'GET' | 'POST'
  },
): Promise<Response> {
  const { url, key } = supabaseConfig()
  const response = await fetch(`${url}/rest/v1/${path}`, {
    body: init.body,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    method: init.method,
  })

  if (!response.ok) {
    const body = await response.text()

    throw new Error(`Supabase persistence request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`)
  }

  return response
}

function supabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  if (!url || !key) {
    throw new Error('Supabase persistence requires SUPABASE_URL and SUPABASE_SECRET_KEY')
  }

  return {
    url: url.replace(/\/$/, ''),
    key,
  }
}

function documentKey(filePath: string): string {
  const filename = basename(filePath)
  const extension = extname(filename)

  return extension ? filename.slice(0, -extension.length) : filename
}

function missingDocumentError(path: string): NodeJS.ErrnoException {
  const error = new Error(`No Supabase persistence document exists for ${path}`) as NodeJS.ErrnoException

  error.code = 'ENOENT'

  return error
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
