import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deleteSupabaseUploadWorkspace,
  isSupabasePersistenceEnabled,
  readJsonFile,
  readSupabaseUploadBytes,
  writeJsonFile,
  writeSupabaseUploadBytes,
} from './persistence'

const ORIGINAL_ENV = {
  AUDIT_PERSISTENCE_DRIVER: process.env.AUDIT_PERSISTENCE_DRIVER,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
}

describe('audit persistence', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.AUDIT_PERSISTENCE_DRIVER = 'supabase'
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SECRET_KEY = 'server-only-secret'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnv()
  })

  it('reads and writes JSON documents through Supabase when enabled', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ document_key: 'uploads', data: [{ id: 'upl_001' }] }]))
      .mockResolvedValueOnce(emptyResponse())

    await expect(readJsonFile('/app/.local/uploads.json', 'utf8')).resolves.toBe(JSON.stringify([{ id: 'upl_001' }]))
    await writeJsonFile('/app/.local/uploads.json', JSON.stringify([{ id: 'upl_002' }]), 'utf8')

    expect(isSupabasePersistenceEnabled()).toBe(true)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co/rest/v1/audit_json_documents?document_key=eq.uploads&select=data',
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: 'server-only-secret',
          Authorization: 'Bearer server-only-secret',
        }),
        method: 'GET',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.supabase.co/rest/v1/audit_json_documents?on_conflict=document_key',
      expect.objectContaining({
        body: JSON.stringify({
          document_key: 'uploads',
          data: [{ id: 'upl_002' }],
        }),
        headers: expect.objectContaining({
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        method: 'POST',
      }),
    )
  })

  it('throws an ENOENT-compatible error when a Supabase document has not been created yet', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    await expect(readJsonFile('/app/.local/findings.json', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stores upload bytes in Supabase for serverless runtimes', async () => {
    fetchMock
      .mockResolvedValueOnce(emptyResponse())
      .mockResolvedValueOnce(jsonResponse([{ bytes_base64: Buffer.from('account_id,total\nacct_1,42\n').toString('base64') }]))
      .mockResolvedValueOnce(emptyResponse())

    await writeSupabaseUploadBytes({
      storageKey: 'workspaces/workspace_acme_may_2026/usage.csv',
      bytes: Buffer.from('account_id,total\nacct_1,42\n'),
      contentType: 'text/csv',
    })
    await expect(readSupabaseUploadBytes('workspaces/workspace_acme_may_2026/usage.csv')).resolves.toEqual(
      Buffer.from('account_id,total\nacct_1,42\n'),
    )
    await deleteSupabaseUploadWorkspace('workspace_acme_may_2026')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.supabase.co/rest/v1/audit_upload_objects?on_conflict=storage_key',
      expect.objectContaining({
        body: JSON.stringify({
          storage_key: 'workspaces/workspace_acme_may_2026/usage.csv',
          content_type: 'text/csv',
          bytes_base64: Buffer.from('account_id,total\nacct_1,42\n').toString('base64'),
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.supabase.co/rest/v1/audit_upload_objects?storage_key=like.workspaces%2Fworkspace_acme_may_2026%2F%25',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  }
}

function emptyResponse() {
  return {
    ok: true,
    status: 204,
    json: async () => null,
    text: async () => '',
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}
