import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  INTAKE_QUESTIONS,
  JsonIntakeStore,
  buildIntakeAnswerList,
  createIntakeResponse,
  extractIntakeAnswersFromFormData,
  getIntakeCompleteness,
} from './intake'

describe('audit intake workflow', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'uri-intake-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('classifies intake completeness from required answer coverage', () => {
    const requiredQuestions = INTAKE_QUESTIONS.filter((question) => question.required)
    const partialAnswers = {
      billing_model: 'Base subscription plus API-call overages',
      billing_systems: 'Stripe',
    }
    const completeAnswers = Object.fromEntries(
      requiredQuestions.map((question) => [question.key, `Answer for ${question.label}`]),
    )

    expect(getIntakeCompleteness({})).toEqual({
      status: 'not_started',
      requiredQuestions: requiredQuestions.length,
      answeredRequired: 0,
      percentComplete: 0,
      missingRequiredKeys: requiredQuestions.map((question) => question.key),
    })
    expect(getIntakeCompleteness(partialAnswers)).toMatchObject({
      status: 'in_progress',
      requiredQuestions: requiredQuestions.length,
      answeredRequired: 2,
      percentComplete: Math.round((2 / requiredQuestions.length) * 100),
    })
    expect(getIntakeCompleteness(completeAnswers)).toEqual({
      status: 'complete',
      requiredQuestions: requiredQuestions.length,
      answeredRequired: requiredQuestions.length,
      percentComplete: 100,
      missingRequiredKeys: [],
    })
  })

  it('saves draft intake answers and reloads the latest response by workspace', async () => {
    const store = new JsonIntakeStore(join(tempDir, 'intake.json'))
    const draft = createIntakeResponse(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        answers: {
          billing_model: '  Base subscription plus prepaid credits  ',
          billing_systems: 'Stripe',
          usage_units: '',
          custom_contracts: 'Yes, enterprise order forms override public pricing.',
        },
        updatedBy: 'user_finance',
      },
      new Date('2026-06-01T10:00:00.000Z'),
    )

    await store.save(draft)

    await expect(store.getByWorkspace('workspace_001')).resolves.toEqual({
      ...draft,
      answers: {
        billing_model: 'Base subscription plus prepaid credits',
        billing_systems: 'Stripe',
        custom_contracts: 'Yes, enterprise order forms override public pricing.',
      },
      status: 'in_progress',
      completeness: expect.objectContaining({
        answeredRequired: 3,
        status: 'in_progress',
      }),
    })
    await expect(store.getByWorkspace('other_workspace')).resolves.toBeNull()

    const complete = createIntakeResponse(
      {
        organizationId: 'org_001',
        workspaceId: 'workspace_001',
        answers: Object.fromEntries(INTAKE_QUESTIONS.map((question) => [question.key, `Updated ${question.label}`])),
        updatedBy: 'user_finance',
      },
      new Date('2026-06-01T11:00:00.000Z'),
    )

    await store.save(complete)

    await expect(store.getByWorkspace('workspace_001')).resolves.toMatchObject({
      status: 'complete',
      updatedAt: '2026-06-01T11:00:00.000Z',
      updatedBy: 'user_finance',
    })
  })

  it('builds ordered intake answers for internal review and evidence-pack context', () => {
    const answers = buildIntakeAnswerList({
      usage_units: 'API calls and hosted fine-tuning jobs',
      billing_model: 'Enterprise platform fee plus metered overages',
      close_process: 'Finance reviews invoice previews on the third working day.',
    })

    expect(answers).toEqual([
      {
        key: 'billing_model',
        label: 'Billing model',
        value: 'Enterprise platform fee plus metered overages',
        required: true,
      },
      {
        key: 'usage_units',
        label: 'Usage units',
        value: 'API calls and hosted fine-tuning jobs',
        required: true,
      },
      {
        key: 'close_process',
        label: 'Month-end close process',
        value: 'Finance reviews invoice previews on the third working day.',
        required: true,
      },
    ])
  })

  it('extracts only known intake answers from submitted form data', () => {
    const formData = new FormData()
    formData.set('billing_model', '  Subscription plus metered API calls  ')
    formData.set('billing_systems', 'Stripe and HubSpot')
    formData.set('usage_units', '')
    formData.set('unexpected_field', 'Do not persist this')

    expect(extractIntakeAnswersFromFormData(formData)).toEqual({
      billing_model: 'Subscription plus metered API calls',
      billing_systems: 'Stripe and HubSpot',
    })
  })
})
