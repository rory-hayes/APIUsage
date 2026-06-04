import { notFound } from 'next/navigation'

import { Button } from '@/components/button'
import { Heading, Subheading } from '@/components/heading'
import { Input } from '@/components/input'
import { Select } from '@/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/table'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { dataDictionaryDataTypeSchema } from '@/lib/audit/data-dictionary'
import { getDataDictionaryStore, getWorkspaceStore } from '@/lib/audit/upload-runtime'
import { REQUIRED_UPLOAD_CATEGORIES } from '@/lib/audit/uploads'
import { requireInternalAdmin } from '@/lib/auth/server'

import { saveDataDictionaryEntryAction } from '../../../actions'

export const dynamic = 'force-dynamic'

export default async function AdminWorkspaceDataDictionaryPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  await requireInternalAdmin()
  const { workspaceId } = await params
  const workspace = await getWorkspaceStore().getById(workspaceId)

  if (!workspace) {
    notFound()
  }

  const entries = await getDataDictionaryStore().listByWorkspace(workspace.id)
  const documentedSources = new Set(entries.map((entry) => entry.sourceCategory)).size

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Button href={`/admin/workspaces/${encodeURIComponent(workspace.id)}`} plain>
            Back to workspace
          </Button>
          <Heading className="mt-6">Data dictionary</Heading>
          <Text className="mt-2">
            {workspace.organizationName} - {workspace.auditPeriod}. Document customer-specific field meanings, examples,
            and normalized mappings for parser review.
          </Text>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Summary label="Documented fields">{plural(entries.length, 'documented field')}</Summary>
        <Summary label="Source categories">{plural(documentedSources, 'source category')}</Summary>
        <Summary label="Last update">{entries[0] ? formatTimestamp(entries[0].updatedAt) : 'No entries yet'}</Summary>
      </div>

      <form action={saveDataDictionaryEntryAction} className="mt-10 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
        <input type="hidden" name="workspaceId" value={workspace.id} />
        <div className="font-medium text-zinc-950 dark:text-white">Document field meaning</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="sourceCategory" aria-label="Source category" defaultValue="usage_csv" required>
            {REQUIRED_UPLOAD_CATEGORIES.map((category) => (
              <option key={category.category} value={category.category}>
                {category.label}
              </option>
            ))}
          </Select>
          <Input name="sourceField" aria-label="Source field" placeholder="Source field" required />
          <Input name="normalizedField" aria-label="Normalized field" placeholder="Normalized field" />
          <Select name="dataType" aria-label="Data type" defaultValue="unknown">
            {dataDictionaryDataTypeSchema.options.map((dataType) => (
              <option key={dataType} value={dataType}>
                {dataType}
              </option>
            ))}
          </Select>
          <Input name="exampleValue" aria-label="Example value" placeholder="Example value" className="lg:col-span-2" />
          <Input name="meaning" aria-label="Field meaning" placeholder="Customer-specific field meaning" className="lg:col-span-2" required />
        </div>
        <Textarea name="notes" aria-label="Data dictionary notes" className="mt-3" placeholder="Review notes, assumptions, or confirmation source" />
        <div className="mt-4">
          <Button type="submit">Save field meaning</Button>
        </div>
      </form>

      <Subheading className="mt-12">Field meanings</Subheading>
      {entries.length === 0 ? (
        <Text className="mt-4">No field meanings have been documented for this workspace yet.</Text>
      ) : (
        <Table className="mt-4 [--gutter:--spacing(6)] lg:[--gutter:--spacing(10)]">
          <TableHead>
            <TableRow>
              <TableHeader>Source field</TableHeader>
              <TableHeader>Normalized field</TableHeader>
              <TableHeader>Type</TableHeader>
              <TableHeader>Meaning</TableHeader>
              <TableHeader>Example</TableHeader>
              <TableHeader>Updated</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className="font-medium">{entry.sourceField}</div>
                  <div className="text-zinc-500">{entry.sourceCategory.replaceAll('_', ' ')}</div>
                </TableCell>
                <TableCell>{entry.normalizedField ?? 'Not mapped'}</TableCell>
                <TableCell>{entry.dataType}</TableCell>
                <TableCell>
                  <div className="max-w-sm text-zinc-500">{entry.meaning}</div>
                  {entry.notes ? <div className="mt-1 max-w-sm text-zinc-400">{entry.notes}</div> : null}
                </TableCell>
                <TableCell>{entry.exampleValue ?? 'n/a'}</TableCell>
                <TableCell>
                  <div>{formatTimestamp(entry.updatedAt)}</div>
                  <div className="text-zinc-500">{entry.updatedBy}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

function Summary({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
      <div className="text-sm/6 text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-2 text-2xl/8 font-semibold text-zinc-950 dark:text-white">{children}</div>
    </div>
  )
}

function plural(count: number, singular: string) {
  return count === 1 ? `1 ${singular}` : `${count.toLocaleString('en-IE')} ${singular}s`
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('en-IE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
