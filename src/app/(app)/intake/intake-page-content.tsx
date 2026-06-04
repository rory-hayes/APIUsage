import { Badge } from '@/components/badge'
import { Button } from '@/components/button'
import { Description, Field, FieldGroup, Fieldset, Label, Legend } from '@/components/fieldset'
import { Heading, Subheading } from '@/components/heading'
import { Text } from '@/components/text'
import { Textarea } from '@/components/textarea'
import { INTAKE_QUESTIONS, buildIntakeAnswerList, getIntakeCompleteness } from '@/lib/audit/intake'
import { getIntakeStore } from '@/lib/audit/upload-runtime'
import { type AuditWorkspace } from '@/lib/audit/workspaces'

import { saveIntakeAction } from './actions'

export async function IntakePageContent({
  scoped = false,
  searchParams,
  workspace,
}: {
  scoped?: boolean
  searchParams?: Record<string, string | string[] | undefined>
  workspace: AuditWorkspace
}) {
  const response = await getIntakeStore().getByWorkspace(workspace.id)
  const answers = response?.answers ?? {}
  const completeness = response?.completeness ?? getIntakeCompleteness({})
  const answered = buildIntakeAnswerList(answers)
  const saved = searchParams?.saved === '1'

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <Heading>Intake</Heading>
          <Text className="mt-2">
            Commercial, billing, usage, and close-process context for {workspace.organizationName} - {workspace.auditPeriod}.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge color={statusColor(completeness.status)}>{completeness.status.replaceAll('_', ' ')}</Badge>
          <Text>{completeness.percentComplete}% complete</Text>
        </div>
      </div>

      {saved ? (
        <div className="mt-6 rounded-lg border border-green-600/20 bg-green-50 px-4 py-3 text-sm/6 text-green-800 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-200">
          Intake saved.
        </div>
      ) : null}

      <form action={saveIntakeAction} className="mt-10">
        {scoped ? <input type="hidden" name="workspaceId" value={workspace.id} /> : null}
        <Fieldset>
          <Legend>Audit context</Legend>
          <Text>Save partial answers as a draft. Complete all required questions before the audit readout.</Text>
          <FieldGroup className="mt-8 grid gap-6 xl:grid-cols-2">
            {INTAKE_QUESTIONS.map((question) => (
              <Field key={question.key} className={question.key === 'known_issues' ? 'xl:col-span-2' : undefined}>
                <Label>
                  {question.label}
                  {question.required ? <span className="text-red-600"> *</span> : null}
                </Label>
                <Description>{question.prompt}</Description>
                <Textarea
                  name={question.key}
                  aria-label={question.label}
                  defaultValue={answers[question.key] ?? ''}
                  rows={question.key === 'known_issues' ? 4 : 3}
                  resizable={false}
                />
              </Field>
            ))}
          </FieldGroup>
        </Fieldset>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          <Text>
            {completeness.answeredRequired} of {completeness.requiredQuestions} required answers complete.
          </Text>
          <Button type="submit">Save intake</Button>
        </div>
      </form>

      <Subheading className="mt-12">Saved answers</Subheading>
      {answered.length === 0 ? (
        <Text className="mt-4">No intake answers have been saved yet.</Text>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {answered.map((answer) => (
            <div key={answer.key} className="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-zinc-950 dark:text-white">{answer.label}</div>
                {answer.required ? <Badge color="blue">Required</Badge> : <Badge color="zinc">Optional</Badge>}
              </div>
              <Text className="mt-3">{answer.value}</Text>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function statusColor(status: string) {
  if (status === 'complete') {
    return 'green'
  }

  if (status === 'in_progress') {
    return 'amber'
  }

  return 'zinc'
}
