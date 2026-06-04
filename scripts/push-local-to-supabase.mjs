import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const localDir = join(root, '.local')
const localFilesDir = join(localDir, 'files')

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const supabaseKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
}

const jsonFiles = [
  'account-mappings.json',
  'app-billing.json',
  'audit-log.json',
  'contract-terms.json',
  'data-dictionary.json',
  'finding-comments.json',
  'finding-suppressions.json',
  'findings.json',
  'intake.json',
  'invites.json',
  'parse-jobs.json',
  'parsed-records.json',
  'pilot-conversions.json',
  'pricing-rules.json',
  'reconciliation-schedules.json',
  'reminder-emails.json',
  'report-builder.json',
  'rule-runs.json',
  'stripe-connections.json',
  'stripe-resource-snapshots.json',
  'stripe-sync-runs.json',
  'upload-comments.json',
  'uploads.json',
  'warehouse-connections.json',
  'workspaces.json',
]

let documentCount = 0
let uploadObjectCount = 0

for (const file of jsonFiles) {
  try {
    const raw = await readFile(join(localDir, file), 'utf8')
    await supabaseFetch('audit_json_documents?on_conflict=document_key', {
      body: JSON.stringify({
        document_key: documentKey(file),
        data: JSON.parse(raw),
      }),
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      method: 'POST',
    })
    documentCount += 1
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

for (const filePath of await listFiles(localFilesDir)) {
  const bytes = await readFile(filePath)
  const storageKey = relative(localFilesDir, filePath)

  await supabaseFetch('audit_upload_objects?on_conflict=storage_key', {
    body: JSON.stringify({
      storage_key: storageKey,
      content_type: contentTypeFor(filePath),
      bytes_base64: bytes.toString('base64'),
    }),
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    method: 'POST',
  })
  uploadObjectCount += 1
}

console.log(`Pushed ${documentCount} JSON documents and ${uploadObjectCount} upload objects to Supabase.`)

async function supabaseFetch(path, init) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    body: init.body,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    method: init.method,
  })

  if (!response.ok) {
    const body = await response.text()

    throw new Error(`Supabase request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`)
  }
}

async function listFiles(dir) {
  try {
    const entries = await readdir(dir)
    const paths = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry)
        const metadata = await stat(path)

        return metadata.isDirectory() ? listFiles(path) : path
      }),
    )

    return paths.flat()
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

function documentKey(filePath) {
  const filename = basename(filePath)
  const extension = extname(filename)

  return extension ? filename.slice(0, -extension.length) : filename
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.csv')) {
    return 'text/csv'
  }

  if (filePath.endsWith('.pdf')) {
    return 'application/pdf'
  }

  return 'application/octet-stream'
}
