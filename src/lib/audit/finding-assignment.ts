import { findingAssignmentOwnerSchema, findingSchema, type Finding, type FindingAssignmentOwner } from './schemas'

export const findingAssignmentOwners = [
  { value: 'finance', label: 'Finance' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'revops', label: 'RevOps' },
  { value: 'product', label: 'Product owner' },
] as const satisfies Array<{ value: FindingAssignmentOwner; label: string }>

export function assignFinding(
  finding: Finding,
  input: {
    owner: FindingAssignmentOwner
    assignedBy: string
    note?: string
  },
  now = new Date(),
): Finding {
  return findingSchema.parse({
    ...finding,
    assignment: {
      owner: findingAssignmentOwnerSchema.parse(input.owner),
      assignedBy: input.assignedBy,
      assignedAt: now.toISOString(),
      ...(trimToUndefined(input.note) ? { note: trimToUndefined(input.note) } : {}),
    },
  })
}

export function findingAssignmentOwnerLabel(owner: FindingAssignmentOwner | undefined): string {
  return findingAssignmentOwners.find((candidate) => candidate.value === owner)?.label ?? 'Unassigned'
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed && trimmed.length > 0 ? trimmed : undefined
}
