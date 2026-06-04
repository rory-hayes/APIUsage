import { dirname } from 'node:path'
import { z } from 'zod'

import { mkdir, readJsonFile as readFile, writeJsonFile as writeFile } from './persistence'

export const INTAKE_QUESTIONS = [
  {
    key: 'billing_model',
    label: 'Billing model',
    prompt: 'How do customers pay today? Include base subscription, usage, credits, minimums, and overages.',
    required: true,
  },
  {
    key: 'billing_systems',
    label: 'Billing systems',
    prompt: 'Which systems create invoices, subscriptions, credits, or usage-based charges?',
    required: true,
  },
  {
    key: 'usage_units',
    label: 'Usage units',
    prompt: 'Which product usage units should reconcile to billing? Include units, meters, and source systems.',
    required: true,
  },
  {
    key: 'credits_overages',
    label: 'Credits and overages',
    prompt: 'How are prepaid credits, included allowances, overages, minimums, or rollovers handled?',
    required: true,
  },
  {
    key: 'custom_contracts',
    label: 'Custom contracts',
    prompt: 'Which customers have non-standard contract terms, pricing, amendments, discounts, or entitlements?',
    required: true,
  },
  {
    key: 'close_process',
    label: 'Month-end close process',
    prompt: 'Who owns month-end billing review, and what manual reconciliation happens before invoices are finalized?',
    required: true,
  },
  {
    key: 'cost_tracking',
    label: 'AI/API cost tracking',
    prompt: 'How do you track provider costs and gross margin by customer, workspace, model, or product area?',
    required: true,
  },
  {
    key: 'known_issues',
    label: 'Known leakage issues',
    prompt: 'What billing, usage, entitlement, invoice, or margin issues do you already suspect?',
    required: false,
  },
] as const

export type IntakeQuestion = (typeof INTAKE_QUESTIONS)[number]
export type IntakeQuestionKey = IntakeQuestion['key']
export type IntakeStatus = 'not_started' | 'in_progress' | 'complete'
export type IntakeAnswers = Partial<Record<IntakeQuestionKey, string>>

export type IntakeCompleteness = {
  status: IntakeStatus
  requiredQuestions: number
  answeredRequired: number
  percentComplete: number
  missingRequiredKeys: IntakeQuestionKey[]
}

export const intakeStatusSchema = z.enum(['not_started', 'in_progress', 'complete'])
export const intakeAnswerKeySchema = z.enum(INTAKE_QUESTIONS.map((question) => question.key) as [IntakeQuestionKey, ...IntakeQuestionKey[]])
const intakeAnswerShape = Object.fromEntries(
  INTAKE_QUESTIONS.map((question) => [question.key, z.string().min(1)]),
) as Record<IntakeQuestionKey, z.ZodString>
export const intakeAnswersSchema = z.object(intakeAnswerShape).partial()

export const intakeResponseSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  answers: intakeAnswersSchema,
  status: intakeStatusSchema,
  completeness: z.object({
    status: intakeStatusSchema,
    requiredQuestions: z.number().int().nonnegative(),
    answeredRequired: z.number().int().nonnegative(),
    percentComplete: z.number().int().min(0).max(100),
    missingRequiredKeys: z.array(intakeAnswerKeySchema),
  }),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
})

export type IntakeResponse = z.infer<typeof intakeResponseSchema>

export type CreateIntakeResponseInput = {
  organizationId: string
  workspaceId: string
  answers: Record<string, FormDataEntryValue | string | null | undefined>
  updatedBy: string
}

export type IntakeAnswerListItem = {
  key: IntakeQuestionKey
  label: string
  value: string
  required: boolean
}

export function createIntakeResponse(input: CreateIntakeResponseInput, now = new Date()): IntakeResponse {
  const answers = normalizeIntakeAnswers(input.answers)
  const completeness = getIntakeCompleteness(answers)

  return intakeResponseSchema.parse({
    id: `intake_${slug(input.workspaceId)}`,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    answers,
    status: completeness.status,
    completeness,
    updatedBy: input.updatedBy,
    updatedAt: now.toISOString(),
  })
}

