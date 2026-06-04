import { Button } from '@/components/button'
import { Subheading } from '@/components/heading'
import { Text } from '@/components/text'
import { DEFAULT_RULE_TEMPLATES } from '@/lib/audit/rule-templates'

import { runReconciliationAction } from './actions'

export function RuleTemplateRunForm({ workspaceId }: { workspaceId?: string }) {
  return (
    <form
      id="rule-template-library"
      action={runReconciliationAction}
      className="mt-10 rounded-lg border border-zinc-950/10 bg-white p-5 shadow-xs dark:border-white/10 dark:bg-zinc-900"
    >
      {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Subheading>Rule template library</Subheading>
          <Text className="mt-2">Select reusable reconciliation templates for this workspace run.</Text>
        </div>
        <Button type="submit">Run checks</Button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {DEFAULT_RULE_TEMPLATES.map((template) => (
          <label key={template.id} className="rounded-lg border border-zinc-950/10 p-4 dark:border-white/10">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                name="ruleTemplateIds"
                value={template.id}
                defaultChecked={template.defaultEnabled}
                className="mt-1 size-4 rounded border-zinc-300"
              />
              <span>
                <span className="block font-medium text-zinc-950 dark:text-white">{template.name}</span>
                <span className="mt-1 block text-sm/6 text-zinc-500 dark:text-zinc-400">{template.description}</span>
                <span className="mt-2 block text-xs/5 text-zinc-400">{template.requiredInputs.join(', ')}</span>
              </span>
            </div>
          </label>
        ))}
      </div>
    </form>
  )
}