export function getIntakeCompleteness(answers: Partial<Record<string, string | null | undefined>>): IntakeCompleteness {
  const normalized = normalizeIntakeAnswers(answers)
  const requiredQuestions = INTAKE_QUESTIONS.filter((question) => question.required)
  const missingRequiredKeys = requiredQuestions
    .filter((question) => !normalized[question.key])
    .map((question) => question.key)
  const answeredRequired = requiredQuestions.length - missingRequiredKeys.length
  const answeredAnyQuestion = INTAKE_QUESTIONS.some((question) => Boolean(normalized[question.key]))
  const status = resolveIntakeStatus({
    answeredAnyQuestion,
    answeredRequired,
    requiredQuestions: requiredQuestions.length,
  })

  return {
    status,
    requiredQuestions: requiredQuestions.length,
    answeredRequired,
    percentComplete:
      requiredQuestions.length === 0 ? 100 : Math.round((answeredRequired / requiredQuestions.length) * 100),
    missingRequiredKeys,
  }
}

export function buildIntakeAnswerList(answers: Partial<Record<string, string | null | undefined>>): IntakeAnswerListItem[] {
  const normalized = normalizeIntakeAnswers(answers)

  return INTAKE_QUESTIONS.flatMap((question) => {
    const value = normalized[question.key]

    if (!value) {
      return []
    }

    return [
      {
        key: question.key,
        label: question.label,
        value,
        required: question.required,
      },
    ]
  })
}

export function extractIntakeAnswersFromFormData(formData: FormData): IntakeAnswers {
  return normalizeIntakeAnswers(Object.fromEntries(INTAKE_QUESTIONS.map((question) => [question.key, formData.get(question.key)])))
}

export class JsonIntakeStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<IntakeResponse[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return z.array(intakeResponseSchema).parse(JSON.parse(raw))
    } catch (error) {
      if (isMissingFileError(error)) {
        return []
      }

      throw error
    }
  }

  async getByWorkspace(workspaceId: string): Promise<IntakeResponse | null> {
    const responses = await this.list()

    return responses.find((response) => response.workspaceId === workspaceId) ?? null
  }

  async listByWorkspace(workspaceId: string): Promise<IntakeResponse[]> {
    const responses = await this.list()

    return responses.filter((response) => response.workspaceId === workspaceId)
  }

  async save(response: IntakeResponse): Promise<void> {
    const responses = await this.list()
    const next = [...responses.filter((existing) => existing.workspaceId !== response.workspaceId), response]

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')
  }

  async deleteByWorkspace(workspaceId: string): Promise<number> {
    const responses = await this.list()
    const next = responses.filter((response) => response.workspaceId !== workspaceId)

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(next, null, 2), 'utf8')

    return responses.length - next.length
  }
}

function normalizeIntakeAnswers(answers: Partial<Record<string, FormDataEntryValue | string | null | undefined>>): IntakeAnswers {
  const normalized: IntakeAnswers = {}
  const validKeys = new Set<string>(INTAKE_QUESTIONS.map((question) => question.key))

  for (const [key, value] of Object.entries(answers)) {
    if (!validKeys.has(key) || typeof value !== 'string') {
      continue
    }

    const trimmed = value.trim()

    if (trimmed.length > 0) {
      normalized[key as IntakeQuestionKey] = trimmed
    }
  }

  return normalized
}

function resolveIntakeStatus(input: {
  answeredAnyQuestion: boolean
  answeredRequired: number
  requiredQuestions: number
}): IntakeStatus {
  if (!input.answeredAnyQuestion) {
    return 'not_started'
  }

  if (input.answeredRequired === input.requiredQuestions) {
    return 'complete'
  }

  return 'in_progress'
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
